import { test, expect, type Page, type Route } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './a11y';
import { apiSignIn } from './support';

/**
 * The API keys page (#652).
 *
 * The session is real: `apiSignIn` signs in against the test server, so the
 * dashboard layout renders for this wallet. The database is not: every
 * `account.*` tRPC call the page makes is answered here from an in-memory
 * store that lives for the test, so a reload sees what earlier requests did,
 * the way a database would. That keeps the spec in the hermetic run.
 *
 * The mock follows the server's rules (active keys only, prefix only, five at
 * most) and its error text; `lib/server/account-api-keys.test.ts` pins that
 * the server really enforces them.
 */

interface MockKey {
  id: string;
  name: string;
  prefix: string;
  key: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

const LIMIT_MESSAGE = 'You already have 5 active API keys. Revoke one before creating another.';

function randomChars(n: number, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'): string {
  return Array.from(
    { length: n },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('');
}

function mintKey(name: string, n: number): MockKey {
  const prefix = randomChars(8, '0123456789abcdef');
  return {
    id: `key-${n}`,
    name,
    prefix,
    key: `sgk_${prefix}_${randomChars(43)}`,
    createdAt: `2026-10-${String(10 + n).padStart(2, '0')}T09:00:00.000Z`,
    lastUsedAt: null,
    revoked: false,
  };
}

/** A tRPC batch response item for a result or an error. */
const ok = (data: unknown) => ({ result: { data } });
const fail = (code: string, httpStatus: number, message: string, path: string) => ({
  error: { message, code: -32600, data: { code, httpStatus, path } },
});

/**
 * Answers the dashboard's `account.*` tRPC calls from `keys`, in tRPC's batch
 * wire format (`/api/trpc/a,b?batch=1`, one result per procedure).
 */
async function mockAccount(page: Page, opts: { editable: boolean; keys?: MockKey[] }) {
  const keys = opts.keys ?? [];
  const active = () => keys.filter((k) => !k.revoked);
  const summary = (k: MockKey) => ({
    id: k.id,
    name: k.name,
    prefix: `sgk_${k.prefix}`,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
  });

  await page.route('**/api/trpc/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const paths = url.pathname.replace('/api/trpc/', '').split(',');
    const inputs: Record<string, unknown> =
      request.method() === 'POST'
        ? (request.postDataJSON() ?? {})
        : JSON.parse(url.searchParams.get('input') ?? '{}');

    const results = paths.map((path, i) => {
      const input = inputs[String(i)] as Record<string, string> | undefined;
      switch (path) {
        case 'account.me':
          return ok({
            address: 'G-E2E',
            handle: 'keysmith',
            displayName: null,
            bio: null,
            dbConfigured: true,
            editable: opts.editable,
          });
        case 'account.apiKeys.list':
          return ok(
            active()
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map(summary),
          );
        case 'account.apiKeys.create': {
          if (active().length >= 5) return fail('FORBIDDEN', 403, LIMIT_MESSAGE, path);
          const made = mintKey(String(input?.name ?? '').trim(), keys.length + 1);
          keys.push(made);
          return ok({ key: made.key, apiKey: summary(made) });
        }
        case 'account.apiKeys.revoke': {
          const target = active().find((k) => k.id === input?.id);
          if (!target) return fail('NOT_FOUND', 404, 'API key not found', path);
          target.revoked = true;
          return ok({ id: target.id });
        }
        default:
          return fail('NOT_FOUND', 404, `No procedure ${path}`, path);
      }
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(results),
    });
  });
  return keys;
}

async function openPage(page: Page, opts: { editable: boolean; keys?: MockKey[] }) {
  await apiSignIn(page);
  const keys = await mockAccount(page, opts);
  await page.goto('/app/api-keys');
  await expect(page.getByRole('heading', { name: 'API keys', level: 1 })).toBeVisible();
  return keys;
}

function seeded(count: number): MockKey[] {
  return Array.from({ length: count }, (_, i) => mintKey(`key ${i + 1}`, i + 1));
}

test.describe('API keys', () => {
  test('a created key is shown once; after a reload only its prefix remains', async ({ page }) => {
    const keys = await openPage(page, { editable: true });

    await page.getByLabel('Key name').fill('CI deploys');
    await page.getByRole('button', { name: 'Create key' }).click();

    const dialog = page.getByRole('dialog', { name: 'Key created: CI deploys' });
    await expect(dialog).toBeVisible();
    const fullKey = keys[0]!.key;
    await expect(dialog.getByTestId('api-key-value')).toHaveText(fullKey);
    await expect(dialog).toContainText("You won't see it again");
    await expect(dialog.getByRole('button', { name: 'Copy key' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    // Gone from the page as soon as the dialog closes, not only after a reload.
    await expect(page.getByText(fullKey)).toHaveCount(0);
    const prefix = `sgk_${keys[0]!.prefix}`;
    await expect(page.getByText(`${prefix}…`)).toBeVisible();

    await page.reload();
    await expect(page.getByText('CI deploys')).toBeVisible();
    await expect(page.getByText(`${prefix}…`)).toBeVisible();
    expect(await page.content()).not.toContain(fullKey);
  });

  test('revoking asks first, then removes the key from the active list', async ({ page }) => {
    const keys = await openPage(page, { editable: true, keys: seeded(2) });
    const list = page.getByRole('region', { name: 'Active keys' });
    await expect(list.getByRole('listitem')).toHaveCount(2);

    await page.getByRole('button', { name: 'Revoke key 1' }).click();
    // Nothing happens until it is confirmed.
    expect(keys[0]!.revoked).toBe(false);
    await page.getByRole('button', { name: 'Confirm revoke' }).click();

    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list.getByText('key 1', { exact: true })).toHaveCount(0);
    await expect(list.getByText('key 2', { exact: true })).toBeVisible();
    await expect(page.getByText('1 of 5')).toBeVisible();
    expect(keys[0]!.revoked).toBe(true);
  });

  test('cancelling a revoke keeps the key', async ({ page }) => {
    const keys = await openPage(page, { editable: true, keys: seeded(1) });
    await page.getByRole('button', { name: 'Revoke key 1' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Revoke key 1' })).toBeFocused();
    expect(keys[0]!.revoked).toBe(false);
  });

  test('the sixth key is refused with a message', async ({ page }) => {
    const keys = await openPage(page, { editable: true, keys: seeded(5) });
    await expect(page.getByText('5 of 5')).toBeVisible();

    await page.getByLabel('Key name').fill('one too many');
    await page.getByRole('button', { name: 'Create key' }).click();

    // Filtered: Next's route announcer is a (normally empty) alert too.
    await expect(page.getByRole('alert').filter({ hasText: LIMIT_MESSAGE })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(keys).toHaveLength(5);
  });

  test('the dialog traps focus and returns it to the trigger', async ({ page }) => {
    await openPage(page, { editable: true });
    const trigger = page.getByRole('button', { name: 'Create key' });

    await page.getByLabel('Key name').fill('focus');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Key created: focus' });
    await expect(dialog).toBeVisible();

    const focusInDialog = () =>
      page.evaluate(() => document.activeElement?.closest('dialog') !== null);
    const copy = dialog.getByRole('button', { name: 'Copy key' });
    const done = dialog.getByRole('button', { name: 'Done' });

    await expect(copy).toBeFocused();
    // Forwards past the last control wraps to the first, and backwards past
    // the first wraps to the last: focus never leaves the dialog.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      expect(await focusInDialog()).toBe(true);
    }
    await copy.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(done).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(copy).toBeFocused();

    await expectNoSeriousA11yViolations(page, 'API key created dialog');

    // Escape closes it, and focus goes back to the control that opened it.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // So does Done.
    await page.getByLabel('Key name').fill('again');
    await trigger.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('the page has no serious accessibility violations', async ({ page }) => {
    await openPage(page, { editable: true, keys: seeded(2) });
    await expect(
      page.getByRole('region', { name: 'Active keys' }).getByRole('listitem'),
    ).toHaveCount(2);
    await expectNoSeriousA11yViolations(page, 'API keys page');
  });

  test('a wallet without a profile row is told why instead of shown the form', async ({ page }) => {
    await openPage(page, { editable: false });
    await expect(page.getByText(/doesn.t have a profile record yet/)).toBeVisible();
    await expect(page.getByLabel('Key name')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create key' })).toHaveCount(0);
  });

  test('the dashboard nav links to the page', async ({ page }) => {
    await apiSignIn(page);
    await mockAccount(page, { editable: true });
    await page.goto('/app');
    await page.getByRole('link', { name: 'API keys' }).click();
    await expect(page).toHaveURL(/\/app\/api-keys$/);
  });
});
