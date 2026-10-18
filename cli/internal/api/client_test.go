package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/blockchain-maxis/signet/cli/internal/exitcode"
)

// instant makes backoff free and deterministic: no sleeping, jitter is the
// identity, and every wait is recorded for assertion.
func instant(waits *[]time.Duration) Options {
	return Options{
		Sleep: func(_ context.Context, d time.Duration) error {
			*waits = append(*waits, d)
			return nil
		},
		Jitter: func(d time.Duration) time.Duration { return d },
	}
}

func client(t *testing.T, baseURL string, opts Options) *Client {
	t.Helper()
	c, err := New(baseURL, opts)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c
}

func TestGet_RetriesA503AndSucceedsOnAttemptThree(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer srv.Close()

	var waits []time.Duration
	var out struct {
		OK bool `json:"ok"`
	}
	if err := client(t, srv.URL, instant(&waits)).Get(context.Background(), "/x", &out); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if calls.Load() != 3 || !out.OK {
		t.Fatalf("calls = %d, out = %+v; want success on attempt 3", calls.Load(), out)
	}
	// Exponential: the second wait doubles the first.
	if len(waits) != 2 || waits[1] != waits[0]*2 {
		t.Fatalf("waits = %v; want two, doubling", waits)
	}
}

func TestPost_IsNotRetried(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	var waits []time.Duration
	err := client(t, srv.URL, instant(&waits)).Post(context.Background(), "/x", map[string]string{"a": "b"}, nil)
	if err == nil {
		t.Fatal("expected an error")
	}
	if calls.Load() != 1 {
		t.Fatalf("calls = %d; a POST must not be retried", calls.Load())
	}

	// The explicit marker is what opts a POST in.
	calls.Store(0)
	_ = client(t, srv.URL, instant(&waits)).PostIdempotent(context.Background(), "/x", nil, nil)
	if calls.Load() != 3 {
		t.Fatalf("calls = %d; an idempotent POST retries like a GET", calls.Load())
	}
}

func TestRetryAfter_IsHonoured(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_, _ = io.WriteString(w, `{}`)
	}))
	defer srv.Close()

	var waits []time.Duration
	if err := client(t, srv.URL, instant(&waits)).Get(context.Background(), "/x", nil); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if len(waits) != 1 || waits[0] != time.Second {
		t.Fatalf("waits = %v; want exactly the server's Retry-After of 1s", waits)
	}
}

func TestRetryAfter_IsCappedAtThirtySeconds(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "600")
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = io.WriteString(w, `{}`)
	}))
	defer srv.Close()

	var waits []time.Duration
	if err := client(t, srv.URL, instant(&waits)).Get(context.Background(), "/x", nil); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if len(waits) != 1 || waits[0] != 30*time.Second {
		t.Fatalf("waits = %v; a ten-minute Retry-After is capped at 30s", waits)
	}
}

func TestTimeout_MapsToTheTimeoutExitCode(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		<-release
	}))
	defer srv.Close()
	defer close(release)

	var waits []time.Duration
	opts := instant(&waits)
	opts.HTTP = &http.Client{Timeout: 50 * time.Millisecond}
	// A non-idempotent POST, so the timeout surfaces on the first attempt.
	err := client(t, srv.URL, opts).Post(context.Background(), "/x", nil, nil)
	if !errors.Is(err, exitcode.ErrTimeout) {
		t.Fatalf("err = %v, want ErrTimeout (exit code %d via cmd.ExitCode)", err, exitcode.Timeout)
	}
}

func TestA500WithAnErrorBodySurfacesTheServersMessage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, `{"error":"the backfill exploded"}`)
	}))
	defer srv.Close()

	var waits []time.Duration
	err := client(t, srv.URL, instant(&waits)).Get(context.Background(), "/x", nil)
	if err == nil || !strings.Contains(err.Error(), "the backfill exploded") {
		t.Fatalf("err = %v; the server's own message must survive", err)
	}
	var apiErr *Error
	if !errors.As(err, &apiErr) || apiErr.Status != http.StatusInternalServerError {
		t.Fatalf("err = %#v; want *api.Error carrying the status", err)
	}
	// And a 500 is the server's decision, not a transient blip: no retry.
}

func TestPlainHTTPToARemoteHostIsRefused(t *testing.T) {
	if _, err := New("http://example.com", Options{}); !errors.Is(err, exitcode.ErrConfiguration) {
		t.Fatalf("err = %v; http to a remote host must be refused", err)
	}
	// The documented escape hatches.
	if _, err := New("http://localhost:3000", Options{}); err != nil {
		t.Fatalf("localhost http refused: %v", err)
	}
	if _, err := New("http://127.0.0.1:3000", Options{}); err != nil {
		t.Fatalf("loopback http refused: %v", err)
	}
	if _, err := New("http://example.com", Options{Insecure: true}); err != nil {
		t.Fatalf("--insecure must permit it: %v", err)
	}
	if _, err := New("https://example.com", Options{}); err != nil {
		t.Fatalf("https refused: %v", err)
	}
}

func TestAConfiguration503IsNotRetried(t *testing.T) {
	// #600's "no database" 503 carries code "unavailable", which maps to a
	// configuration error: the deployment cannot do this at all, and three
	// slow repetitions of the same answer help nobody.
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = io.WriteString(w, `{"error":"no database configured","code":"unavailable"}`)
	}))
	defer srv.Close()

	var waits []time.Duration
	err := client(t, srv.URL, instant(&waits)).Get(context.Background(), "/x", nil)
	if !errors.Is(err, exitcode.ErrConfiguration) {
		t.Fatalf("err = %v, want ErrConfiguration", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("calls = %d; a configuration 503 must not be retried", calls.Load())
	}
}

func TestUserAgent_IsSentAndNamesTheBuild(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("User-Agent")
		_, _ = io.WriteString(w, `{}`)
	}))
	defer srv.Close()

	opts := Options{UserAgent: UserAgent("1.2.3")}
	if err := client(t, srv.URL, opts).Get(context.Background(), "/x", nil); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !strings.HasPrefix(got, "signet-cli/1.2.3 (") || !strings.Contains(got, "/") {
		t.Fatalf("User-Agent = %q; want signet-cli/<version> (<goos>/<goarch>)", got)
	}
}
