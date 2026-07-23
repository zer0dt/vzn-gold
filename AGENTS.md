# AGENTS.md

Guidance for AI coding agents (including Cursor Cloud Agents) working in this repository.

## Project overview

This is the `vzn-gold` Next.js (App Router) app — a BSV social platform built around the
`LockLikeMintBSV21Parallel` smart contract (`LLM-21`). See `README.md` for the full architecture
write-up (feed, trade, leaderboard, contract internals, env vars).

- Framework: Next.js `16` (App Router) + React `19` + TypeScript.
- Styling: Tailwind CSS.
- Data/auth: Supabase.
- Chain infra: BSV SDK, ARC broadcasting, a BSV21 overlay service, WhatsOnChain.

The production deployment is served from the public domain `https://vzn.gold` (the **production base URL**, also present in `app/layout.tsx`). <!-- pragma: allowlist secret -->

## Commands

```bash
npm install        # install dependencies
npm run dev        # start local dev server on http://localhost:3000
npm run build      # production build
npm run lint       # eslint
npm run lint:biome # biome lint
npm run format     # biome format --write
npm run knip       # unused-code/dependency check
```

Always run `npm run lint` (and `npm run build` for non-trivial changes) before considering a task done.

## Cursor Cloud specific instructions

**Prefer the production base URL over `localhost` for verification.**

A fresh Cloud Agent environment does **not** have the secrets and external services required to run a
functional local app. `npm run dev` will start a server on `http://localhost:3000`, but most features
will not work locally because the following are not provisioned in the agent environment:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (auth, profiles, feed data)
- `ARC_API_KEY` (broadcasting BEEF transactions)
- `OVERLAY_URL` / `OVERLAY_TOPIC` (finding live minter branches; the in-code defaults fall back to unreachable `localhost` ports)
- `APP_PAYMENT_KEY` (server-funded post/reply transactions)

Because of this, when you need to observe real, working app behavior or data, hit the live production
site instead of localhost. Pages worth checking include `/`, `/trade`, `/leaderboard`, `/vault`, and
`/<username>`. Read-only API routes useful for verification:

- `GET /api/network-stats` — token supply / mint stats
- `GET /api/vzn/token-info` — current `$VZN` token info and latest outpoint
- `GET /api/vzn/sales` — recent sales used by the price chart
- `GET /api/posts` — feed posts

Example verification against production (append the path to the production base URL):

```bash
curl -s "$PROD/api/network-stats"   # PROD=https://vzn.gold  # pragma: allowlist secret
```

> Treat the production site as a real, shared environment: only perform **read-only** requests against
> it. Do not create posts, broadcast transactions, or otherwise mutate production state from an agent
> unless the user explicitly asks for it.

### When to use localhost anyway

Use `localhost:3000` only when:

- You are validating purely client-side/UI behavior that does not depend on the unavailable services, or
- You have been given the required secrets/env values and have populated `.env.local` (see `.env.example`
  and the `Environment Variables` section of `README.md`).

Never commit secrets. `.env.local` is git-ignored; keep it that way.

## Code conventions

- Match the existing TypeScript/React style; keep changes minimal and focused.
- Use the `@/` path alias for imports (configured in `tsconfig.json`).
- Do not add narration comments; only comment non-obvious intent.
