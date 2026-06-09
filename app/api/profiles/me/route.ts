import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { getOrCreateProfile } from '@/app/lib/ensure-profile'

type ProfileResponse = {
  username: string | null
  avatar_url: string | null
  owner_address: string | null
  payment_address: string | null
  passkey_credential_id: string | null
  owner_key_bip38: string | null
  payment_key_bip38: string | null
}

export async function GET() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const profile = (await getOrCreateProfile(supabase, user, {
      select:
        'username, avatar_url, owner_address, payment_address, passkey_credential_id, owner_key_bip38, payment_key_bip38',
    })) as Partial<ProfileResponse>

    return NextResponse.json(
      {
        username: profile?.username ?? null,
        avatar_url: profile?.avatar_url ?? null,
        owner_address: profile?.owner_address ?? null,
        payment_address: profile?.payment_address ?? null,
        passkey_credential_id: profile?.passkey_credential_id ?? null,
        owner_key_bip38: profile?.owner_key_bip38 ?? null,
        payment_key_bip38: profile?.payment_key_bip38 ?? null,
      },
      { status: 200 }
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to fetch profile',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}


export async function PATCH(request: Request) {
  const supabase = await createClient()

  // Check if user is authenticated
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let owner_address: string | undefined;
  let payment_address: string | undefined;
  let passkey_credential_id: string | null | undefined; // Allow null
  let owner_key_bip38: string | null | undefined;
  let payment_key_bip38: string | null | undefined;

  try {
    const body = await request.json();
    owner_address = body.owner_address;
    payment_address = body.payment_address;
    passkey_credential_id = body.passkey_credential_id; // Get passkey ID from body
    owner_key_bip38 = body.owner_key_bip38;
    payment_key_bip38 = body.payment_key_bip38;

    // --- Updated Validation --- 
    // Addresses are required *unless* explicitly set to null for unlinking.
    if (owner_address !== null && (typeof owner_address !== 'string' || !owner_address.trim())) {
        return NextResponse.json({ error: 'Invalid owner_address provided' }, { status: 400 });
    }
    if (payment_address !== null && (typeof payment_address !== 'string' || !payment_address.trim())) {
        return NextResponse.json({ error: 'Invalid payment_address provided' }, { status: 400 });
    }

    // Passkey ID is optional, but if provided, must be a string (or null)
    if (passkey_credential_id !== undefined && passkey_credential_id !== null && typeof passkey_credential_id !== 'string') {
        return NextResponse.json({ error: 'Invalid passkey credential ID format' }, { status: 400 });
    }

    // Encrypted keys are optional; if provided, must be strings or null
    if (owner_key_bip38 !== undefined && owner_key_bip38 !== null && typeof owner_key_bip38 !== 'string') {
        return NextResponse.json({ error: 'Invalid owner_key_bip38 format' }, { status: 400 });
    }
    if (payment_key_bip38 !== undefined && payment_key_bip38 !== null && typeof payment_key_bip38 !== 'string') {
        return NextResponse.json({ error: 'Invalid payment_key_bip38 format' }, { status: 400 });
    }

  } catch (e) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }


  const { data, error: updateError } = await supabase
    .from('profiles')
    .update({
      owner_address: owner_address,
      payment_address: payment_address,
      passkey_credential_id: passkey_credential_id,
      owner_key_bip38: owner_key_bip38,
      payment_key_bip38: payment_key_bip38,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
    .select('user_id, owner_address, payment_address, passkey_credential_id, owner_key_bip38, payment_key_bip38')
    .single();

  if (updateError) {
    if (updateError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Profile not found for the user, cannot update.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to update profile', details: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ message: 'Profile updated successfully', profile: data }, { status: 200 });
}