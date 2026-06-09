import { NextResponse } from 'next/server';
import { PrivateKey, Transaction, P2PKH, Script } from '@bsv/sdk';

// Constants
const B_PROTOCOL_ADDRESS = '19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut';
const MAP_PROTOCOL_ADDRESS = '1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5';
const AIP_PROTOCOL_ADDRESS = '15PciHG22SNLQJXMoSUaWVi7WSqc7hCfva';
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'bitcoin';

// Match the lock flow mining fee: 200 sat/kB = 0.2 sat/byte.
const FEE_PER_KB = 100;
const FEE_RATE = FEE_PER_KB / 1000;

type WocUnspentRow = {
    value?: number;
    satoshis?: number;
    txid?: string;
    tx_hash?: string;
    vout?: number;
    tx_pos?: number;
    isSpentInMempoolTx?: boolean;
};

type NormalizedPaymentUtxo = {
    satoshis: number;
    txid: string;
    vout: number;
    script: string;
};

// Server-side UTXO fetching
async function getPaymentUTXOs(address: string, amount: number): Promise<Array<{
    txid: string;
    vout: number;
    satoshis: number;
    script: string;
}>> {
    console.log(`[sign-and-pay] Fetching UTXOs for address: ${address}, amount needed: ${amount}`);

    const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent/all`);

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`WhatsOnChain API error (${response.status}):`, errorText);
        throw new Error(`Failed to fetch UTXOs from WhatsOnChain (status: ${response.status})`);
    }

    const responseData = await response.json();
    const allUtxos: WocUnspentRow[] =
        responseData && Array.isArray(responseData.result) ? responseData.result : [];
    console.log(`[sign-and-pay] Received ${allUtxos.length} total UTXOs`);

    // Filter out UTXOs that are already spent in unconfirmed transactions
    const availableUtxos = allUtxos.filter((utxo: WocUnspentRow) => !utxo.isSpentInMempoolTx);
    console.log(`[sign-and-pay] Filtered to ${availableUtxos.length} available UTXOs`);

    // Normalize UTXOs
    const normalizedUtxos: NormalizedPaymentUtxo[] = availableUtxos.map((utxo: WocUnspentRow) => ({
        satoshis: utxo?.value || utxo?.satoshis || 0,
        txid: utxo?.txid || utxo.tx_hash || '',
        vout: utxo.vout === undefined ? utxo.tx_pos ?? 0 : utxo.vout,
        script: '' // Will be fetched from source transaction
    }));

    // Select UTXOs to cover the required amount
    const cache: NormalizedPaymentUtxo[] = [];
    let totalSatoshis = 0;

    for (const utxo of normalizedUtxos) {
        if (utxo.satoshis > 1) {
            // Check if a single UTXO can cover the amount
            const foundUtxo = normalizedUtxos.find((u) => u.satoshis >= amount + 2);
            if (foundUtxo) {
                return [{
                    satoshis: foundUtxo.satoshis,
                    txid: foundUtxo.txid,
                    vout: foundUtxo.vout,
                    script: ''
                }];
            }
            cache.push(utxo);
            if (amount) {
                totalSatoshis = cache.reduce((a, curr) => a + curr.satoshis, 0);
                if (totalSatoshis >= amount) {
                    return cache.map(u => ({
                        satoshis: u.satoshis,
                        txid: u.txid,
                        vout: u.vout,
                        script: ''
                    }));
                }
            } else {
                return normalizedUtxos.map((u) => ({
                    satoshis: u.satoshis,
                    txid: u.txid,
                    vout: u.vout,
                    script: ''
                }));
            }
        }
    }
    return [];
}

// Build OP_RETURN script with BSocial data
function buildOpReturnScript(payload: string[]): Script {
    // Build the OP_RETURN script manually
    // OP_FALSE (0x00) + OP_RETURN (0x6a) + push data items
    const chunks: number[] = [];

    // OP_FALSE OP_RETURN
    chunks.push(0x00);
    chunks.push(0x6a);

    for (const item of payload) {
        const data = Buffer.from(item, 'utf8');
        const len = data.length;

        if (len === 0) {
            // OP_0
            chunks.push(0x00);
        } else if (len <= 75) {
            // Direct push
            chunks.push(len);
            const bytes = Array.from(data);
            for (const byte of bytes) {
                chunks.push(byte);
            }
        } else if (len <= 255) {
            // OP_PUSHDATA1
            chunks.push(0x4c);
            chunks.push(len);
            const bytes = Array.from(data);
            for (const byte of bytes) {
                chunks.push(byte);
            }
        } else if (len <= 65535) {
            // OP_PUSHDATA2
            chunks.push(0x4d);
            chunks.push(len & 0xff);
            chunks.push((len >> 8) & 0xff);
            const bytes = Array.from(data);
            for (const byte of bytes) {
                chunks.push(byte);
            }
        } else {
            // OP_PUSHDATA4
            chunks.push(0x4e);
            chunks.push(len & 0xff);
            chunks.push((len >> 8) & 0xff);
            chunks.push((len >> 16) & 0xff);
            chunks.push((len >> 24) & 0xff);
            const bytes = Array.from(data);
            for (const byte of bytes) {
                chunks.push(byte);
            }
        }
    }

    return Script.fromHex(Buffer.from(chunks).toString('hex'));
}

// BSocial Post builder for server-side use
class BSocialPost {
    appName: string;
    type: string;
    txId: string;
    texts: Array<{ text: string; type: string }>;

    constructor(appName: string) {
        if (!appName) throw new Error('App name needs to be set');
        this.appName = appName;
        this.type = 'post';
        this.txId = '';
        this.texts = [];
    }

    setTxId(txId: string): void {
        this.txId = txId;
    }

    addText(text: string, type: string = 'text/markdown'): void {
        if (typeof text !== 'string') throw new Error('Text should be a string');
        this.texts.push({ text, type });
    }

    getOps(): string[] {
        const hasContent = this.texts.length > 0;
        if (!hasContent) {
            throw new Error('There is no content for this post');
        }

        const ops: string[] = [];

        // Add B protocol content
        if (this.texts.length > 0) {
            this.texts.forEach((t) => {
                ops.push(B_PROTOCOL_ADDRESS);
                ops.push(t.text);
                ops.push(t.type);
                ops.push('UTF-8');
                ops.push('|');
            });
        }

        // Add MAP protocol metadata
        ops.push(MAP_PROTOCOL_ADDRESS);
        ops.push('SET');
        ops.push('app');
        ops.push(this.appName);
        ops.push('type');
        ops.push(this.type);

        // Add reply context if this is a reply
        if (this.txId) {
            ops.push('context');
            ops.push('tx');
            ops.push('tx');
            ops.push(this.txId);
        }

        return ops;
    }
}

// Append pre-computed AIP signature to ops (when client provides signature)
function appendAIPSignature(ops: string[], signerAddress: string, signature: string): string[] {
    return ops.concat(['|', AIP_PROTOCOL_ADDRESS, 'BITCOIN_ECDSA', signerAddress, signature]);
}

export async function POST(req: Request) {
    console.log('--- /api/sign-and-pay POST request received ---');

    try {
        const body = await req.json();
        const { content, type, replyToTxid, aipSignature, signerAddress } = body;

        if (!content || typeof content !== 'string') {
            return NextResponse.json({ error: 'Missing or invalid content' }, { status: 400 });
        }

        if (
            typeof aipSignature !== 'string' ||
            !aipSignature.trim() ||
            typeof signerAddress !== 'string' ||
            !signerAddress.trim()
        ) {
            return NextResponse.json(
                { error: 'Missing AIP signature or signer address; unlock wallet and try again' },
                { status: 400 }
            );
        }

        // Get the app payment key from server-side environment (NOT NEXT_PUBLIC_)
        const appPaymentKey = process.env.APP_PAYMENT_KEY;
        if (!appPaymentKey) {
            console.error('APP_PAYMENT_KEY is not configured on the server');
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        // Create private key from WIF
        const privateKey = PrivateKey.fromWif(appPaymentKey);
        const address = privateKey.toAddress();

        console.log(`[sign-and-pay] App wallet address: ${address}`);

        // Create the BSocial post/reply
        const bSocial = new BSocialPost(APP_NAME);
        bSocial.addText(content);

        // If this is a reply, set the parent txid
        if (type === 'reply' && replyToTxid) {
            bSocial.setTxId(replyToTxid);
        }

        // Get ops and sign with AIP
        const ops = bSocial.getOps();

        const signedPayload = appendAIPSignature(ops, signerAddress, aipSignature);
        console.log(`[sign-and-pay] Using client-provided AIP signature from address: ${signerAddress}`);
        console.log('[sign-and-pay] Payload created');

        // Build the OP_RETURN script
        const opReturnScript = buildOpReturnScript(signedPayload);

        // Estimate transaction size for fee calculation
        // Base tx size + OP_RETURN output + P2PKH input + P2PKH change output
        const opReturnSize = opReturnScript.toHex().length / 2;
        const estimatedTxSize = 10 + opReturnSize + 9 + 148 + 34; // overhead + opreturn + output overhead + input + change
        const txFee = Math.ceil(estimatedTxSize * FEE_RATE) + 1;

        console.log(`[sign-and-pay] Estimated tx size: ${estimatedTxSize}, fee: ${txFee}`);

        // Get UTXOs for the transaction
        const utxos = await getPaymentUTXOs(address, txFee);
        console.log(`[sign-and-pay] Selected ${utxos.length} UTXOs`);

        if (!utxos.length) {
            return NextResponse.json({ error: 'Insufficient funds in app wallet' }, { status: 500 });
        }

        // Create transaction
        const tx = new Transaction();

        // Add inputs with source transactions
        for (const utxo of utxos) {
            // Fetch source transaction
            const sourceTxResponse = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${utxo.txid}/hex`);
            if (!sourceTxResponse.ok) {
                throw new Error(`Failed to fetch source transaction ${utxo.txid}`);
            }
            const sourceTxHex = (await sourceTxResponse.text()).replace(/"/g, '');
            const sourceTransaction = Transaction.fromHex(sourceTxHex);

            // Create unlocking script template for P2PKH
            const unlockingScriptTemplate = new P2PKH().unlock(
                privateKey,
                'all',
                false,
                utxo.satoshis,
                sourceTransaction.outputs[utxo.vout].lockingScript
            );

            tx.addInput({
                sourceTransaction,
                sourceOutputIndex: utxo.vout,
                unlockingScriptTemplate,
                sequence: 0xffffffff
            });
        }

        // Add OP_RETURN output
        tx.addOutput({
            lockingScript: opReturnScript,
            satoshis: 0
        });

        // Calculate total input satoshis
        const inputSatoshis = utxos.reduce((t, e) => t + e.satoshis, 0);

        // Add change output if needed
        const changeAmount = inputSatoshis - txFee;
        if (changeAmount > 0) {
            tx.addOutput({
                lockingScript: new P2PKH().lock(address),
                satoshis: changeAmount,
                change: true
            });
        }

        // Keep the manually calculated fee/change so posts match the lock mining fee.
        await tx.sign();

        const outputSatoshis = tx.outputs.reduce((total, output) => total + (output.satoshis ?? 0), 0);
        const actualFee = inputSatoshis - outputSatoshis;
        const txSizeBytes = tx.toHex().length / 2;
        const actualFeeRate = txSizeBytes > 0 ? (actualFee * 1000) / txSizeBytes : 0;
        console.log(
            `[sign-and-pay] Final tx size: ${txSizeBytes} bytes, fee: ${actualFee} sats, fee rate: ${actualFeeRate.toFixed(3)} sat/kB`
        );

        const signedTxHex = tx.toHex();
        console.log('[sign-and-pay] Transaction signed, broadcasting...');

        // Broadcast the transaction
        const broadcastResponse = await fetch('https://api.bitails.io/tx/broadcast', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ raw: signedTxHex })
        });

        if (!broadcastResponse.ok) {
            const errorBody = await broadcastResponse.text();
            console.error('[sign-and-pay] Broadcast error:', errorBody);
            try {
                const errorJson = JSON.parse(errorBody);
                const message = errorJson.message || errorJson.detail || errorJson.description || errorJson.error || errorBody;
                return NextResponse.json({ error: `Broadcast failed: ${message}` }, { status: 500 });
            } catch (e) {
                return NextResponse.json({ error: `Broadcast failed: ${errorBody}` }, { status: 500 });
            }
        }

        const result = await broadcastResponse.json();
        console.log('[sign-and-pay] Broadcast result:', result);

        if (result && (result.error || result.message || result.description)) {
            const message = result.error?.message || result.error || result.message || result.description || 'Unknown broadcast error';
            return NextResponse.json({ error: `Broadcast failed: ${message}` }, { status: 500 });
        }

        if (result && result.txid) {
            console.log(`[sign-and-pay] Transaction broadcast successfully: ${result.txid}`);
            return NextResponse.json({ txid: result.txid }, { status: 201 });
        }

        return NextResponse.json({ error: 'Unexpected broadcast response' }, { status: 502 });

    } catch (error: unknown) {
        console.error('[sign-and-pay] Error:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ error: `Failed to process transaction: ${errorMessage}` }, { status: 500 });
    }
}
