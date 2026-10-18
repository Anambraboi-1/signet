import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Address, Keypair, xdr } from '@stellar/stellar-sdk';
import { classifyLedgerKey, isOwnStateWrite, normaliseFootprint } from './normalise.ts';
import {
  CLAIM_WALLET_SIGNER,
  TESTNET_REGISTRY,
  claimFixture,
  countFixture,
  transferFixture,
} from './testnet-fixtures.ts';

// ── the registry claim: own-data write plus an auth nonce ──────────────────
//
// Captured from a real testnet claim whose wallet was deliberately a
// non-source signer, so `require_auth` minted a nonce entry into the
// declared write footprint. The whole point of #509: that entry is
// authentication bookkeeping, not write evidence.

test('the claim fixture declares a nonce in readWrite, and normalise drops it', () => {
  const rawKinds = claimFixture.readWrite.map(
    (raw) => classifyLedgerKey(raw, claimFixture.contract).kind,
  );
  assert.ok(rawKinds.includes('auth-nonce'), `captured readWrite lacks the nonce: ${rawKinds}`);
  assert.ok(rawKinds.includes('own-data'), `captured readWrite lacks own-data: ${rawKinds}`);

  const observation = normaliseFootprint(claimFixture);
  const kinds = observation.readWrite.map((ref) => ref.kind);
  assert.ok(!kinds.includes('auth-nonce'), `nonce survived into write evidence: ${kinds}`);
  assert.ok(kinds.includes('own-data'), 'the real state write must survive the cleaning');
  assert.ok(kinds.includes('own-instance'), 'the instance entry is classified, not dropped');
  assert.ok(
    observation.changed?.every((ref) => ref.kind !== 'auth-nonce'),
    'the nonce is dropped from changed too',
  );
  // The strong signal survives: meta says contract data actually changed.
  assert.ok(observation.changed?.some(isOwnStateWrite));
});

test("the claim nonce's owner is the signing wallet, not the contract", () => {
  const nonce = claimFixture.readWrite
    .map((raw) => classifyLedgerKey(raw, claimFixture.contract))
    .find((ref) => ref.kind === 'auth-nonce');
  assert.ok(nonce);
  assert.equal(nonce.owner, CLAIM_WALLET_SIGNER);
  assert.notEqual(nonce.owner, TESTNET_REGISTRY);
});

// ── the count() simulation: a pure read ────────────────────────────────────

test('the count simulation is 2 read-only, 0 read-write, per design §1', () => {
  const observation = normaliseFootprint(countFixture);
  assert.equal(observation.readOnly.length, 2);
  assert.equal(observation.readWrite.length, 0);
  assert.deepEqual(
    observation.readOnly.map((ref) => ref.kind).sort(),
    ['own-code', 'own-instance'],
  );
  assert.equal(observation.changed, undefined);
});

// ── the SAC transfer: classic entries, not contract data ───────────────────

test('the token transfer writes trustlines, and they classify as such', () => {
  const observation = normaliseFootprint(transferFixture);
  assert.ok(observation.readWrite.some((ref) => ref.kind === 'trustline'));
  // A SAC moving an issued asset writes no contract-data of its own: the
  // balances live in classic trustlines. Nothing here is own-state write
  // evidence, which is exactly what a mutability classifier must see.
  assert.ok(observation.changed?.some((ref) => ref.kind === 'trustline'));
  for (const ref of observation.readWrite) {
    if (ref.kind === 'trustline') {
      assert.match(ref.owner ?? '', /^G[A-Z2-7]{55}$/);
    }
  }
});

// ── classification unit cases the fixtures cannot cover ────────────────────

function contractDataKey(contract: string, key: xdr.ScVal): string {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(contract).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    }),
  ).toXDR('base64');
}

const OTHER_CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

test("another contract's entries classify as foreign", () => {
  const data = contractDataKey(OTHER_CONTRACT, xdr.ScVal.scvSymbol('S'));
  assert.equal(classifyLedgerKey(data, TESTNET_REGISTRY).kind, 'foreign-contract-data');

  const instance = contractDataKey(OTHER_CONTRACT, xdr.ScVal.scvLedgerKeyContractInstance());
  assert.equal(classifyLedgerKey(instance, TESTNET_REGISTRY).kind, 'foreign-contract-instance');
});

test('a nonce is a nonce whoever it is keyed by — the check precedes the own/foreign split', () => {
  // A non-source signer's nonce is keyed by the SIGNER's address. If the
  // own/foreign split ran first, this would classify as foreign-contract-data
  // and survive into write evidence.
  const signer = Keypair.random().publicKey();
  const nonce = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(signer).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyNonce(
        new xdr.ScNonceKey({ nonce: new xdr.Int64(1234) }),
      ),
      durability: xdr.ContractDataDurability.temporary(),
    }),
  ).toXDR('base64');

  const ref = classifyLedgerKey(nonce, TESTNET_REGISTRY);
  assert.equal(ref.kind, 'auth-nonce');
  assert.equal(ref.owner, signer);
});

test('an undecodable key classifies as other instead of throwing', () => {
  const ref = classifyLedgerKey('definitely-not-xdr', TESTNET_REGISTRY);
  assert.equal(ref.kind, 'other');
  assert.equal(ref.raw, 'definitely-not-xdr');
});

test('normalise preserves provenance and leaves readOnly nonce-intact', () => {
  const observation = normaliseFootprint(claimFixture);
  assert.equal(observation.txHash, claimFixture.txHash);
  assert.equal(observation.contract, TESTNET_REGISTRY);
  assert.equal(observation.function, 'claim');
  assert.equal(observation.wasmHash, null);
  // Raw keys ride along on every ref, so a consumer can always go back to
  // the stored row.
  for (const ref of [...observation.readOnly, ...observation.readWrite]) {
    assert.equal(typeof ref.raw, 'string');
    assert.ok(ref.raw.length > 0);
  }
});
