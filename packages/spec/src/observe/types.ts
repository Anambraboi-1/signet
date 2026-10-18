/**
 * @file packages/spec/src/observe/types.ts
 *
 * The one shape every observed execution arrives in (#509). Phase 2 marks
 * which functions change state; the spec cannot say this
 * (CONTRACT_VISUALISER_DESIGN.md §1.2), so it comes from the footprints and
 * ledger changes of real transactions (captured by #417's invocation worker)
 * and of local `signet dev` / `signet sandbox call` runs (#542). Both sources
 * normalise into a [`FootprintObservation`], so the mutability classifier
 * (#510) consumes one stream rather than two.
 */

/**
 * What one ledger key in a footprint actually refers to, from the observed
 * contract's point of view.
 *
 * The distinction that matters most is `auth-nonce`: a `require_auth` from a
 * non-source signer puts a nonce `ContractData` entry — keyed by the
 * *signer's* address, not the contract's — into `readWrite`. That is
 * authentication bookkeeping, not "this function writes the contract's
 * state", and counting it as write evidence would mark every authenticated
 * read-only call a mutator.
 */
export type LedgerKeyKind =
  /** The observed contract's own instance entry. Present on every call. */
  | 'own-instance'
  /** A storage entry belonging to the observed contract. */
  | 'own-data'
  /** A contract-code (WASM) entry. Present on every call. */
  | 'own-code'
  /** A signature nonce minted by `require_auth` for a non-source signer. */
  | 'auth-nonce'
  /** Another contract's instance entry (a cross-contract call's target). */
  | 'foreign-contract-instance'
  /** Another contract's storage entry. */
  | 'foreign-contract-data'
  /** A classic account entry (e.g. the native SAC moving XLM). */
  | 'account'
  /** A classic trustline entry (an issued-asset SAC moving balances). */
  | 'trustline'
  /** Anything else (TTL keys, claimable balances, future entry types). */
  | 'other';

/** One footprint entry, classified, with the raw key kept for provenance. */
export interface LedgerKeyRef {
  /** The base64 `LedgerKey` XDR exactly as stored by #417. */
  readonly raw: string;
  readonly kind: LedgerKeyKind;
  /**
   * The address the key is scoped to, where one exists: the contract (`C…`)
   * of a contract-data/instance key, the account (`G…`) of an account,
   * trustline or auth-nonce key.
   */
  readonly owner?: string;
}

/** Where an observation came from. */
export type ObservationSource = 'transaction' | 'sandbox';

/**
 * One observed execution, normalised. `changed` is the strong signal — the
 * entries a transaction's meta says were actually modified — where
 * `readWrite` is only *declared* write access: a footprint may reserve write
 * access it never uses, but meta cannot claim a change that did not happen.
 */
export interface FootprintObservation {
  /** The observed contract (`C…`). */
  readonly contract: string;
  /** Invoked function, when known (a sub-call target may not know it). */
  readonly function: string | null;
  readonly source: ObservationSource;
  readonly ledger: number;
  /** Transaction hash for `source: 'transaction'`. */
  readonly txHash?: string;
  /** Sandbox run detail for `source: 'sandbox'`. */
  readonly sandboxRun?: { readonly seeded: boolean; readonly wasmHash: string };
  /** The contract's executable hash at observation time, when known. */
  readonly wasmHash: string | null;
  readonly readOnly: readonly LedgerKeyRef[];
  /**
   * Declared write access, with `auth-nonce` entries already dropped — they
   * are never evidence that the function writes contract state.
   */
  readonly readWrite: readonly LedgerKeyRef[];
  /**
   * Entries actually modified according to transaction meta, when meta was
   * available. Stronger than `readWrite`; `auth-nonce` entries dropped here
   * too.
   */
  readonly changed?: readonly LedgerKeyRef[];
  readonly successful: boolean;
}
