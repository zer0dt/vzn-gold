import Link from 'next/link'

const LAST_UPDATED = 'April 25, 2026'

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">VZN.gold</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
      </div>

      <div className="space-y-6 text-sm leading-6 text-foreground/90">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">1. Data we collect</h2>
          <p>Depending on how you use VZN.gold, we may process:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Account data from Supabase Auth (such as email and user ID).</li>
            <li>Profile data (username, avatar URL, cover image URL).</li>
            <li>Wallet profile fields (owner address, payment address, passkey credential ID).</li>
            <li>Encrypted wallet key material (BIP38-encrypted owner and payment keys).</li>
            <li>Post, reply, and like-related activity you create in the app.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">2. Data stored on your device</h2>
          <p>
            The app uses browser storage for wallet/session behavior and passkey-assisted flows.
            Encrypted passkey records are stored in local browser storage and wallet session values
            may be stored in session storage and cleared on logout.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">3. How we use data</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Authenticate users and maintain sessions.</li>
            <li>Create and maintain profiles and wallet linkage.</li>
            <li>Support post/reply/like functionality and feed rendering.</li>
            <li>Enable signing/broadcast workflows and network status displays.</li>
            <li>Detect, prevent, and debug abuse or service issues.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">4. Third-party services</h2>
          <p>VZN.gold integrates external services that may process related request data:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Supabase (authentication, database, and related backend services).</li>
            <li>Google OAuth when you choose Google sign-in.</li>
            <li>Blockchain infrastructure providers for UTXO lookup and broadcasting.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">5. Public blockchain data</h2>
          <p>
            Content or metadata written to public blockchains may be permanent and publicly visible.
            We cannot guarantee deletion or reversal of on-chain records.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">6. Security</h2>
          <p>
            We use reasonable safeguards, but no method of transmission or storage is completely
            secure. You are responsible for protecting your credentials, passkeys, and device.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">7. Policy updates</h2>
          <p>
            We may update this policy over time. Continued use of VZN.gold after updates indicates
            acceptance of the revised policy.
          </p>
        </section>
      </div>

      <div className="mt-10 border-t border-border/60 pt-5 text-xs text-muted-foreground">
        <span>See also: </span>
        <Link href="/terms" className="underline-offset-4 hover:underline">
          Terms and Conditions
        </Link>
      </div>
    </main>
  )
}
