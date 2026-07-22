import { bsv } from 'scrypt-ts';

/** Unlock: fee = ceil(txSizeBytes / 1000) * FEE_PER_KB (100 sats per KB, rounded up). */
const FEE_PER_KB = 100;

function unlockFeeSatoshis(byteLength: number): number {
    return Math.ceil(byteLength / 1000) * FEE_PER_KB;
}

/**
 * 0-based index of the gated-lock output on `LockLikeMintBSV21Parallel.mint` txs.
 * That is “output #3” in human counting (vout 0 = first output).
 * WOC: GET …/tx/<txid>/<this>/confirmed/spent → 404 means still unspent.
 */
export const LOCK_LIKE_MINT_LOCK_VOUT = 2;

const normalizeTxid = (txid: string): string => txid.trim().toLowerCase();

function hex2Int(hex: string): number {
    const bigEndian = hex.match(/.{2}/g)?.reverse().join('') || hex;
    return parseInt(bigEndian, 16);
}

const getUTXO = (rawtx: string, oIdx: number = 0) => {
    const tx = new bsv.Transaction(rawtx);
    const output = tx.outputs[oIdx];
    return {
        satoshis: output.satoshis,
        script: output.script.toHex(),
        txid: tx.hash,
        vout: oIdx
    };
};

const unlockLockScript = (
    txHex: string, 
    inputIndex: number, 
    lockTokenScript: string, 
    satoshis: number, 
    privkey: InstanceType<typeof bsv.PrivateKey>
): string => {
    const tx = new bsv.Transaction(txHex);
    const sighashType = bsv.crypto.Signature.SIGHASH_ALL | bsv.crypto.Signature.SIGHASH_FORKID;
    const scriptCode = bsv.Script.fromHex(lockTokenScript);
    const value = new bsv.crypto.BN(satoshis);
    const preimg = bsv.Transaction.Sighash.sighashPreimage(
        tx, 
        sighashType, 
        inputIndex, 
        scriptCode, 
        value
    ).toString('hex');
    const signature = bsv.Transaction.Sighash.sign(
        tx, 
        privkey, 
        sighashType, 
        inputIndex, 
        scriptCode, 
        value
    ).toTxFormat();
    return bsv.Script.fromASM(
        `${signature.toString('hex')} ${privkey.toPublicKey().toHex()} ${preimg}`
    ).toHex();
};

const getRawtx = async (txid: string): Promise<string> => {
    const r = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}/hex`);
    return await r.text();
};

export const unlockCoins = async (
    pkWIF: string, 
    receiveAddress: string, 
    txid: string, 
    oIdx: number = LOCK_LIKE_MINT_LOCK_VOUT
): Promise<string> => {
    try {
        const rawtx = await getRawtx(txid);
        const lockedUTXO = getUTXO(rawtx, oIdx);
        const lockedScript = new bsv.Script(lockedUTXO.script);

        const lockedBlockHex = lockedScript.chunks[6].buf.toString('hex');
        const lockedBlock = hex2Int(lockedBlockHex);
        const privKey = bsv.PrivateKey.fromWIF(pkWIF);

        const estimatedBytes = 48 + 420 + 45;
        let fee = unlockFeeSatoshis(estimatedBytes);

        for (let attempt = 0; attempt < 4; attempt++) {
            if (fee >= lockedUTXO.satoshis) {
                throw new Error('Locked amount is too small to cover the network fee');
            }
            const sendValue = lockedUTXO.satoshis - fee;
            if (sendValue < 1) {
                throw new Error('Output would be below 1 satoshi after fee');
            }

            const bsvtx = new bsv.Transaction();
            bsvtx.addInput(
                new bsv.Transaction.Input({
                    prevTxId: txid,
                    outputIndex: oIdx,
                    script: bsv.Script.fromASM(''),
                }),
                lockedScript,
                lockedUTXO.satoshis
            );
            bsvtx.lockUntilBlockHeight(lockedBlock);
            bsvtx.to(receiveAddress, sendValue);

            const solution = unlockLockScript(
                bsvtx.toString(),
                0,
                lockedUTXO.script,
                lockedUTXO.satoshis,
                privKey
            );
            bsvtx.inputs[0].setScript(bsv.Script.fromHex(solution));
            const rawHex = bsvtx.toString();
            const required = unlockFeeSatoshis(rawHex.length / 2);
            if (fee >= required) {
                return rawHex;
            }
            fee = required;
        }

        throw new Error('Could not determine a sufficient fee for this unlock transaction');
    } catch (e) {
        console.error(e);
        throw e;
    }
}; 

export type BatchUnlockBuildDetails = {
    requestedTxids: number;
    fetchedTxDetails: number;
    inputCount: number;
    outputCount: number;
    includedTxids: string[];
    skippedTxids: string[];
    missingTxids: string[];
    unconfirmedTxids: string[];
    spentRows: Array<{ txid: string; spentTxid: string }>;
    spentTxids: string[];
    unknownOutpointTxids: string[];
    totalInputSatoshis: number;
    outputSatoshis: number;
    feeSatoshis: number;
    byteLength: number;
    maxLockHeight: number;
    txid: string;
};

export type BatchUnlockBuildResult = {
    rawtx: string | null;
    details: BatchUnlockBuildDetails;
};

export type BatchUnlockCandidate = {
    txid: string;
};

export function normalizeUnlockCandidates(
    candidates: Array<string | BatchUnlockCandidate>
): Array<{ txid: string; vout: number }> {
    return candidates
        .map((candidate): BatchUnlockCandidate => {
            if (typeof candidate === 'string') {
                return { txid: candidate };
            }
            return { txid: candidate.txid };
        })
        .map((candidate) => ({
            txid: normalizeTxid(candidate.txid),
            vout: LOCK_LIKE_MINT_LOCK_VOUT,
        }))
        .filter((candidate) => /^[0-9a-f]{64}$/.test(candidate.txid));
}

export type BatchUnlockProgressEvent =
    | {
          phase: 'fetch_complete';
          chunkIndex: number;
          chunkCount: number;
          fetchedTxids: number;
          totalTxids: number;
      }
    | {
          phase: 'spent_check_complete';
          chunkIndex: number;
          chunkCount: number;
          checkedOutpoints: number;
          totalOutpoints: number;
          vout?: number;
      }
    | {
          phase: 'inputs_ready';
          validInputs: number;
          skippedCount: number;
      }
    | {
          phase: 'signing_progress';
          signedInputs: number;
          inputCount: number;
      };

type WocTxDetailRow = {
    txid?: string;
    confirmations?: number;
    blockheight?: number;
    blockhash?: string;
    vout?: Array<{
        n?: number;
        value?: number | string;
        scriptPubKey?: { hex?: string };
    }>;
};

const isConfirmedTxDetail = (detail: unknown): boolean => {
    if (!detail || typeof detail !== 'object') {
        return false;
    }

    const d = detail as WocTxDetailRow;

    if (typeof d.confirmations === 'number') {
        return d.confirmations > 0;
    }

    if (typeof d.blockheight === 'number') {
        return d.blockheight > 0;
    }

    if (typeof d.blockhash === 'string') {
        return d.blockhash.trim().length > 0;
    }

    return false;
};

type SpentLookupResult = {
    spentRows: Array<{ txid: string; spentTxid: string }>;
    spentTxids: Set<string>;
    unknownOutpointTxids: Set<string>;
};

export type OutpointSpentState =
    | { status: 'spent'; spendingTxid: string }
    | { status: 'unspent' }
    | { status: 'unknown' };

/** Spending tx from bulk row `spentIn` (WOC shape). */
function extractBulkSpendingTxid(row: unknown): string | null {
    if (!row || typeof row !== 'object') return null
    const si = (row as { spentIn?: Record<string, unknown> }).spentIn
    if (!si || typeof si !== 'object') return null
    const raw = si.txid ?? si.hash ?? si.tx_hash
    if (typeof raw !== 'string' || !/^[0-9a-f]{64}$/i.test(raw)) return null
    return normalizeTxid(raw)
}

export function classifyBulkSpentRow(sourceTxid: string, row: unknown): OutpointSpentState {
    if (!row || typeof row !== 'object') return { status: 'unknown' }

    const candidate = row as {
        error?: unknown;
        spentIn?: unknown;
    };
    if (candidate.error !== '') return { status: 'unknown' }

    const spendingTxid = extractBulkSpendingTxid(row)
    if (spendingTxid && spendingTxid !== normalizeTxid(sourceTxid)) {
        return { status: 'spent', spendingTxid }
    }

    // WOC's bulk endpoint reports a confirmed unspent output as
    // { utxo: {...}, error: "" } with no spentIn field.
    if (candidate.spentIn === undefined || candidate.spentIn === null) {
        return { status: 'unspent' }
    }

    // A spentIn object without a usable txid is ambiguous and needs fallback.
    return { status: 'unknown' }
}

/**
 * Resolve ambiguous bulk rows through WOC GET …/confirmed/spent. Clear bulk
 * spent/unspent results return immediately and avoid an individual request.
 */
async function resolveOutpointSpentState(
    sourceTxid: string,
    vout: number,
    bulkRow: unknown
): Promise<{ state: OutpointSpentState; usedFallback: boolean }> {
    const src = normalizeTxid(sourceTxid)
    if (!/^[0-9a-f]{64}$/.test(src)) {
        return { state: { status: 'unknown' }, usedFallback: false }
    }

    const bulkState = classifyBulkSpentRow(src, bulkRow)
    if (bulkState.status !== 'unknown') {
        return { state: bulkState, usedFallback: false }
    }

    try {
        const r = await fetch(
            `/api/woc/tx-confirmed-spent?txid=${encodeURIComponent(src)}&vout=${vout}`,
            { cache: 'no-store' }
        )
        if (!r.ok) {
            return { state: { status: 'unknown' }, usedFallback: true }
        }
        const j = (await r.json()) as {
            spendingTxid?: string | null
            unspent?: boolean
        }
        if (j.unspent) {
            return { state: { status: 'unspent' }, usedFallback: true }
        }
        if (!j.spendingTxid) {
            return { state: { status: 'unknown' }, usedFallback: true }
        }
        const v = normalizeTxid(j.spendingTxid)
        if (!/^[0-9a-f]{64}$/.test(v) || v === src) {
            return { state: { status: 'unknown' }, usedFallback: true }
        }
        return {
            state: { status: 'spent', spendingTxid: v },
            usedFallback: true,
        }
    } catch {
        return { state: { status: 'unknown' }, usedFallback: true }
    }
}

// Fetch multiple transaction details via the local API proxy (WOC bulk endpoint)
const getTxsDetailsBulk = async (
    txids: string[],
    onProgress?: (event: BatchUnlockProgressEvent) => void
): Promise<WocTxDetailRow[]> => {
    // Chunk to a maximum of 20 txids per request as per WOC API limitation
    const chunks: string[][] = [];
    for (let i = 0; i < txids.length; i += 20) {
        chunks.push(txids.slice(i, i + 20));
    }
    const results: WocTxDetailRow[] = [];
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const r = await fetch('/api/woc/txs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ txids: chunk })
        });
        if (!r.ok) {
            const text = await r.text();
            throw new Error(`Failed fetching tx details: ${r.status} ${text}`);
        }
        const data = await r.json();
        if (Array.isArray(data)) {
            results.push(...data);
        }
        onProgress?.({
            phase: 'fetch_complete',
            chunkIndex: i + 1,
            chunkCount: chunks.length,
            fetchedTxids: Math.min(txids.length, (i + 1) * 20),
            totalTxids: txids.length,
        });
    }
    return results;
};

const getSpentOutpointsBulk = async (
    txids: string[],
    vout: number,
    onProgress?: (event: BatchUnlockProgressEvent) => void,
    progress?: {
        chunkOffset: number;
        chunkCount: number;
        checkedOffset: number;
        totalOutpoints: number;
    }
): Promise<SpentLookupResult> => {
    const chunks: string[][] = [];
    for (let i = 0; i < txids.length; i += 20) {
        chunks.push(txids.slice(i, i + 20));
    }

    const spentTxids = new Set<string>();
    const spentRows: Array<{ txid: string; spentTxid: string }> = [];
    const unknownOutpointTxids = new Set<string>();
    let individualFallbackCount = 0;

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const r = await fetch('/api/woc/utxos-spent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                utxos: chunk.map((txid) => ({ txid: normalizeTxid(txid), vout })),
            }),
        });

        if (!r.ok) {
            const text = await r.text();
            throw new Error(`Failed checking spent outpoints: ${r.status} ${text}`);
        }

        const data = await r.json();
        const rows = Array.isArray(data) ? data : [];
        const rowByOutpoint = new Map<string, unknown>();
        for (const row of rows) {
            const ut = row && typeof row === 'object' ? (row as { utxo?: { txid?: string } }).utxo?.txid : undefined;
            if (typeof ut === 'string' && /^[0-9a-f]{64}$/i.test(ut)) {
                rowByOutpoint.set(normalizeTxid(ut), row);
            }
        }

        const resolved = await Promise.all(chunk.map(async (requestedTxid) => {
            const normRequested = normalizeTxid(requestedTxid);
            const row = rowByOutpoint.get(normRequested);

            const sourceTxid =
                row &&
                typeof row === 'object' &&
                typeof (row as { utxo?: { txid?: string } }).utxo?.txid === 'string'
                    ? (row as { utxo: { txid: string } }).utxo.txid
                    : requestedTxid;

            const result = await resolveOutpointSpentState(sourceTxid, vout, row ?? null);
            return {
                normRequested,
                sourceTxid,
                ...result,
            };
        }));

        for (const result of resolved) {
            if (result.usedFallback) individualFallbackCount += 1;
            if (result.state.status === 'unknown') {
                unknownOutpointTxids.add(result.normRequested);
                continue;
            }
            if (result.state.status === 'unspent') {
                continue;
            }
            const spendingTxid = result.state.spendingTxid;
            spentTxids.add(result.normRequested);
            spentRows.push({
                txid: result.sourceTxid,
                spentTxid: spendingTxid,
            });
        }

        onProgress?.({
            phase: 'spent_check_complete',
            chunkIndex: (progress?.chunkOffset ?? 0) + i + 1,
            chunkCount: progress?.chunkCount ?? chunks.length,
            checkedOutpoints:
                (progress?.checkedOffset ?? 0) + Math.min(txids.length, (i + 1) * 20),
            totalOutpoints: progress?.totalOutpoints ?? txids.length,
            vout,
        });
    }

    console.log('[vault-unlock] bulk spent check complete', {
        outpointCount: txids.length,
        spentCount: spentTxids.size,
        unspentCount: txids.length - spentTxids.size - unknownOutpointTxids.size,
        unknownCount: unknownOutpointTxids.size,
        individualFallbackCount,
    });

    return { spentRows, spentTxids, unknownOutpointTxids };
};

export const unlockCoinsBatch = async (
    pkWIF: string,
    receiveAddress: string,
    txids: Array<string | BatchUnlockCandidate>,
    onProgress?: (event: BatchUnlockProgressEvent) => void
): Promise<BatchUnlockBuildResult> => {
    try {
        if (!txids || txids.length === 0) {
            throw new Error('No txids provided');
        }
        const candidates = normalizeUnlockCandidates(txids);
        if (candidates.length === 0) {
            throw new Error('No valid txids provided');
        }
        const uniqueTxids = Array.from(new Set(candidates.map((candidate) => candidate.txid)));
        const txDetails = await getTxsDetailsBulk(uniqueTxids, onProgress);
        const { spentRows, spentTxids, unknownOutpointTxids } =
            await getSpentOutpointsBulk(
                uniqueTxids,
                LOCK_LIKE_MINT_LOCK_VOUT,
                onProgress
            );
        // Index details by txid for quick lookup
        const txidToDetail = new Map<string, WocTxDetailRow>();
        for (const d of txDetails) {
            if (d?.txid) txidToDetail.set(normalizeTxid(d.txid), d);
        }

        type InputData = { txid: string; vout: number; satoshis: number; scriptHex: string; script: bsv.Script; };
        const inputsData: InputData[] = [];
        const includedTxids: string[] = [];
        const skippedTxids: string[] = [];
        const missingTxids: string[] = [];
        const unconfirmedTxids: string[] = [];
        const spentTxidList: string[] = [];
        const unknownOutpointTxidList: string[] = [];
        let totalSatoshis = 0;
        let maxLockedBlockHeight = 0;

        for (const candidate of candidates) {
            const { txid } = candidate;
            const targetVout = candidate.vout;
            const detail = txidToDetail.get(txid);
            if (!detail) {
                skippedTxids.push(txid);
                missingTxids.push(txid);
                continue;
            }
            if (!isConfirmedTxDetail(detail)) {
                skippedTxids.push(txid);
                unconfirmedTxids.push(txid);
                continue;
            }
            if (spentTxids.has(normalizeTxid(txid))) {
                skippedTxids.push(txid);
                spentTxidList.push(txid);
                continue;
            }
            if (unknownOutpointTxids.has(normalizeTxid(txid))) {
                skippedTxids.push(txid);
                unknownOutpointTxidList.push(txid);
                continue;
            }
            const vouts = Array.isArray(detail.vout) ? detail.vout : [];
            const target = vouts.find(v => v?.n === targetVout);
            if (!target || !target.scriptPubKey?.hex) {
                skippedTxids.push(txid);
                continue;
            }
            // WOC returns value in BSV; convert to satoshis
            const valueBSV = typeof target.value === 'number' ? target.value : Number(target.value || 0);
            const satoshis = Math.round(valueBSV * 100_000_000);
            if (satoshis <= 0) {
                skippedTxids.push(txid);
                continue;
            }
            const scriptHex = String(target.scriptPubKey.hex);
            const script = new bsv.Script(scriptHex);
            // Extract lock height from script (same approach as single unlock)
            const lockedBlockHex = script.chunks[6]?.buf?.toString('hex');
            if (!lockedBlockHex) {
                skippedTxids.push(txid);
                continue;
            }
            const lockedBlock = hex2Int(lockedBlockHex);
            if (lockedBlock > maxLockedBlockHeight) {
                maxLockedBlockHeight = lockedBlock;
            }
            inputsData.push({ txid, vout: targetVout, satoshis, scriptHex, script });
            includedTxids.push(txid);
            totalSatoshis += satoshis;
        }

        onProgress?.({
            phase: 'inputs_ready',
            validInputs: inputsData.length,
            skippedCount: skippedTxids.length,
        });

        if (skippedTxids.length > 0) {
            console.warn('[vault-unlock] skipped txids', {
                skippedTxids,
                missingTxids,
                unconfirmedTxids,
                spentRows,
                spentTxids: spentTxidList,
                unknownOutpointTxids: unknownOutpointTxidList,
            });
        }

        if (inputsData.length === 0) {
            return {
                rawtx: null,
                details: {
                    requestedTxids: txids.length,
                    fetchedTxDetails: txDetails.length,
                    inputCount: 0,
                    outputCount: 0,
                    includedTxids,
                    skippedTxids,
                    missingTxids,
                    unconfirmedTxids,
                    spentRows,
                    spentTxids: spentTxidList,
                    unknownOutpointTxids: unknownOutpointTxidList,
                    totalInputSatoshis: 0,
                    outputSatoshis: 0,
                    feeSatoshis: 0,
                    byteLength: 0,
                    maxLockHeight: 0,
                    txid: '',
                },
            };
        }

        const privKey = bsv.PrivateKey.fromWIF(pkWIF);

        const buildAndSign = (feeSats: number): string => {
            if (feeSats >= totalSatoshis) {
                throw new Error('Locked amount is too small to cover the network fee');
            }
            const sendValue = totalSatoshis - feeSats;
            if (sendValue < 1) {
                throw new Error('Output would be below 1 satoshi after fee');
            }
            const bsvtx = new bsv.Transaction();
            for (const inp of inputsData) {
                bsvtx.addInput(
                    new bsv.Transaction.Input({
                        prevTxId: inp.txid,
                        outputIndex: inp.vout,
                        script: bsv.Script.fromASM(''),
                    }),
                    inp.script,
                    inp.satoshis
                );
            }
            if (maxLockedBlockHeight > 0) {
                bsvtx.lockUntilBlockHeight(maxLockedBlockHeight);
            }
            bsvtx.to(receiveAddress, sendValue);
            for (let i = 0; i < inputsData.length; i++) {
                const inp = inputsData[i];
                const solution = unlockLockScript(
                    bsvtx.toString(),
                    i,
                    inp.scriptHex,
                    inp.satoshis,
                    privKey
                );
                bsvtx.inputs[i].setScript(bsv.Script.fromHex(solution));
                const signedInputs = i + 1;
                if (signedInputs === 1 || signedInputs === inputsData.length || signedInputs % 5 === 0) {
                    onProgress?.({
                        phase: 'signing_progress',
                        signedInputs,
                        inputCount: inputsData.length,
                    });
                }
            }
            return bsvtx.toString();
        };

        const guessedBytes = 48 + inputsData.length * 420 + 45;
        let fee = unlockFeeSatoshis(guessedBytes);

        for (let attempt = 0; attempt < 4; attempt++) {
            const rawHex = buildAndSign(fee);
            const byteLength = rawHex.length / 2;
            const required = unlockFeeSatoshis(byteLength);
            if (fee >= required) {
                const finalTx = new bsv.Transaction(rawHex);
                const outputSatoshis = finalTx.outputs.reduce((sum, output) => sum + output.satoshis, 0);
                return {
                    rawtx: rawHex,
                    details: {
                        requestedTxids: txids.length,
                        fetchedTxDetails: txDetails.length,
                        inputCount: finalTx.inputs.length,
                        outputCount: finalTx.outputs.length,
                        includedTxids,
                        skippedTxids,
                        missingTxids,
                        unconfirmedTxids,
                        spentRows,
                        spentTxids: spentTxidList,
                        unknownOutpointTxids: unknownOutpointTxidList,
                        totalInputSatoshis: totalSatoshis,
                        outputSatoshis,
                        feeSatoshis: totalSatoshis - outputSatoshis,
                        byteLength,
                        maxLockHeight: maxLockedBlockHeight,
                        txid: finalTx.hash,
                    },
                };
            }
            fee = required;
        }

        throw new Error('Could not determine a sufficient fee for this unlock transaction');
    } catch (e) {
        console.error(e);
        throw e;
    }
};
