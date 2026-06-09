import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  console.log('--- /api/broadcast POST request received ---');
  console.log('Request URL:', req.url);
  console.log('Request Method:', req.method);

  try {
    console.log('Attempting to read request body...');
    const { txhex } = await req.json()
    console.log('Extracted txhex:', txhex ? `${txhex.substring(0, 20)}...` : 'undefined');

    if (!txhex) {
      console.error('No txhex provided in request body');
      return NextResponse.json({ error: 'Missing txhex in request body' }, { status: 400 });
    }

    console.log('Broadcasting to Bitails API...');
    const response = await fetch('https://api.bitails.io/tx/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: txhex })
    })

    console.log('Bitails Response Status:', response.status);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Bitails Error Body:', errorBody);
      try {
        const errorJson = JSON.parse(errorBody);
        const message = errorJson.message || errorJson.detail || errorJson.description || errorJson.error || errorBody;
        return NextResponse.json({ error: `Bitails Error: ${message}` }, { status: response.status });
      } catch {
        return NextResponse.json({ error: `Bitails Error: ${errorBody}` || 'Broadcast failed' }, { status: response.status });
      }
    }

    const result: {
      txid?: string;
      error?: { message?: string } | string;
      message?: string;
      description?: string;
    } = await response.json()
    console.log('Bitails Success Result:', result);

    // Bitails may return 201 with an error payload. Normalize that to an error.
    if (result && (result.error || result.message || result.description)) {
      const errField = result.error
      const fromErr =
        typeof errField === 'string'
          ? errField
          : errField && typeof errField === 'object' && 'message' in errField
            ? String((errField as { message?: string }).message)
            : ''
      const message =
        fromErr || result.message || result.description || 'Unknown broadcast error'
      return NextResponse.json({ error: `Bitails Error: ${message}` }, { status: 400 })
    }

    // Bitails returns { "txid": "..." } on success
    if (result?.txid) {
      return NextResponse.json({ txid: result.txid }, { status: 201 })
    }

    return NextResponse.json({ error: 'Unexpected Bitails response' }, { status: 502 })
  } catch (error: unknown) {
    console.error('--- Error within /api/broadcast POST handler ---');
    console.error('Broadcast error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Failed to broadcast transaction: ${errorMessage}` }, { status: 500 })
  }
} 