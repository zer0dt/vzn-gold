import { type NextRequest, NextResponse } from 'next/server';

const VZN_TOKEN_ID = process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID;
const GORILLA_POOL_API = 'https://ordinals.gorillapool.io/api/bsv20';

export interface TokenUtxoResponse {
    txid: string;
    vout: number;
    outpoint: string;
    satoshis: number;
    height: number | null;
    idx: number;
    op: string;
    amt: string;
    status: number;
    reason: string | null;
    listing: boolean;
    owner: string;
    spend: string;
    spendHeight: number | null;
    spendIdx: number | null;
    tick: string;
    id: string;
    price: string;
    pricePer: string;
    payout: string | null;
    script: string;
    sale: boolean;
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const ownerAddress = searchParams.get('owner_address');

        if (!ownerAddress) {
            return NextResponse.json(
                { error: 'owner_address parameter is required' },
                { status: 400 }
            );
        }

        if (!VZN_TOKEN_ID) {
            return NextResponse.json(
                { error: 'VZN Token ID not configured' },
                { status: 500 }
            );
        }

        // Fetch token UTXOs for the specific address and token ID.
        // Use includePending=true to see pending transactions.
        const limit = 100;
        let offset = 0;
        let allUtxos: TokenUtxoResponse[] = [];

        while (true) {
            const url = `${GORILLA_POOL_API}/${ownerAddress}/id/${VZN_TOKEN_ID}?limit=${limit}&offset=${offset}&includePending=true`;

            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) {
                if (res.status === 404) {
                    break;
                }
                return NextResponse.json(
                    { error: 'Upstream UTXO fetch failed', status: res.status },
                    { status: 502 }
                );
            }

            const utxos: TokenUtxoResponse[] = await res.json();

            if (!utxos || utxos.length === 0) {
                break;
            }

            const unspentUtxos = utxos.filter(utxo =>
                (!utxo.spend || utxo.spend === '')
            );
            allUtxos = [...allUtxos, ...unspentUtxos];

            if (utxos.length < limit) {
                break;
            }

            offset += limit;

            if (offset > 10000) {
                break;
            }
        }

        const availableUtxos = allUtxos.filter(utxo => !utxo.listing);
        const listings = allUtxos.filter(utxo => utxo.listing);

        const availableBalance = availableUtxos.reduce((sum, utxo) => sum + parseInt(utxo.amt, 10), 0);
        const listedBalance = listings.reduce((sum, utxo) => sum + parseInt(utxo.amt, 10), 0);
        const totalBalance = availableBalance + listedBalance;

        return NextResponse.json({
            utxos: availableUtxos,
            listings: listings,
            tokenId: VZN_TOKEN_ID,
            availableBalance,
            listedBalance,
            totalBalance
        });

    } catch (error) {
        console.error('Error in VZN UTXOs API:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
