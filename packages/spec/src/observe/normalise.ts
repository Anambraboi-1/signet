/**
 * @file packages/spec/src/observe/normalise.ts
 *
 * Raw footprints into [`FootprintObservation`]s (#509). #417 stores the
 * declared footprint and the meta-reported changes as base64 `LedgerKey`
 * XDR, verbatim; consumers run this at read time, so the stored rows stay
 * raw provenance and the cleaning rules can evolve without a backfill.
 *
 * The cleaning that matters: a `require_auth` from a non-source signer puts
 * a nonce `ContractData` entry — keyed by the *signer's* address — into
 * `readWrite`. The contract's own instance and code entries are always
 * present. None of that is "this function writes the contract's state", so
 * nonces are dropped from write evidence and every key is classified so the
 * classifier (#510) can weigh the rest.
 */

import { Address, StrKey, xdr } from '@stellar/stellar-sdk';
import type { FootprintObservation, LedgerKeyKind, LedgerKeyRef, ObservationSource } from './types.ts';

/**
 * Decode one stored base64 `LedgerKey` and say what it refers to, from
 * `ownContract`'s point of view.
 *
 * A key that does not parse is classified `other` rather than thrown on:
 * the rows are historical captures, and one undecodable key must not make a
 * whole contract's observations unreadable.
 */
export function classifyLedgerKey(raw: string, ownContract: string): LedgerKeyRef {
  let key: xdr.LedgerKey;
  try {
    key = xdr.LedgerKey.fromXDR(raw, 'base64');
  } catch {
    return { raw, kind: 'other' };
  }

  switch (key.switch().name) {
    case 'contractData': {
      const data = key.contractData();
      const owner = addressToString(data.contract());
      const keyKind = data.key().switch().name;

      // The nonce check comes first: the nonce entry's address is the
      // SIGNER, not the contract, so an own/foreign split before this test
      // would file a non-source signer's nonce under `foreign-contract-data`
      // and keep it as write evidence — the exact bug this module removes.
      if (keyKind === 'scvLedgerKeyNonce') {
        return { raw, kind: 'auth-nonce', owner };
      }
      const own = owner === ownContract;
      if (keyKind === 'scvLedgerKeyContractInstance') {
        return { raw, kind: own ? 'own-instance' : 'foreign-contract-instance', owner };
      }
      return { raw, kind: own ? 'own-data' : 'foreign-contract-data', owner };
    }
    case 'contractCode':
      // A code key carries only the WASM hash — which executable, not whose.
      // In a single observation it is the code the call ran, so it files
      // under the contract's own executable rather than growing a
      // foreign-code kind nothing would consume.
      return { raw, kind: 'own-code' };
    case 'account':
      return { raw, kind: 'account', owner: accountToString(key.account().accountId()) };
    case 'trustline':
      return { raw, kind: 'trustline', owner: accountToString(key.trustLine().accountId()) };
    default:
      return { raw, kind: 'other' };
  }
}

/** What a raw capture looks like: #417's row, or a sandbox run's record. */
export interface RawFootprint {
  readonly contract: string;
  readonly function: string | null;
  readonly source: ObservationSource;
  readonly ledger: number;
  readonly txHash?: string;
  readonly sandboxRun?: { readonly seeded: boolean; readonly wasmHash: string };
  readonly wasmHash?: string | null;
  /** Base64 `LedgerKey`s, exactly as stored. */
  readonly readOnly: readonly string[];
  readonly readWrite: readonly string[];
  /** Meta-reported modified keys; null/absent when meta was unavailable. */
  readonly changed?: readonly string[] | null;
  readonly successful: boolean;
}

/**
 * Normalise one raw capture: classify every key, and drop `auth-nonce`
 * entries from the write evidence (`readWrite` and `changed`) — a nonce
 * write is authentication bookkeeping, never a state change the function
 * made. `readOnly` keeps its nonces, classified, so nothing is hidden from
 * a consumer that cares about auth shape.
 */
export function normaliseFootprint(rawFootprint: RawFootprint): FootprintObservation {
  const classify = (keys: readonly string[]): LedgerKeyRef[] =>
    keys.map((raw) => classifyLedgerKey(raw, rawFootprint.contract));
  const dropNonces = (refs: LedgerKeyRef[]): LedgerKeyRef[] =>
    refs.filter((ref) => ref.kind !== 'auth-nonce');

  return {
    contract: rawFootprint.contract,
    function: rawFootprint.function,
    source: rawFootprint.source,
    ledger: rawFootprint.ledger,
    ...(rawFootprint.txHash !== undefined && { txHash: rawFootprint.txHash }),
    ...(rawFootprint.sandboxRun !== undefined && { sandboxRun: rawFootprint.sandboxRun }),
    wasmHash: rawFootprint.wasmHash ?? null,
    readOnly: classify(rawFootprint.readOnly),
    readWrite: dropNonces(classify(rawFootprint.readWrite)),
    ...(rawFootprint.changed != null && { changed: dropNonces(classify(rawFootprint.changed)) }),
    successful: rawFootprint.successful,
  };
}

/** The kinds that count as evidence the function writes the contract's own state. */
export function isOwnStateWrite(ref: LedgerKeyRef): boolean {
  return ref.kind === 'own-data' || ref.kind === 'own-instance';
}

function addressToString(address: xdr.ScAddress): string {
  try {
    return Address.fromScAddress(address).toString();
  } catch {
    return '';
  }
}

function accountToString(accountId: xdr.AccountId): string {
  try {
    return StrKey.encodeEd25519PublicKey(accountId.ed25519());
  } catch {
    return '';
  }
}
