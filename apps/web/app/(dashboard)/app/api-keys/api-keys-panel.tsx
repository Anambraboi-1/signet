'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { ModalDialog } from '../../components/modal-dialog';

const mono = { fontFamily: 'var(--font-mono)' } as const;

/** Mirrors `MAX_ACTIVE_API_KEYS` on the server, which is what enforces it. */
const MAX_ACTIVE = 5;

const sectionLabel = 'text-[10px] uppercase tracking-[0.22em] text-[var(--text-muted)]';
const fieldLabel = 'mb-2 block text-[11px] uppercase tracking-[0.18em] text-[#8a8779]';
const field =
  'w-full border border-[#1f1d19] bg-transparent px-4 py-3 text-[14px] text-[#f5f4ee] outline-none focus:border-[#5e5b51]';
const primaryButton =
  'bg-[#f5f4ee] px-7 py-3 text-[12px] font-medium uppercase tracking-[0.18em] text-[#0a0908] transition-all duration-300 hover:bg-[#c2410c] hover:text-[#f5f4ee] disabled:opacity-60';
const quietButton =
  'text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-accent)] disabled:opacity-60';
const accentButton =
  'text-[10px] uppercase tracking-[0.2em] text-[var(--text-accent)] transition-colors hover:text-[var(--text-accent)]';

/** `2026-10-24`, the date format the wallets page uses. */
function day(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Create, list and revoke the signed-in profile's API keys (#652).
 *
 * The full key exists in this component only between `create` succeeding and
 * the reveal dialog closing; after that it is dropped, and the list (like the
 * server) only ever knows the prefix. Wallets with no profile row yet see why
 * instead of a form, the same split `ProfileEditor` makes on `editable`.
 */
export function ApiKeysPanel() {
  const me = trpc.account.me.useQuery();
  const editable = me.data?.editable === true;

  if (me.isPending) return <p className="text-[14px] text-[#8a8779]">Loading…</p>;
  if (me.isError) {
    return (
      <p className="max-w-[640px] text-[14px] leading-[1.7] text-[#b8654a]">
        Could not load your account.
      </p>
    );
  }
  if (!editable) {
    return (
      <p className="max-w-[640px] text-[14px] leading-[1.7] text-[#8a8779]" style={mono}>
        API keys belong to a profile, and this wallet doesn&apos;t have a profile record yet.{' '}
        {me.data.handle ? (
          <>
            Handle <span className="text-[#b8b5a8]">@{me.data.handle}</span> is bound on-chain, but
            the indexer hasn&apos;t synced it. Keys can be created once it has.
          </>
        ) : (
          <>
            Claim a handle on-chain via the Identity Registry; once the indexer creates your
            profile, you can create keys here.
          </>
        )}
      </p>
    );
  }
  return <ApiKeysManager />;
}

function ApiKeysManager() {
  const utils = trpc.useUtils();
  const list = trpc.account.apiKeys.list.useQuery();
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ name: string; key: string } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const createButton = useRef<HTMLButtonElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);

  const create = trpc.account.apiKeys.create.useMutation({
    onSuccess: ({ key, apiKey }) => {
      setName('');
      setRevealed({ name: apiKey.name, key });
      void utils.account.apiKeys.list.invalidate();
    },
    onError: (err) => setCreateError(err.message || 'Could not create the key'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    create.mutate({ name });
  }

  const onRevoked = useCallback(
    (keyName: string) => {
      setAnnouncement(`Revoked ${keyName}.`);
      // The revoked row (and its buttons) is gone; move focus somewhere that
      // still exists rather than letting it fall back to the page.
      listHeading.current?.focus();
      void utils.account.apiKeys.list.invalidate();
    },
    [utils],
  );

  const keys = list.data ?? [];

  return (
    <div className="max-w-[720px] space-y-12" style={mono}>
      <form onSubmit={submit} className="max-w-[560px] space-y-5" noValidate>
        <div>
          <label htmlFor="api-key-name" className={fieldLabel}>
            Key name
          </label>
          <input
            id="api-key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            placeholder="CI deploys"
            autoComplete="off"
            aria-describedby="api-key-name-hint"
            className={field}
          />
          <p id="api-key-name-hint" className="mt-2 text-[12px] leading-[1.6] text-[#8a8779]">
            A label for you, so you can tell keys apart. Up to {MAX_ACTIVE} keys can be active at
            once.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button
            ref={createButton}
            type="submit"
            disabled={create.isPending}
            className={primaryButton}
          >
            {create.isPending ? 'Creating…' : 'Create key'}
          </button>
          {createError && (
            <p role="alert" className="text-[12px] leading-[1.6] text-[#b8654a]">
              {createError}
            </p>
          )}
        </div>
      </form>

      <section aria-labelledby="api-keys-heading">
        <div className="flex items-baseline justify-between gap-4">
          <h2
            id="api-keys-heading"
            ref={listHeading}
            tabIndex={-1}
            className={`${sectionLabel} outline-none`}
          >
            Active keys
          </h2>
          {list.data && (
            <span className="text-[11px] text-[#8a8779]">
              {keys.length} of {MAX_ACTIVE}
            </span>
          )}
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {list.isPending ? (
          <p className="mt-4 text-[13px] text-[#8a8779]">Loading…</p>
        ) : list.isError ? (
          <p className="mt-4 text-[13px] text-[#b8654a]">
            {list.error.message || 'Could not load your keys.'}
          </p>
        ) : keys.length === 0 ? (
          <p className="mt-4 border border-[#1f1d19] px-6 py-5 text-[13px] text-[#8a8779]">
            No active keys.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[#1f1d19] border border-[#1f1d19]">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex flex-wrap items-center justify-between gap-4 px-6 py-4"
              >
                <div className="min-w-0 space-y-1">
                  <div className="text-[14px] text-[#f5f4ee]">{key.name}</div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[#8a8779]">
                    <span>
                      <span className="sr-only">Prefix </span>
                      <code className="text-[#b8b5a8]">{key.prefix}…</code>
                    </span>
                    <span>Created {day(key.createdAt)}</span>
                    <span>
                      {key.lastUsedAt ? `Last used ${day(key.lastUsedAt)}` : 'Never used'}
                    </span>
                  </div>
                </div>
                <RevokeButton id={key.id} name={key.name} onRevoked={onRevoked} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <ModalDialog
        open={revealed !== null}
        onClose={() => setRevealed(null)}
        labelledBy="api-key-created-title"
        describedBy="api-key-created-warning"
        returnFocusTo={createButton}
      >
        {revealed && (
          <RevealKey name={revealed.name} apiKey={revealed.key} onDone={() => setRevealed(null)} />
        )}
      </ModalDialog>
    </div>
  );
}

function RevealKey({ name, apiKey, onDone }: { name: string; apiKey: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(apiKey);
    } catch {
      // Fallback for environments without the clipboard API.
      const el = document.createElement('textarea');
      el.value = apiKey;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-5 px-6 py-6" style={mono}>
      <h2
        id="api-key-created-title"
        className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#f5f4ee]"
      >
        Key created: {name}
      </h2>
      <p
        id="api-key-created-warning"
        className="text-[13px] leading-[1.7] text-[var(--text-accent)]"
      >
        Copy this key now. You won&apos;t see it again: Signet stores only a hash of it, and the
        list will show just its prefix.
      </p>
      <pre className="overflow-x-auto border border-[#1f1d19] bg-[#0a0908] px-4 py-3 text-[12px] leading-relaxed text-[#b8b5a8] select-all whitespace-pre-wrap break-all">
        <code data-testid="api-key-value">{apiKey}</code>
      </pre>
      <div className="flex flex-wrap items-center justify-end gap-5">
        <button type="button" onClick={copy} className={accentButton}>
          <span aria-hidden="true">{copied ? 'Copied' : 'Copy'}</span>
          <span className="sr-only">Copy key</span>
        </button>
        <span role="status" aria-live="polite" className="sr-only">
          {copied ? 'Key copied to clipboard' : ''}
        </span>
        <button type="button" onClick={onDone} className={primaryButton}>
          Done
        </button>
      </div>
    </div>
  );
}

type RevokeState = { status: 'idle' | 'confirming' } | { status: 'error'; message: string };

/**
 * Two-step revoke (Revoke → Confirm/Cancel), like `UnlinkWalletButton`:
 * revoking is immediate and permanent for anything using the key.
 */
function RevokeButton({
  id,
  name,
  onRevoked,
}: {
  id: string;
  name: string;
  onRevoked: (name: string) => void;
}) {
  const [state, setState] = useState<RevokeState>({ status: 'idle' });
  const confirmButton = useRef<HTMLButtonElement>(null);
  const revokeButton = useRef<HTMLButtonElement>(null);

  const revoke = trpc.account.apiKeys.revoke.useMutation({
    onSuccess: () => onRevoked(name),
    onError: (err) =>
      setState({ status: 'error', message: err.message || 'Could not revoke the key' }),
  });

  // Keep keyboard focus with the control the person is acting on.
  useEffect(() => {
    if (state.status === 'confirming') confirmButton.current?.focus();
  }, [state.status]);

  if (state.status === 'confirming') {
    return (
      <span className="flex items-center gap-3 text-[10px] uppercase tracking-[0.2em]" style={mono}>
        <span className="text-[#8a8779]">Revoke {name}?</span>
        <button
          ref={confirmButton}
          type="button"
          onClick={() => {
            setState({ status: 'idle' });
            revoke.mutate({ id });
          }}
          className="text-[var(--text-accent)] transition-colors hover:text-[var(--text-accent)]"
        >
          Confirm revoke
        </button>
        <button
          type="button"
          onClick={() => {
            setState({ status: 'idle' });
            requestAnimationFrame(() => revokeButton.current?.focus());
          }}
          className="text-[var(--text-muted)] transition-colors hover:text-[#b8b5a8]"
        >
          Cancel
        </button>
      </span>
    );
  }

  if (state.status === 'error') {
    return (
      <span className="flex items-center gap-3 text-[10px] uppercase tracking-[0.2em]" style={mono}>
        <span role="alert" className="text-[var(--text-accent)]">
          {state.message}
        </span>
        <button
          type="button"
          onClick={() => setState({ status: 'idle' })}
          className="text-[var(--text-muted)] transition-colors hover:text-[#b8b5a8]"
        >
          Dismiss
        </button>
      </span>
    );
  }

  return (
    <button
      ref={revokeButton}
      type="button"
      onClick={() => setState({ status: 'confirming' })}
      disabled={revoke.isPending}
      aria-label={`Revoke ${name}`}
      className={quietButton}
    >
      {revoke.isPending ? 'Revoking…' : 'Revoke'}
    </button>
  );
}
