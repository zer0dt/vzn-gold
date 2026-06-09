"use client"

type TxPageTitleProps = {
  txid: string
}

export default function TxPageTitle({ txid }: TxPageTitleProps) {
  const truncatedTxid = `${txid.slice(0, 6)}...${txid.slice(-6)}`
  const whatsonchainUrl = `https://whatsonchain.com/tx/${txid}`

  return (
    <h1 className="font-vzn-headings text-xl font-normal tracking-tight">
      <a
        href={whatsonchainUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-left transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        title="Open transaction on WhatsOnChain"
        aria-label="Open transaction on WhatsOnChain"
      >
        {truncatedTxid}
      </a>
    </h1>
  )
}
