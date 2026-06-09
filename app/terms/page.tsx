import Link from 'next/link'

const LAST_UPDATED = 'April 25, 2026'

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">VZN.gold</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Terms and Conditions</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
      </div>

      <div className="space-y-6 text-sm leading-6 text-foreground/90">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">1. Acceptance</h2>
          <p>
            By using VZN.gold, you agree to these Terms. If you do not agree, do not use the app.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">2. Your account and security</h2>
          <p>
            You are responsible for your account credentials, wallet password, and device security.
            Wallet decrypt operations happen locally in your browser, and your password is not
            recoverable by us. If you lose your password, encrypted keys may be permanently
            inaccessible.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">3. Wallet and blockchain risks</h2>
          <p>
            Blockchain transactions are generally irreversible. You are solely responsible for
            transaction accuracy, wallet operations, private-key handling, and compliance with
            applicable laws where you use the app.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">4. User content</h2>
          <p>
            You are responsible for content you post or sign. Do not upload or publish unlawful,
            infringing, abusive, or malicious content. Public blockchain and public-feed content may
            be visible to others.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">5. Service availability</h2>
          <p>
            We may modify, suspend, or discontinue features at any time. We do not guarantee
            uninterrupted availability, perfect uptime, or error-free operation.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">6. No investment advice</h2>
          <p>
            Content, token data, and network information in the app are provided for informational
            purposes only and do not constitute financial, legal, or tax advice.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">7. Liability limits</h2>
          <p>
            To the maximum extent allowed by law, VZN.gold is provided "as is" without warranties.
            We are not liable for indirect, incidental, special, or consequential damages, including
            lost profits, data loss, or asset loss resulting from your use of the app.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">8. Changes to these Terms</h2>
          <p>
            We may update these Terms over time. Continued use of the app after updates means you
            accept the revised Terms.
          </p>
        </section>
      </div>

      <div className="mt-10 border-t border-border/60 pt-5 text-xs text-muted-foreground">
        <span>See also: </span>
        <Link href="/privacy" className="underline-offset-4 hover:underline">
          Privacy Policy
        </Link>
      </div>
    </main>
  )
}
