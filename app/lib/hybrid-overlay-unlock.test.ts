import assert from 'node:assert/strict'
import test from 'node:test'

import { dedupeOverlayParents } from '@/app/lib/beef-cache'
import {
  classifyBulkSpentRow,
  LOCK_LIKE_MINT_LOCK_VOUT,
  normalizeUnlockCandidates,
} from '@/app/lib/unlockCoins'

const TXID_A = 'a'.repeat(64)
const TXID_B = 'b'.repeat(64)
const TXID_C = 'c'.repeat(64)

test('normalizeUnlockCandidates always uses the parallel lock vout', () => {
  assert.deepEqual(
    normalizeUnlockCandidates([
      TXID_A.toUpperCase(),
      { txid: TXID_B },
      { txid: TXID_C },
      { txid: 'not-a-txid' },
    ]),
    [
      { txid: TXID_A, vout: LOCK_LIKE_MINT_LOCK_VOUT },
      { txid: TXID_B, vout: LOCK_LIKE_MINT_LOCK_VOUT },
      { txid: TXID_C, vout: LOCK_LIKE_MINT_LOCK_VOUT },
    ]
  )
})

test('dedupeOverlayParents trims invalid and duplicate parent BEEFs', () => {
  assert.deepEqual(
    dedupeOverlayParents([
      { originId: ' token_0 ', txid: TXID_A.toUpperCase() },
      { originId: 'token_0', txid: TXID_A },
      { originId: '', txid: TXID_B },
      { originId: 'token_0', txid: 'bad' },
      { originId: 'token_0', txid: TXID_C },
    ]),
    [
      { originId: 'token_0', txid: TXID_A },
      { originId: 'token_0', txid: TXID_C },
    ]
  )
})

test('classifyBulkSpentRow accepts clear bulk spent and unspent responses', () => {
  assert.deepEqual(
    classifyBulkSpentRow(TXID_A, {
      utxo: { txid: TXID_A, vout: 2 },
      error: '',
    }),
    { status: 'unspent' }
  )

  assert.deepEqual(
    classifyBulkSpentRow(TXID_A, {
      utxo: { txid: TXID_A, vout: 2 },
      spentIn: { txid: TXID_B, vin: 0, status: 'confirmed' },
      error: '',
    }),
    { status: 'spent', spendingTxid: TXID_B }
  )
})

test('classifyBulkSpentRow flags malformed or errored rows for individual fallback', () => {
  assert.deepEqual(classifyBulkSpentRow(TXID_A, null), { status: 'unknown' })
  assert.deepEqual(
    classifyBulkSpentRow(TXID_A, {
      utxo: { txid: TXID_A, vout: 2 },
      error: 'lookup failed',
    }),
    { status: 'unknown' }
  )
  assert.deepEqual(
    classifyBulkSpentRow(TXID_A, {
      utxo: { txid: TXID_A, vout: 2 },
      spentIn: { txid: 'invalid' },
      error: '',
    }),
    { status: 'unknown' }
  )
})
