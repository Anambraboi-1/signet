import { test, expect } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { apiSignIn } from './support';

/**
 * `/link` — every state of the approval page (#617).
 *
 * The happy approve path is already covered end-to-end by
 * `claim-link-profile.spec.ts`; this spec covers everything around it: the
 * sign-in gate round-trip, reject, expiry, the network mismatch, and the
 * countdown. Database-backed (`@db`): expiry and the mismatch need rows the
 * public API refuses to create, so they are shaped directly with Prisma —
 * which is also the only way to age a pairing without waiting five minutes.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL);

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Mint a pairing through the real API, as `signet link` would. */
async function startPairing(page: import('@playwright/test').Page, deployer: Keypair) {
  const started = await page.request.post('/api/cli/pair/start', {
    data: { network: 'testnet', publicKey: deployer.publicKey() },
  });
  expect(started.ok(), 'pair/start should mint a pairing').toBeTruthy();
  return (await started.json()) as { state: string; pollToken: string; userCode: string };
}

/**
 * A pairing row the API would refuse to mint (wrong network, already aged):
 * written directly, with a user code hashed the way `startPairing` hashes it.
 */
async function insertPairingRow(fields: { network: string; publicKey: string; expiresAt: Date }) {
  const { prisma } = await import('@signet/db');
  const userCode = randomBytes(4).toString('hex').toUpperCase().slice(0, 8);
  const row = await prisma.pairingState.create({
    data: {
      network: fields.network,
      publicKey: fields.publicKey,
      userCodeHash: sha256(userCode),
      expiresAt: fields.expiresAt,
    },
  });
  return { state: row.id, userCode };
}

test.describe('the /link approval page, state by state @db', () => {
  test.skip(!HAS_DB, 'needs DATABASE_URL: pairings live in the database');

  const suffix = Date.now().toString(36);

  test('signed out shows the gate, and signing in returns to the same URL', async ({ page }) => {
    const deployer = Keypair.random();
    // The pairing must exist before sign-in so that what renders afterwards
    // is the real approval form, proving the URL (code and all) survived.
    const owner = Keypair.random();
    await apiSignIn(page, owner);
    const started = await startPairing(page, deployer);
    await page.context().clearCookies();

    const url = `/link?code=${started.state}&user_code=${started.userCode}`;
    await page.goto(url);
    await expect(page.getByRole('button', { name: /sign in with wallet/i })).toBeVisible();
    // The page must not disclose whether the code is real to the signed-out.
    await expect(page.getByText(deployer.publicKey())).not.toBeVisible();

    // The gate signs in and reloads in place (`window.location.reload()`), so
    // the whole URL — code, user_code, any callback params — is preserved.
    // The wallet extension doesn't exist in Playwright, so the session is
    // established the way `support.ts` documents and the reload is driven
    // explicitly; what is being pinned is that the same URL now renders the
    // form rather than bouncing through a redirect that could shed params.
    const { prisma } = await import('@signet/db');
    await prisma.profile.create({
      data: {
        handle: `e2eg${suffix}`.slice(0, 32),
        wallets: { create: { pubkey: owner.publicKey(), source: 'onchain', isPrimary: true } },
      },
    });
    await apiSignIn(page, owner);
    await page.reload();
    expect(new URL(page.url()).search).toContain(`code=${started.state}`);
    expect(new URL(page.url()).search).toContain(`user_code=${started.userCode}`);
    await expect(page.getByRole('button', { name: /^approve\b/i })).toBeVisible();
    await expect(page.getByText(deployer.publicKey())).toBeVisible();
  });

  test('reject records the refusal and the CLI sees rejected', async ({ page }) => {
    const owner = Keypair.random();
    const deployer = Keypair.random();
    const { prisma } = await import('@signet/db');
    await prisma.profile.create({
      data: {
        handle: `e2er${suffix}`.slice(0, 32),
        wallets: { create: { pubkey: owner.publicKey(), source: 'onchain', isPrimary: true } },
      },
    });
    await apiSignIn(page, owner);
    const started = await startPairing(page, deployer);

    await page.goto(`/link?code=${started.state}&user_code=${started.userCode}`);
    // The countdown is live before anything is decided.
    await expect(page.getByText(/expires in \d+:\d{2}/i)).toBeVisible();

    await page.getByRole('button', { name: /reject/i }).click();
    const result = page.getByText(/rejected\. nothing was linked/i);
    await expect(result).toBeVisible();
    // Keyboard/screen-reader users land on the outcome, not a dead button.
    await expect(result).toBeFocused();

    const polled = await page.request.get(
      `/api/cli/pair/status?pollToken=${encodeURIComponent(started.pollToken)}`,
    );
    expect(polled.ok()).toBeTruthy();
    expect(((await polled.json()) as { status: string }).status).toBe('rejected');
  });

  test('an expired code shows the refusal page', async ({ page }) => {
    const owner = Keypair.random();
    const { prisma } = await import('@signet/db');
    await prisma.profile.create({
      data: {
        handle: `e2ex${suffix}`.slice(0, 32),
        wallets: { create: { pubkey: owner.publicKey(), source: 'onchain', isPrimary: true } },
      },
    });
    await apiSignIn(page, owner);
    const expired = await insertPairingRow({
      network: 'testnet',
      publicKey: Keypair.random().publicKey(),
      expiresAt: new Date(Date.now() - 1_000),
    });

    await page.goto(`/link?code=${expired.state}&user_code=${expired.userCode}`);
    await expect(page.getByRole('heading', { name: /can’t approve this/i })).toBeVisible();
    await expect(page.getByText(/has expired/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^approve\b/i })).not.toBeVisible();
  });

  test('a mainnet pairing on a testnet deployment shows the mismatch, with no Approve', async ({
    page,
  }) => {
    const owner = Keypair.random();
    const { prisma } = await import('@signet/db');
    await prisma.profile.create({
      data: {
        handle: `e2em${suffix}`.slice(0, 32),
        wallets: { create: { pubkey: owner.publicKey(), source: 'onchain', isPrimary: true } },
      },
    });
    await apiSignIn(page, owner);
    // pair/start refuses this combination outright (#616), which is exactly
    // why the row is shaped directly: the page must still fail safe if such
    // a row exists — a deployment reconfigured mid-pairing produces one.
    const mismatched = await insertPairingRow({
      network: 'mainnet',
      publicKey: Keypair.random().publicKey(),
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });

    await page.goto(`/link?code=${mismatched.state}&user_code=${mismatched.userCode}`);
    await expect(page.getByText(/this pairing is for mainnet/i)).toBeVisible();
    await expect(page.getByText(/this deployment serves testnet/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^approve\b/i })).not.toBeVisible();
  });

  test('the approval form shows network, countdown, copy button and the consent text', async ({
    page,
  }) => {
    const owner = Keypair.random();
    const deployer = Keypair.random();
    const { prisma } = await import('@signet/db');
    await prisma.profile.create({
      data: {
        handle: `e2ec${suffix}`.slice(0, 32),
        wallets: { create: { pubkey: owner.publicKey(), source: 'onchain', isPrimary: true } },
      },
    });
    await apiSignIn(page, owner);
    const started = await startPairing(page, deployer);

    await page.goto(`/link?code=${started.state}&user_code=${started.userCode}`);
    await expect(page.getByText('testnet', { exact: true })).toBeVisible();
    await expect(page.getByText(/expires in \d+:\d{2}/i)).toBeVisible();
    await expect(
      page.getByText(/only approve if you just ran `signet link` in your own terminal/i),
    ).toBeVisible();

    // The copy button is keyboard-operable and has an accessible name.
    // Headless Chromium denies clipboard writes unless the context grants them, and the
    // component (correctly) shows no "Copied" state when the write is denied.
    await page.context().grantPermissions(['clipboard-write']);
    const copy = page.getByRole('button', { name: /copy deploy wallet address/i });
    await expect(copy).toBeVisible();
    await copy.focus();
    await expect(copy).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/^copied$/i)).toBeVisible();

    // Both action buttons are reachable by keyboard.
    await page.getByRole('button', { name: /^approve\b/i }).focus();
    await expect(page.getByRole('button', { name: /^approve\b/i })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: /^reject$/i })).toBeFocused();
  });
});
