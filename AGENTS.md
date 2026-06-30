# AGENTS.md

## Cursor Cloud specific instructions

This is a Next.js 16 (App Router, React 19, Turbopack) social app backed by
Supabase. Standard scripts live in `package.json` (`dev`, `build`, `lint`,
`lint:biome`, `knip`); there is no automated test suite, so `lint` + `build` +
running the dev server are the available checks.

### Services

| Service | Purpose | Run command | Notes |
|---|---|---|---|
| Next.js dev server | Web app + API routes | `npm run dev` (port 3000) | Reads `.env.local`. |
| Local Supabase | Auth + Postgres + Storage + Realtime backend | `npx supabase start` | Requires Docker running. |

### Backend setup (non-obvious)

- **Docker is required for local Supabase but is not auto-started.** Start the
  daemon once per session in the background: `sudo dockerd &` (it uses the
  `fuse-overlayfs` storage driver + iptables-legacy already configured in
  `/etc/docker/daemon.json`). The `ubuntu` user is in the `docker` group; if you
  still hit a socket permission error, run `sudo chmod 666 /var/run/docker.sock`.
- **The repo references `supabase-schema.sql`, but that file does not exist.** A
  reconstructed schema (tables `profiles`, `posts`, `likes`, `replies`,
  `tx_cache`, the `get_active_locks` / `get_profile_top_posts` ranked-feed RPCs,
  the `profile-images` storage bucket, and realtime publication) lives in
  `supabase/migrations/`. `npx supabase start` applies it automatically. To reset
  the DB to migrations, use `npx supabase db reset`.
- RLS is intentionally left disabled in the local schema to match the documented
  app behavior (the app/service-role code expects open access). This is for local
  dev only, not production.

### `.env.local` (gitignored — recreate if missing)

Start from `.env.example` (`cp .env.example .env.local`) and set the Supabase
values to point at the local stack. The `NEXT_PUBLIC_APP_NAME` and
`NEXT_PUBLIC_LLM21_ORIGIN_ID` defaults are already in `.env.example`. The local
Supabase URL is `http://127.0.0.1:54321`; print the matching local
publishable/secret keys with `npx supabase status` and set:

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the local **Publishable** key
- `SUPABASE_SERVICE_ROLE_KEY` = the local **Secret** key

(These local CLI keys are fixed defaults, not real credentials.)

### What works vs. what is gated on external services

- **Works locally:** account sign-up/login (Supabase email auth;
  `enable_confirmations = false`, so signups auto-confirm — check the Mailpit
  inbox at `http://127.0.0.1:54324` if you ever enable confirmations),
  client-side BIP38 wallet generation, profile creation/reads, feed/vault UI.
- **Gated (needs real credentials + BSV funds):** posting, replying, and the
  lock-like-mint flow all broadcast on-chain and require `ARC_API_KEY`,
  `OVERLAY_URL`, and a funded `APP_PAYMENT_KEY` WIF. These cannot be exercised
  end-to-end without those secrets and on-chain funds.
