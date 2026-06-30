-- Local development schema
-- Reconstructed from application Supabase usage (the repo references a
-- supabase-schema.sql that is not committed). This migration is intended for
-- LOCAL DEVELOPMENT via `supabase start`. RLS is intentionally left disabled to
-- match the documented behavior of the app (the README notes the schema ships
-- without RLS policies, and the client/service-role code relies on open access).

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  avatar_url text,
  cover_url text,
  owner_address text,
  payment_address text,
  owner_key_bip38 text,
  payment_key_bip38 text,
  passkey_credential_id text,
  owner_public_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
create table if not exists public.posts (
  txid text primary key,
  user_id uuid not null,
  content text,
  has_image boolean not null default false,
  wallet_address text,
  owner_public_key text,
  created_at timestamptz not null default now(),
  constraint posts_user_id_fkey foreign key (user_id)
    references public.profiles (user_id) on delete cascade
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_user_id_created_at_idx on public.posts (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- likes (lock-like-mint mirror rows)
-- ---------------------------------------------------------------------------
create table if not exists public.likes (
  txid text primary key,
  post_txid text not null,
  user_id uuid not null,
  contract_id text,
  contract_input_txid text,
  contract_input_vout integer,
  contract_output_vout integer,
  sats_amount bigint,
  blocks_locked integer,
  block_height integer,
  unlock_height integer,
  reward_amount bigint,
  mint_index integer,
  is_spent boolean not null default false,
  spent_txid text,
  created_at timestamptz not null default now(),
  constraint likes_user_id_fkey foreign key (user_id)
    references public.profiles (user_id) on delete cascade,
  constraint likes_post_txid_fkey foreign key (post_txid)
    references public.posts (txid) on delete cascade
);

create index if not exists likes_post_txid_idx on public.likes (post_txid);
create index if not exists likes_user_vault_idx on public.likes (user_id, is_spent, unlock_height, created_at desc);

-- ---------------------------------------------------------------------------
-- replies
-- ---------------------------------------------------------------------------
create table if not exists public.replies (
  txid text primary key,
  post_txid text not null,
  user_id uuid not null,
  content text,
  has_image boolean not null default false,
  created_at timestamptz not null default now(),
  constraint replies_user_id_fkey foreign key (user_id)
    references public.profiles (user_id) on delete cascade,
  constraint replies_post_txid_fkey foreign key (post_txid)
    references public.posts (txid) on delete cascade
);

create index if not exists replies_post_txid_created_at_idx on public.replies (post_txid, created_at asc);

-- ---------------------------------------------------------------------------
-- tx_cache (documented in README; not referenced by current app code)
-- ---------------------------------------------------------------------------
create table if not exists public.tx_cache (
  txid text primary key,
  rawtx text,
  merkle_path_hex text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Ranked feed RPCs (bodies are not in the repo; implemented to return the same
-- nested shape the "NEW" feed selects, ranked by active locked sats).
-- ---------------------------------------------------------------------------
create or replace function public.get_active_locks(
  current_block_height integer,
  time_cutoff timestamptz,
  page_limit integer,
  page_offset integer
)
returns setof jsonb
language sql
stable
as $$
  select to_jsonb(p)
    || jsonb_build_object(
      'profile', to_jsonb(pr),
      'likes', coalesce((
        select jsonb_agg(
          to_jsonb(l) || jsonb_build_object('liker_profile', to_jsonb(lpr))
        )
        from public.likes l
        left join public.profiles lpr on lpr.user_id = l.user_id
        where l.post_txid = p.txid
      ), '[]'::jsonb),
      'replies', jsonb_build_array(
        jsonb_build_object('count', (
          select count(*) from public.replies r where r.post_txid = p.txid
        ))
      )
    )
  from public.posts p
  left join public.profiles pr on pr.user_id = p.user_id
  where p.created_at >= time_cutoff
  order by
    coalesce((
      select sum(l.sats_amount)
      from public.likes l
      where l.post_txid = p.txid
        and l.is_spent = false
        and l.unlock_height > current_block_height
    ), 0) desc,
    p.created_at desc
  limit page_limit offset page_offset;
$$;

create or replace function public.get_profile_top_posts(
  current_block_height integer,
  profile_user_id uuid,
  page_limit integer,
  page_offset integer
)
returns setof jsonb
language sql
stable
as $$
  select to_jsonb(p)
    || jsonb_build_object(
      'profile', to_jsonb(pr),
      'likes', coalesce((
        select jsonb_agg(
          to_jsonb(l) || jsonb_build_object('liker_profile', to_jsonb(lpr))
        )
        from public.likes l
        left join public.profiles lpr on lpr.user_id = l.user_id
        where l.post_txid = p.txid
      ), '[]'::jsonb),
      'replies', jsonb_build_array(
        jsonb_build_object('count', (
          select count(*) from public.replies r where r.post_txid = p.txid
        ))
      )
    )
  from public.posts p
  left join public.profiles pr on pr.user_id = p.user_id
  where p.user_id = profile_user_id
  order by
    coalesce((
      select sum(l.sats_amount)
      from public.likes l
      where l.post_txid = p.txid
        and l.is_spent = false
        and l.unlock_height > current_block_height
    ), 0) desc,
    p.created_at desc
  limit page_limit offset page_offset;
$$;

-- ---------------------------------------------------------------------------
-- Storage bucket for profile/cover images
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('profile-images', 'profile-images', true)
on conflict (id) do nothing;

create policy "profile-images public read"
  on storage.objects for select
  using (bucket_id = 'profile-images');

create policy "profile-images authenticated write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-images');

create policy "profile-images authenticated update"
  on storage.objects for update to authenticated
  using (bucket_id = 'profile-images');

-- ---------------------------------------------------------------------------
-- Grants (RLS stays disabled to match documented app behavior in local dev)
-- ---------------------------------------------------------------------------
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Realtime: feed/vault UX relies on INSERT events for these tables
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.likes;
alter publication supabase_realtime add table public.replies;
