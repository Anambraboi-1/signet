/**
 * API key issuance for the dashboard (#652), on top of the key primitives in
 * `lib/api-keys.ts` (#651).
 *
 * A key belongs to the profile of the signed-in wallet, so every operation
 * starts by resolving that wallet's profile. A wallet without a profile row
 * (no database, or a claim the indexer hasn't synced — `editable: false` in
 * `getAccount`) cannot hold keys, and is refused with an explanation rather
 * than an empty list.
 *
 * Errors are `TRPCError`s with messages written for the dashboard: these
 * functions back `account.apiKeys.*` and nothing else.
 */

import { TRPCError } from '@trpc/server';
import { API_KEY_PREFIX } from '@signet/types';
import { createApiKey, type ApiKeyRecord, type ApiKeyStore } from '../api-keys.ts';

/** Active (unrevoked) keys a profile may hold at once. */
export const MAX_ACTIVE_API_KEYS = 5;

/** Longest key name accepted, after trimming. */
export const MAX_API_KEY_NAME = 64;

/** What the dashboard lists for a key. Never the key or its hash. */
export interface ApiKeySummary {
  id: string;
  name: string;
  /** The key's public identifier as it appears at the start of the key: `sgk_ab12cd34`. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** A just-created key: the full key, shown once, and its summary. */
export interface CreatedApiKey {
  key: string;
  apiKey: ApiKeySummary;
}

/**
 * The slice of the Prisma client these functions touch, so tests can inject a
 * fake (the same pattern as `pairing.ts`'s `PairingStore`).
 */
export interface AccountApiKeyStore {
  wallet: {
    findUnique(args: {
      where: { pubkey: string };
      select: { profileId: true };
    }): Promise<{ profileId: string } | null>;
  };
  apiKey: {
    findMany(args: {
      where: { profileId: string; revokedAt: null };
      orderBy: { createdAt: 'desc' };
    }): Promise<ApiKeyRecord[]>;
    count(args: { where: { profileId: string; revokedAt: null } }): Promise<number>;
    create(args: {
      data: { profileId: string; name: string; prefix: string; hash: string };
    }): Promise<ApiKeyRecord>;
    updateMany(args: {
      where: { id: string; profileId: string; revokedAt: null };
      data: { revokedAt: Date };
    }): Promise<{ count: number }>;
  };
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $transaction<T>(fn: (tx: AccountApiKeyStore) => Promise<T>): Promise<T>;
}

async function getStore(): Promise<AccountApiKeyStore | null> {
  if (!process.env.DATABASE_URL) return null;
  const { prisma } = await import('@signet/db');
  return prisma as unknown as AccountApiKeyStore;
}

const NO_PROFILE =
  'API keys belong to a profile, and this wallet has none yet. Claim a handle, then come back once it has synced.';

/** The store and the signed-in wallet's profile id, or a refusal. */
async function profileFor(
  address: string,
  store: AccountApiKeyStore | null,
): Promise<{ db: AccountApiKeyStore; profileId: string }> {
  const db = store ?? (await getStore());
  if (!db) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: NO_PROFILE });
  const wallet = await db.wallet.findUnique({
    where: { pubkey: address },
    select: { profileId: true },
  });
  if (!wallet) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: NO_PROFILE });
  return { db, profileId: wallet.profileId };
}

function summarize(record: ApiKeyRecord): ApiKeySummary {
  return {
    id: record.id,
    name: record.name,
    prefix: `${API_KEY_PREFIX}${record.prefix}`,
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
  };
}

/** Validates a key name for `account.apiKeys.create`: trimmed, 1–64 characters. */
export function normalizeApiKeyName(raw: unknown): { name: string } {
  const name = String((raw as { name?: unknown })?.name ?? '').trim();
  if (!name) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Give the key a name.' });
  if (name.length > MAX_API_KEY_NAME) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Key names are at most ${MAX_API_KEY_NAME} characters.`,
    });
  }
  return { name };
}

/** Validates the key id for `account.apiKeys.revoke`. */
export function apiKeyIdInput(raw: unknown): { id: string } {
  const id = String((raw as { id?: unknown })?.id ?? '');
  if (!id || id.length > 64)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid key id' });
  return { id };
}

/** The signed-in profile's active keys, newest first. */
export async function listAccountApiKeys(
  address: string,
  store: AccountApiKeyStore | null = null,
): Promise<ApiKeySummary[]> {
  const { db, profileId } = await profileFor(address, store);
  const keys = await db.apiKey.findMany({
    where: { profileId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  return keys.map(summarize);
}

/**
 * Creates a key for the signed-in profile, refusing a sixth active one.
 *
 * The count and the insert run in one transaction that first locks the
 * profile row, so two creates racing from the same profile (a double click,
 * two tabs) are serialised: the second sees the first's key in its count
 * instead of both seeing four and ending at six.
 */
export async function createAccountApiKey(
  address: string,
  name: string,
  store: AccountApiKeyStore | null = null,
): Promise<CreatedApiKey> {
  const { db, profileId } = await profileFor(address, store);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Profile" WHERE "id" = ${profileId} FOR UPDATE`;
    const active = await tx.apiKey.count({ where: { profileId, revokedAt: null } });
    if (active >= MAX_ACTIVE_API_KEYS) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `You already have ${MAX_ACTIVE_API_KEYS} active API keys. Revoke one before creating another.`,
      });
    }
    const keys: Pick<ApiKeyStore, 'create'> = {
      create: (data) => tx.apiKey.create({ data }),
    };
    const { key, record } = await createApiKey(profileId, name, keys as ApiKeyStore);
    return { key, apiKey: summarize(record) };
  });
}

/**
 * Revokes one of the signed-in profile's keys. A key that is already revoked,
 * does not exist, or belongs to another profile gets the same "not found", so
 * this can't be used to learn whether someone else's key id exists.
 */
export async function revokeAccountApiKey(
  address: string,
  id: string,
  store: AccountApiKeyStore | null = null,
): Promise<{ id: string }> {
  const { db, profileId } = await profileFor(address, store);
  const { count } = await db.apiKey.updateMany({
    where: { id, profileId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count !== 1) throw new TRPCError({ code: 'NOT_FOUND', message: 'API key not found' });
  return { id };
}
