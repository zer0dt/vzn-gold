import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  ArrowUpRight,
  Coins,
  Flame,
  Github,
  Lock,
  Shield,
  Sparkles,
  ThumbsUp,
  TrendingUp,
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'VZN.gold — Lock Satoshis. Earn $VZN.',
  description:
    'A social feed where every like is a lock-backed, on-chain commitment. Lock satoshis, like a post, and mint $VZN — enforced by the LLM-21 smart contract, not a server.',
  openGraph: {
    title: 'VZN.gold — Lock Satoshis. Earn $VZN.',
    description:
      'A social feed where every like is a lock-backed, on-chain commitment.',
    url: 'https://vzn.gold/landing',
    siteName: 'VZN.gold',
    type: 'website',
  },
}

const GOLD_TEXT =
  'text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24] [background-size:200%_200%] animate-gold-shimmer'

export default function LandingPage() {
  return (
    <div className="relative min-h-dvh w-full overflow-x-hidden bg-background text-foreground selection:bg-amber-400/30 selection:text-foreground">
      <AmbientBackdrop />

      <SiteHeader />

      <main className="relative z-10">
        <Hero />
        <Pillars />
        <HowItWorks />
        <FeedSplit />
        <Contract />
        <FinalCta />
      </main>

      <SiteFooter />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Ambient backdrop                                                           */
/* -------------------------------------------------------------------------- */

function AmbientBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-0">
      {/* Base gradient wash */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(251,191,36,0.22),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_10%_110%,rgba(245,158,11,0.12),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_90%_80%,rgba(251,191,36,0.08),transparent_70%)]" />

      {/* Thin grid */}
      <div
        className="absolute inset-0 opacity-[0.55] dark:opacity-[0.35]"
        style={{
          backgroundImage:
            'linear-gradient(to right, hsl(var(--foreground) / 0.18) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--foreground) / 0.18) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage:
            'radial-gradient(ellipse at center, black 55%, transparent 85%)',
          WebkitMaskImage:
            'radial-gradient(ellipse at center, black 55%, transparent 85%)',
        }}
      />

      {/* Drifting gold locks */}
      <FloatingLocks />

      {/* Soft vignette bottom */}
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-background to-transparent" />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Floating gold locks                                                        */
/* -------------------------------------------------------------------------- */

type LockSpec = {
  top?: string
  bottom?: string
  left?: string
  right?: string
  size: number
  opacity: number
  hideBelow?: 'sm' | 'md' | 'lg'
}

const FLOATING_LOCKS: LockSpec[] = [
  // Upper edges
  { top: '9%',  left: '6%',   size: 22, opacity: 0.60 },
  { top: '14%', right: '8%',  size: 30, opacity: 0.68 },
  { top: '18%', left: '38%',  size: 14, opacity: 0.40, hideBelow: 'lg' },
  { top: '22%', right: '34%', size: 18, opacity: 0.46, hideBelow: 'lg' },
  { top: '26%', left: '14%',  size: 16, opacity: 0.44, hideBelow: 'md' },
  // Mid — denser through the vertical middle band
  { top: '32%', right: '22%', size: 20, opacity: 0.52, hideBelow: 'md' },
  { top: '36%', left: '46%',  size: 12, opacity: 0.38, hideBelow: 'lg' },
  { top: '40%', left: '20%',  size: 24, opacity: 0.56, hideBelow: 'sm' },
  { top: '44%', right: '4%',  size: 42, opacity: 0.56, hideBelow: 'md' },
  { top: '48%', right: '42%', size: 16, opacity: 0.40, hideBelow: 'lg' },
  { top: '52%', left: '3%',   size: 26, opacity: 0.58, hideBelow: 'sm' },
  { top: '54%', left: '52%',  size: 18, opacity: 0.40, hideBelow: 'lg' },
  { top: '58%', right: '18%', size: 22, opacity: 0.50, hideBelow: 'md' },
  { top: '60%', left: '22%',  size: 14, opacity: 0.44, hideBelow: 'lg' },
  { top: '64%', left: '6%',   size: 28, opacity: 0.58, hideBelow: 'sm' },
  { top: '68%', right: '30%', size: 16, opacity: 0.40, hideBelow: 'lg' },
  // Lower
  { bottom: '28%', right: '12%', size: 20, opacity: 0.56 },
  { bottom: '22%', left: '44%',  size: 14, opacity: 0.38, hideBelow: 'lg' },
  { bottom: '18%', left: '10%',  size: 34, opacity: 0.60 },
  { bottom: '10%', right: '28%', size: 18, opacity: 0.44, hideBelow: 'md' },
  { bottom: '6%',  left: '32%',  size: 12, opacity: 0.38, hideBelow: 'lg' },
]

const HIDE_CLASS: Record<NonNullable<LockSpec['hideBelow']>, string> = {
  sm: 'hidden sm:block',
  md: 'hidden md:block',
  lg: 'hidden lg:block',
}

function FloatingLocks() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {FLOATING_LOCKS.map((l, i) => {
        const hideClass = l.hideBelow ? HIDE_CLASS[l.hideBelow] : ''
        return (
          <Lock
            key={i}
            className={hideClass}
            style={{
              position: 'absolute',
              top: l.top,
              bottom: l.bottom,
              left: l.left,
              right: l.right,
              width: l.size,
              height: l.size,
              opacity: l.opacity,
              color: '#F59E0B',
              filter: `drop-shadow(0 0 ${Math.round(l.size * 0.5)}px rgba(245,158,11,0.45))`,
              strokeWidth: 1.5,
            }}
          />
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/50 bg-background/60 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link
          href="/landing"
          className="inline-flex items-center gap-2 hover:opacity-90 transition-opacity"
        >
          <span
            className={`font-vzn-headings text-2xl font-normal tracking-tight ${GOLD_TEXT} drop-shadow-[0_0_10px_rgba(245,158,11,0.35)]`}
          >
            VZN.gold
          </span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a
            href="#how"
            className="transition-colors hover:text-foreground"
          >
            How it works
          </a>
          <a
            href="#contract"
            className="transition-colors hover:text-foreground"
          >
            Contract
          </a>
          <Link
            href="/trade"
            className="transition-colors hover:text-foreground"
          >
            $VZN
          </Link>
          <Link
            href="/leaderboard"
            className="transition-colors hover:text-foreground"
          >
            Leaderboard
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="group inline-flex items-center gap-1.5 rounded-full border border-amber-400/60 bg-amber-400/10 px-4 py-1.5 text-sm font-medium text-amber-500 transition-all hover:border-amber-400 hover:bg-amber-400/20 dark:text-amber-300"
          >
            Enter feed
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </header>
  )
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                       */
/* -------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-6 pb-12 pt-10 sm:pb-16 sm:pt-14 lg:pt-20">
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3.5 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
          </span>
          Live on BSV · LLM-21 contract
        </div>

        <h1 className="font-vzn-headings text-5xl font-normal leading-[1.05] tracking-tight sm:text-7xl lg:text-[88px]">
          Lock satoshis.{' '}
          <span
            className={`${GOLD_TEXT} drop-shadow-[0_0_24px_rgba(245,158,11,0.35)]`}
          >
            Earn $VZN.
          </span>
        </h1>

        <p className="mt-8 max-w-2xl text-balance text-lg text-muted-foreground sm:text-xl">
          A social feed where every like is a lock-backed, on-chain
          commitment. No upvote inflation. No invisible ranking. Just
          satoshis, time, and conviction — enforced by a smart contract.
        </p>

        <div className="mt-10 flex justify-center">
          <Link
            href="/"
            className="group relative inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-7 py-3.5 text-sm font-semibold text-background transition-transform hover:scale-[1.02]"
          >
            <span className="absolute inset-0 rounded-full bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 opacity-0 transition-opacity group-hover:opacity-100" />
            <span className="relative flex items-center gap-2 transition-colors group-hover:text-black">
              Enter the feed
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        </div>
      </div>

      <StatsStrip />
    </section>
  )
}

function StatsStrip() {
  const stats = [
    { label: 'Primitive', value: 'Lock · Like · Mint' },
    { label: 'Token', value: '$VZN · BSV21' },
    { label: 'Settlement', value: 'BSV Mainnet' },
    { label: 'Source', value: 'Open' },
  ]
  return (
      <div className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/40 sm:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="flex flex-col items-start gap-1 bg-background/80 px-5 py-5 backdrop-blur"
        >
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {s.label}
          </span>
          <span className="whitespace-nowrap font-mono text-xs text-foreground sm:text-sm">{s.value}</span>
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Pillars                                                                    */
/* -------------------------------------------------------------------------- */

function Pillars() {
  const pillars: Array<{
    icon: typeof Lock
    iconProps?: React.SVGProps<SVGSVGElement>
    eyebrow: string
    title: string
    body: string
  }> = [
    {
      icon: Lock,
      eyebrow: '01 · Lock',
      title: 'Time-locked satoshis',
      body: 'A like stops being free. Each one locks real sats for a fixed number of blocks — a small, revocable bet on whatever just caught your attention.',
    },
    {
      icon: ThumbsUp,
      iconProps: { fill: 'currentColor' },
      eyebrow: '02 · Like',
      title: 'Signed on-chain',
      body: 'Every like is a MAP social-action output tied to the post it loves, publishing a recognizable, interoperable signal that lives outside this app.',
    },
    {
      icon: Coins,
      eyebrow: '03 · Mint',
      title: '$VZN, by contract',
      body: 'If the lock qualifies, the LLM-21 contract mints a fixed reward in $VZN — a BSV21 fungible token — straight to the liker. The contract, not the app, decides what counts.',
    },
  ]

  return (
    <section className="relative mx-auto w-full max-w-6xl px-6 pb-12 pt-12 sm:pb-16 sm:pt-16">
      <SectionHeading
        eyebrow="The primitive"
        title={
          <>
            Three moves, enforced{' '}
            <span className="text-muted-foreground">on-chain.</span>
          </>
        }
      />

      <div className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-3xl border border-border/60 bg-border/50 md:grid-cols-3">
        {pillars.map((p) => (
          <div
            key={p.eyebrow}
            className="group relative flex flex-col gap-6 bg-background/80 p-8 backdrop-blur transition-colors hover:bg-background"
          >
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-500 transition-colors group-hover:border-amber-400/60 group-hover:bg-amber-400/20 dark:text-amber-300">
              <p.icon className="h-5 w-5" {...(p.iconProps ?? {})} />
            </div>
            <div className="flex-1">
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {p.eyebrow}
              </div>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                {p.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {p.body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* How it works                                                               */
/* -------------------------------------------------------------------------- */

function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Create a wallet',
      body: 'Keys are generated locally, encrypted with a passphrase via BIP38, and stored only in your profile blob. Nothing leaves your browser in the clear.',
    },
    {
      n: '02',
      title: 'Pick a post',
      body: 'Browse NEW for what is happening right now or TOP for what the network is putting capital behind. A quiet post can rise if conviction shows up.',
    },
    {
      n: '03',
      title: 'Broadcast a lock-like-mint',
      body: 'The app assembles one transaction: a lockup output, a MAP like output, a $VZN mint, the service fee, and your change. ARC does the broadcast.',
    },
    {
      n: '04',
      title: 'Unlock when it matures',
      body: 'When blocks pass, your vault shows what is unlockable. One batched transaction spends the locked outputs back to your payment key.',
    },
  ]

  return (
    <section
      id="how"
      className="relative mx-auto w-full max-w-6xl px-6 pb-12 pt-12 sm:pb-16 sm:pt-16"
    >
      <SectionHeading
        eyebrow="How it works"
        title={
          <>
            One transaction.{' '}
            <span className="text-muted-foreground">
              Five enforced outputs.
            </span>
          </>
        }
      />

      <div className="mt-16 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <ol className="relative space-y-10 before:absolute before:left-[15px] before:top-2 before:h-[calc(100%-2rem)] before:w-px before:bg-gradient-to-b before:from-amber-400/40 before:via-border before:to-transparent">
          {steps.map((s) => (
            <li key={s.n} className="relative pl-14">
              <span className="absolute left-0 top-0 inline-flex h-8 w-8 items-center justify-center rounded-full border border-amber-400/40 bg-background font-mono text-[11px] text-amber-500 shadow-[0_0_0_4px_hsl(var(--background))] dark:text-amber-300">
                {s.n}
              </span>
              <h3 className="text-lg font-semibold tracking-tight text-foreground">
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </li>
          ))}
        </ol>

        <TxDiagram />
      </div>
    </section>
  )
}

function TxDiagram() {
  const outputs = [
    { label: 'State', note: 'smart contract state' },
    { label: 'Lockup', note: 'Your block-locked sats', highlight: true },
    { label: 'bSocial Like', note: 'type like tx <txid>', highlight: true },
    { label: 'Reward', note: '$VZN (BSV21) mint', highlight: true },
    { label: 'Service fee', note: '100k sats' },
    { label: 'Change', note: 'Back to your wallet' },
  ]
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-b from-background/80 to-background/40 p-6 backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Tx outputs · ordered
        </div>
        <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] text-amber-600 dark:text-amber-300">
          LLM-21
        </span>
      </div>

      <ul className="mt-5 space-y-2.5">
        {outputs.map((o, i) => (
          <li
            key={o.label}
            className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 text-sm transition-colors ${
              o.highlight
                ? 'border-amber-400/40 bg-amber-400/[0.06] text-foreground'
                : 'border-border/60 bg-background/60 text-muted-foreground'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-[11px] text-muted-foreground/80">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="font-medium text-foreground">{o.label}</span>
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              {o.note}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        The contract verifies{' '}
        <code className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
          nLockTime
        </code>
        , sequence, minimum sats, and the exact output shape. If any part
        is off, the mint fails.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Feed split                                                                 */
/* -------------------------------------------------------------------------- */

function FeedSplit() {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-6 pb-12 pt-12 sm:pb-16 sm:pt-16">
      <SectionHeading
        eyebrow="The feed"
        title={
          <>
            Two questions.{' '}
            <span className="text-muted-foreground">Two feeds.</span>
          </>
        }
      />

      <div className="mt-16 grid gap-6 lg:grid-cols-2">
        <FeedCard
          icon={Flame}
          tag="NEW"
          question="What is happening right now?"
          bullets={[
            'Latest posts first, updated in realtime',
            'New activity indicator while you scroll',
            'Tap NEW again to jump back to the top',
          ]}
          cta={{ href: '/', label: 'Browse NEW' }}
        />
        <FeedCard
          icon={TrendingUp}
          tag="TOP"
          question="What is the network locking behind?"
          bullets={[
            'Ranked by active, lock-backed conviction',
            'Time windows: day, week, month, year, all',
            'Quiet posts can rise when capital shows up',
          ]}
          cta={{ href: '/?tab=top', label: 'Browse TOP' }}
        />
      </div>
    </section>
  )
}

function FeedCard({
  icon: Icon,
  tag,
  question,
  bullets,
  cta,
}: {
  icon: typeof Flame
  tag: string
  question: string
  bullets: string[]
  cta: { href: string; label: string }
}) {
  return (
    <div className="group relative overflow-hidden rounded-3xl border border-border/60 bg-background/70 p-8 backdrop-blur transition-colors hover:border-amber-400/40">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-0 h-48 w-48 rounded-full bg-amber-400/10 blur-3xl opacity-0 transition-opacity group-hover:opacity-100"
      />
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {tag}
        </span>
      </div>
      <h3 className="mt-6 font-vzn-headings text-3xl font-normal tracking-tight text-foreground">
        {question}
      </h3>
      <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
        {bullets.map((b) => (
          <li key={b} className="flex gap-3">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-amber-400" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <Link
        href={cta.href}
        className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground transition-colors hover:text-amber-500 dark:hover:text-amber-300"
      >
        {cta.label}
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Contract / trust                                                           */
/* -------------------------------------------------------------------------- */

function Contract() {
  return (
    <section
      id="contract"
      className="relative mx-auto w-full max-w-6xl px-6 pb-12 pt-12 sm:pb-16 sm:pt-16"
    >
      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-b from-amber-400/[0.06] via-background to-background p-10 sm:p-14">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full bg-amber-400/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl"
        />

        <div className="relative grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">
              <Shield className="h-3.5 w-3.5" />
              Contract, not server
            </div>
            <h2 className="mt-6 font-vzn-headings text-4xl font-normal leading-tight tracking-tight sm:text-5xl">
              The rules live on-chain.{' '}
              <span className="text-muted-foreground">
                The app just helps you follow them.
              </span>
            </h2>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
              Supabase stores session state and a mirror of social activity
              for fast reads. It is not the source of truth for likes.
              Whether a like counts — and whether $VZN gets minted — is
              decided by the LLM-21 contract, verifiable by anyone.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/trade"
                className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition-transform hover:scale-[1.02]"
              >
                <Sparkles className="h-4 w-4" />
                View $VZN market
              </Link>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-5 py-2.5 text-sm font-semibold text-foreground backdrop-blur transition-colors hover:border-foreground/30"
              >
                <Github className="h-4 w-4" />
                Read the source
              </a>
            </div>
          </div>

          <CodeCard />
        </div>
      </div>
    </section>
  )
}

function CodeCard() {
  const lines: Array<{ t: string; c?: string }> = [
    { t: 'contract ', c: 'text-amber-500 dark:text-amber-300' },
    { t: 'LockLikeMintBSV21 ', c: 'text-foreground font-semibold' },
    { t: '{\n', c: 'text-muted-foreground' },
    { t: '  assert(', c: 'text-muted-foreground' },
    { t: 'nLockTime', c: 'text-foreground' },
    { t: ' >= ', c: 'text-muted-foreground' },
    { t: 'lastHeight', c: 'text-foreground' },
    { t: ');\n', c: 'text-muted-foreground' },
    { t: '  assert(', c: 'text-muted-foreground' },
    { t: 'sequence', c: 'text-foreground' },
    { t: ' < 0xffffffff);\n', c: 'text-muted-foreground' },
    { t: '  assert(', c: 'text-muted-foreground' },
    { t: 'lockedSats', c: 'text-foreground' },
    { t: ' >= ', c: 'text-muted-foreground' },
    { t: 'minSats', c: 'text-foreground' },
    { t: ');\n', c: 'text-muted-foreground' },
    { t: '  assert(', c: 'text-muted-foreground' },
    { t: 'outputHash', c: 'text-foreground' },
    { t: ' == ', c: 'text-muted-foreground' },
    { t: 'expected', c: 'text-foreground' },
    { t: ');\n', c: 'text-muted-foreground' },
    { t: '  // mint(lim) capped by supply\n', c: 'text-muted-foreground/60' },
    { t: '}', c: 'text-muted-foreground' },
  ]
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-background/80 shadow-[0_20px_60px_-30px_rgba(245,158,11,0.4)] backdrop-blur">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/60" />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          LockLikeMintBSV21.ts
        </span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[12px] leading-6">
        <code className="whitespace-pre">
          {lines.map((l, i) => (
            <span key={i} className={l.c}>
              {l.t}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Final CTA                                                                  */
/* -------------------------------------------------------------------------- */

function FinalCta() {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-6 pb-24 pt-12 sm:pb-32 sm:pt-16">
      <div className="relative mx-auto flex max-w-3xl flex-col items-center text-center">
        <h2 className="font-vzn-headings text-5xl font-normal leading-[1.05] tracking-tight sm:text-6xl">
          Post something{' '}
          <span
            className={`${GOLD_TEXT} drop-shadow-[0_0_24px_rgba(245,158,11,0.35)]`}
          >
            worth locking up for.
          </span>
        </h2>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Creating a wallet is free. Every interaction after that is priced
          in the only unit that does not lie: your own sats.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <Link
            href="/"
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-7 py-3.5 text-sm font-semibold text-background transition-transform hover:scale-[1.02]"
          >
            Enter the feed
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/leaderboard"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-background/60 px-7 py-3.5 text-sm font-semibold text-foreground backdrop-blur transition-colors hover:border-foreground/30 hover:bg-background"
          >
            See the leaderboard
          </Link>
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Footer                                                                     */
/* -------------------------------------------------------------------------- */

function SiteFooter() {
  return (
    <footer className="relative border-t border-border/50 bg-background/60 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-6 px-6 py-10 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <span
            className={`font-vzn-headings text-xl ${GOLD_TEXT}`}
          >
            VZN.gold
          </span>
          <span className="text-xs text-muted-foreground">
            Lock. Like. Mint.
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Feed
          </Link>
          <Link href="/trade" className="hover:text-foreground">
            Trade
          </Link>
          <Link href="/leaderboard" className="hover:text-foreground">
            Leaderboard
          </Link>
        </nav>
      </div>
    </footer>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */
/* -------------------------------------------------------------------------- */

function SectionHeading({
  eyebrow,
  title,
}: {
  eyebrow: string
  title: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">
        {eyebrow}
      </div>
      <h2 className="mt-6 font-vzn-headings text-4xl font-normal leading-[1.1] tracking-tight sm:text-5xl">
        {title}
      </h2>
    </div>
  )
}
