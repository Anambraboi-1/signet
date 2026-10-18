/**
 * @file packages/spec/src/observe/testnet-fixtures.ts
 *
 * Footprints captured from real Stellar testnet transactions (#509), raw
 * base64 `LedgerKey`s exactly as #417 stores them. Captured 2026-10-18 via
 * soroban-testnet.stellar.org; every transaction is live on testnet under
 * its hash, so each fixture is checkable against the chain, not asserted.
 *
 * - `claimFixture`: `claim('fxmvdl7dld', wallet)` on the deployed Identity
 *   Registry, with the wallet deliberately a NON-source signer
 *   (GAKCCJKXJ3YYX6Y3E3Z2NDUKKYMFF7I37J5KSR4VNBFHB4FKQHRIAMOA), so `require_auth`
 *   minted a signature nonce into `readWrite` - the exact entry #509 exists
 *   to drop from write evidence. Tx
 *   58e3133e87828eea21e89e0e6d6fc9007525840059817e0dd3c43b50a5c7ffa4.
 * - `countFixture`: `simulateTransaction` of `count()` from a fresh keypair -
 *   2 read-only entries, 0 read-write, the numbers
 *   CONTRACT_VISUALISER_DESIGN.md paragraph 1 reasons from.
 * - `transferFixture`: an issued-asset SAC `transfer` (asset
 *   `FIX:GDHNAWM4...`), whose write
 *   footprint is the two parties' TRUSTLINE entries. Tx
 *   27de3d0f0eb72683fcd08bb69b6cd55ea21245d25a4f61c8972d01300e455f55.
 */

import type { RawFootprint } from './normalise.ts';

/** The deployed Identity Registry on testnet the claim/count fixtures ran against. */
export const TESTNET_REGISTRY = 'CASFJHI5PQSRWS7JV25CF7FOMRKIVBP3RXRP3E2GH2CV4BCAG7FUJRCN';

/** The wallet that signed the claim's auth entry (not the tx source). */
export const CLAIM_WALLET_SIGNER = 'GAKCCJKXJ3YYX6Y3E3Z2NDUKKYMFF7I37J5KSR4VNBFHB4FKQHRIAMOA';

export const claimFixture: RawFootprint = {
  contract: TESTNET_REGISTRY,
  function: 'claim',
  source: 'transaction',
  ledger: 5257992,
  txHash: '58e3133e87828eea21e89e0e6d6fc9007525840059817e0dd3c43b50a5c7ffa4',
  readOnly: [
    'AAAAAAAAAAAUISVXTvGL+xsm86aOilYYUv0b+nqpR5VoSnDwqoHigA==',
    'AAAAB5NplsdLfTg8VuwXSFexWSfN0pR4xpCdozK03si2czX+',
  ],
  readWrite: [
    'AAAABgAAAAAAAAAAFCElV07xi/sbJvOmjopWGFL9G/p6qUeVaEpw8KqB4oAAAAAVOYp0dc+ZxkgAAAAA',
    'AAAABgAAAAEkVJ0dfCUbS+muuiL8rmRUioX7jeL9k0Y+hV4EQDfLRAAAABAAAAABAAAAAgAAAA8AAAAGSGFuZGxlAAAAAAASAAAAAAAAAAAUISVXTvGL+xsm86aOilYYUv0b+nqpR5VoSnDwqoHigAAAAAE=',
    'AAAABgAAAAEkVJ0dfCUbS+muuiL8rmRUioX7jeL9k0Y+hV4EQDfLRAAAABAAAAABAAAAAgAAAA8AAAAFT3duZXIAAAAAAAAOAAAACmZ4bXZkbDdkbGQAAAAAAAE=',
    'AAAABgAAAAEkVJ0dfCUbS+muuiL8rmRUioX7jeL9k0Y+hV4EQDfLRAAAABQAAAAB',
  ],
  changed: [
    'AAAABgAAAAEkVJ0dfCUbS+muuiL8rmRUioX7jeL9k0Y+hV4EQDfLRAAAABQAAAAB',
    'AAAACe+mTTu/Yl527okxOz3vVhLUHGAFhZZZtOQWl2QVaCM4',
    'AAAABgAAAAEkVJ0dfCUbS+muuiL8rmRUioX7jeL9k0Y+hV4EQDfLRAAAABAAAAABAAAAAgAAAA8AAAAGSGFuZGxlAAAAAAASAAAAAAAAAAAUISVXTvGL+xsm86aOilYYUv0b+nqpR5VoSnDwqoHigAAAAAE=',
    'AAAACT+ZI7zxMDcBjtL3GbPFyWcfYw9PicuvK5Z66i9pgyfD',
    'AAAABgAAAAEkVJ0dfCUbS+muuiL8rmRUioX7jeL9k0Y+hV4EQDfLRAAAABAAAAABAAAAAgAAAA8AAAAFT3duZXIAAAAAAAAOAAAACmZ4bXZkbDdkbGQAAAAAAAE=',
    'AAAACdVpD8KsnfcOkk93jDN1lTUYgZEA4ncqCRvSMV90yiD5',
    'AAAABgAAAAAAAAAAFCElV07xi/sbJvOmjopWGFL9G/p6qUeVaEpw8KqB4oAAAAAVOYp0dc+ZxkgAAAAA',
    'AAAAAAAAAAAYoatIoo4mAQ8TXAZidCVXYIHWkl4HcuCLMyCrzsfk8g==',
  ],
  successful: true,
};

export const countFixture: RawFootprint = {
  contract: TESTNET_REGISTRY,
  function: 'count',
  // A simulation has no transaction hash; the ledger is the one the RPC
  // simulated against.
  source: 'transaction',
  ledger: 5257995,
  readOnly: [
    'AAAABgAAAAEkVJ0dfCUbS+muuiL8rmRUioX7jeL9k0Y+hV4EQDfLRAAAABQAAAAB',
    'AAAAB5NplsdLfTg8VuwXSFexWSfN0pR4xpCdozK03si2czX+',
  ],
  readWrite: [],
  successful: true,
};

/** The FIX:GDHNAWM4... SAC the transfer ran through. */
export const TRANSFER_SAC = 'CAMLJTCQIQOBKIXQAPFTVOZAJ2A3M6Q25ZL6MF5TXKWGATVCSI436BAA';

export const transferFixture: RawFootprint = {
  contract: TRANSFER_SAC,
  function: 'transfer',
  source: 'transaction',
  ledger: 5258006,
  txHash: '27de3d0f0eb72683fcd08bb69b6cd55ea21245d25a4f61c8972d01300e455f55',
  readOnly: [
    'AAAABgAAAAEYtMxQRBwVIvADyzq7IE6Btnoa7lfmF7O6rGBOopI5vwAAABQAAAAB',
  ],
  readWrite: [
    'AAAAAQAAAAB4uO2zrZLj3TwTY+NiIdZMz7+2zl+rFHJqarAXlRxt9QAAAAFGSVgAAAAAAM7QWZzfhQsAS6L9WsO4RM1hILI+hvv8fqnVQMZnfipx',
  ],
  changed: [
    'AAAAAQAAAAB4uO2zrZLj3TwTY+NiIdZMz7+2zl+rFHJqarAXlRxt9QAAAAFGSVgAAAAAAM7QWZzfhQsAS6L9WsO4RM1hILI+hvv8fqnVQMZnfipx',
    'AAAAAAAAAAB4uO2zrZLj3TwTY+NiIdZMz7+2zl+rFHJqarAXlRxt9Q==',
  ],
  successful: true,
};
