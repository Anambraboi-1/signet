import assert from 'node:assert/strict';
import test from 'node:test';
import { TRPCError } from '@trpc/server';
import { API_KEY_PATTERN } from '@signet/types';
import type { ApiKeyRecord } from '../api-keys.ts';
import {
  MAX_ACTIVE_API_KEYS,
  apiKeyIdInput,
  createAccountApiKey,
  listAccountApiKeys,
  normalizeApiKeyName,
  revokeAccountApiKey,
  type AccountApiKeyStore,
} from './account-api-keys.ts';

const ALICE = 'GALICEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BOB = 'GBOBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const NOBODY = 'GNOBODYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** An in-memory store: alice and bob each own a profile, nobody owns none. */
function fakeStore() {
  const wallets = new Map([
    [ALICE, 'profile-alice'],
    [BOB, 'profile-bob'],
  ]);
  const keys: ApiKeyRecord[] = [];
  const locks: string[] = [];
  let clock = Date.parse('2026-10-24T09:00:00Z');
  const active = (profileId: string) =>
    keys.filter((k) => k.profileId === profileId && k.revokedAt === null);

  const store: AccountApiKeyStore = {
    wallet: {
      async findUnique({ where }) {
        const profileId = wallets.get(where.pubkey);
        return profileId ? { profileId } : null;
      },
    },
    apiKey: {
      async findMany({ where }) {
        return active(where.profileId).sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
      },
      async count({ where }) {
        return active(where.profileId).length;
      },
      async create({ data }) {
        clock += 1000;
        const record: ApiKeyRecord = {
          id: `key-${keys.length + 1}`,
          ...data,
          createdAt: new Date(clock),
          lastUsedAt: null,
          revokedAt: null,
        };
        keys.push(record);
        return record;
      },
      async updateMany({ where, data }) {
        const key = active(where.profileId).find((k) => k.id === where.id);
        if (!key) return { count: 0 };
        key.revokedAt = data.revokedAt;
        return { count: 1 };
      },
    },
    async $queryRaw(_query, ...values) {
      locks.push(String(values[0]));
      return [];
    },
    async $transaction(fn) {
      return fn(store);
    },
  };
  return { store, keys, locks };
}

async function rejectsWith(promise: Promise<unknown>, code: TRPCError['code'], message?: RegExp) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof TRPCError, `expected a TRPCError, got ${String(err)}`);
    assert.equal(err.code, code);
    if (message) assert.match(err.message, message);
    return true;
  });
}

test('create returns the full key once, and list shows only its prefix', async () => {
  const { store } = fakeStore();
  const created = await createAccountApiKey(ALICE, 'CI deploys', store);

  assert.match(created.key, API_KEY_PATTERN);
  assert.ok(created.key.startsWith(`${created.apiKey.prefix}_`));
  assert.equal(created.apiKey.name, 'CI deploys');

  const listed = await listAccountApiKeys(ALICE, store);
  assert.deepEqual(listed, [created.apiKey]);
  assert.ok(!JSON.stringify(listed).includes(created.key), 'the list must never carry the key');
  assert.ok(!('hash' in listed[0]!));
});

test('list is newest first and leaves out revoked keys', async () => {
  const { store } = fakeStore();
  const first = await createAccountApiKey(ALICE, 'first', store);
  const second = await createAccountApiKey(ALICE, 'second', store);
  const third = await createAccountApiKey(ALICE, 'third', store);
  await revokeAccountApiKey(ALICE, second.apiKey.id, store);

  const names = (await listAccountApiKeys(ALICE, store)).map((k) => k.name);
  assert.deepEqual(names, [third.apiKey.name, first.apiKey.name]);
});

test(`a sixth active key is refused, and nothing is created`, async () => {
  const { store, keys } = fakeStore();
  for (let i = 0; i < MAX_ACTIVE_API_KEYS; i++) await createAccountApiKey(ALICE, `key ${i}`, store);

  await rejectsWith(
    createAccountApiKey(ALICE, 'one too many', store),
    'FORBIDDEN',
    /5 active API keys/,
  );
  assert.equal(keys.length, MAX_ACTIVE_API_KEYS);
});

test('a revoked key frees its slot', async () => {
  const { store } = fakeStore();
  const made = [];
  for (let i = 0; i < MAX_ACTIVE_API_KEYS; i++)
    made.push(await createAccountApiKey(ALICE, `key ${i}`, store));
  await revokeAccountApiKey(ALICE, made[0]!.apiKey.id, store);

  const replacement = await createAccountApiKey(ALICE, 'replacement', store);
  assert.equal(replacement.apiKey.name, 'replacement');
});

test('the limit is per profile', async () => {
  const { store } = fakeStore();
  for (let i = 0; i < MAX_ACTIVE_API_KEYS; i++) await createAccountApiKey(ALICE, `key ${i}`, store);
  await createAccountApiKey(BOB, 'bob has room', store);
});

test('create locks the profile row before counting', async () => {
  const { store, locks } = fakeStore();
  await createAccountApiKey(ALICE, 'locked', store);
  assert.deepEqual(locks, ['profile-alice']);
});

test("one profile cannot revoke, or confirm the existence of, another's key", async () => {
  const { store } = fakeStore();
  const bobs = await createAccountApiKey(BOB, 'bob', store);

  await rejectsWith(revokeAccountApiKey(ALICE, bobs.apiKey.id, store), 'NOT_FOUND');
  await rejectsWith(revokeAccountApiKey(ALICE, 'key-404', store), 'NOT_FOUND');
  assert.equal((await listAccountApiKeys(BOB, store)).length, 1);
});

test('revoking twice is not found the second time', async () => {
  const { store } = fakeStore();
  const made = await createAccountApiKey(ALICE, 'once', store);
  await revokeAccountApiKey(ALICE, made.apiKey.id, store);
  await rejectsWith(revokeAccountApiKey(ALICE, made.apiKey.id, store), 'NOT_FOUND');
});

test('a wallet without a profile is told why, for every operation', async () => {
  const { store } = fakeStore();
  await rejectsWith(listAccountApiKeys(NOBODY, store), 'PRECONDITION_FAILED', /profile/);
  await rejectsWith(createAccountApiKey(NOBODY, 'x', store), 'PRECONDITION_FAILED', /profile/);
  await rejectsWith(revokeAccountApiKey(NOBODY, 'key-1', store), 'PRECONDITION_FAILED', /profile/);
});

test('without a database every operation is refused the same way', async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    await rejectsWith(listAccountApiKeys(ALICE), 'PRECONDITION_FAILED', /profile/);
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
});

test('key names are trimmed, required, and bounded', () => {
  assert.deepEqual(normalizeApiKeyName({ name: '  CI  ' }), { name: 'CI' });
  assert.throws(() => normalizeApiKeyName({ name: '   ' }), TRPCError);
  assert.throws(() => normalizeApiKeyName({}), TRPCError);
  assert.throws(() => normalizeApiKeyName({ name: 'x'.repeat(65) }), TRPCError);
  assert.deepEqual(normalizeApiKeyName({ name: 'x'.repeat(64) }), { name: 'x'.repeat(64) });
  assert.throws(() => apiKeyIdInput({ id: '' }), TRPCError);
});
