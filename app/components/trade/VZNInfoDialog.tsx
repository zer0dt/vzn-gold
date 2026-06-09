"use client";

import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { wocTxUrl } from "@/app/lib/explorer";
import type { TokenMeta } from "@/types";

type VZNInfoDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

function formatNumberStringWithCommas(input: string): string {
  const [rawInt, rawFrac] = input.split(".");
  const sign = rawInt.startsWith("-") ? "-" : "";
  const intDigits = rawInt.replace(/^-/, "");
  const withCommas = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + withCommas + (rawFrac ? `.${rawFrac}` : "");
}

function CopyButton({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleCopy}
      className={className}
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </Button>
  );
}

// Responsive ID display - truncated on mobile, full on desktop
function ResponsiveId({
  value,
  startChars = 6,
  endChars = 8,
}: {
  value: string;
  startChars?: number;
  endChars?: number;
}) {
  if (!value) return null;

  const start = value.slice(0, startChars);
  const end = value.slice(-endChars);
  const isTruncatable = value.length > startChars + endChars + 3;

  return (
    <>
      {/* Mobile: truncated */}
      <span className="font-mono text-xs sm:hidden" title={value}>
        {isTruncatable ? (
          <>
            {start}
            <span className="text-muted-foreground">…</span>
            {end}
          </>
        ) : (
          value
        )}
      </span>
      {/* Desktop: full */}
      <span className="font-mono text-xs hidden sm:inline break-all">
        {value}
      </span>
    </>
  );
}

export default function VZNInfoDialog({
  isOpen,
  onOpenChange,
}: VZNInfoDialogProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tokenMeta, setTokenMeta] = useState<TokenMeta>({});
  const [remainingDisplay, setRemainingDisplay] = useState<
    string | undefined
  >();
  const [remainingSym, setRemainingSym] = useState<string>("$VZN");
  const [totalRaw, setTotalRaw] = useState<string | undefined>();
  const [originId, setOriginId] = useState<string>("");
  const [originTxid, setOriginTxid] = useState<string>("");
  const [latestOutpoint, setLatestOutpoint] = useState<string>("");
  const [latestOutpointTxid, setLatestOutpointTxid] = useState<string>("");

  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Use our API route to avoid CORS issues with external APIs
        const res = await fetch("/api/vzn/token-info");
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to fetch token info");
        }

        const data = await res.json();

        setOriginId(data.originId || "");
        setOriginTxid(data.originTxid || "");
        setLatestOutpoint(data.latestOutpoint || "");
        setLatestOutpointTxid(data.latestOutpointTxid || "");
        setTokenMeta(data.tokenMeta || {});
        setTotalRaw(data.totalRaw);
        setRemainingDisplay(data.remainingAmt);
        setRemainingSym(data.remainingSym || "$VZN");
      } catch (err) {
        console.error("Error fetching VZN data:", err);
        setError("Failed to load token data");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [isOpen]);

  const remainingWithCommas = remainingDisplay
    ? formatNumberStringWithCommas(remainingDisplay)
    : undefined;
  const totalWithCommas = totalRaw
    ? formatNumberStringWithCommas(totalRaw)
    : undefined;

  const preferredOrder = [
    "contract",
    "sym",
    "p",
    "op",
    "amt",
    "dec",
    "sats",
    "blocks",
    "lim",
    "contractStart",
  ];
  const metaEntries = Object.entries(tokenMeta || {});
  const orderedMetaEntries: Array<[string, unknown]> = [
    ...preferredOrder.flatMap((key) =>
      key in tokenMeta
        ? ([[key, tokenMeta[key]]] as Array<[string, unknown]>)
        : [],
    ),
    ...metaEntries.filter(([k]) => !preferredOrder.includes(k)),
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_20px_50px_-20px_rgba(0,0,0,0.55)]">
        <DialogHeader>
          <DialogTitle className="font-vzn-headings text-2xl font-normal tracking-tight">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24]">$VZN</span> Token Info
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500 dark:text-amber-400" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 backdrop-blur p-4">
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Supply Info */}
            {remainingDisplay && (
              <div className="rounded-xl border border-amber-400/30 bg-gradient-to-b from-amber-400/[0.08] to-amber-400/[0.02] backdrop-blur p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  {totalWithCommas && (
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        Total supply
                      </div>
                      <div className="inline-flex items-center gap-1 text-xl font-extrabold text-foreground tracking-tight font-mono tabular-nums">
                        {totalWithCommas}
                        <span className="ml-1 inline-block rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] text-amber-600 dark:text-amber-300">
                          {remainingSym}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="sm:pl-6 sm:ml-6 sm:border-l border-border/60 sm:text-right">
                    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Supply remaining
                    </div>
                    <div className="inline-flex items-center gap-1 text-xl font-extrabold font-mono tabular-nums">
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24]">
                        {remainingWithCommas}
                      </span>
                      <span className="ml-1 inline-block rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] text-amber-600 dark:text-amber-300">
                        {remainingSym}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Contract Links */}
            <div className="rounded-xl border border-border/60 bg-background/60 backdrop-blur p-5">
              <h2 className="font-vzn-headings text-lg font-normal tracking-tight mb-3">
                Contract
              </h2>
              <div className="space-y-0">
                <div className="flex items-center justify-between gap-2 py-3 border-t first:border-t-0 border-border/60">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground shrink-0">
                    Origin ID
                  </div>
                  <div className="flex items-center gap-1 min-w-0">
                    <code className="px-2 py-1 rounded-md border border-border/60 bg-background/70 backdrop-blur min-w-0">
                      <ResponsiveId
                        value={originId}
                        startChars={6}
                        endChars={8}
                      />
                    </code>
                    <CopyButton value={originId} className="rounded-full hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300" />
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      className="shrink-0 rounded-full hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300"
                    >
                      <a
                        href={wocTxUrl(originTxid)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 py-3 border-t border-border/60">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground shrink-0">
                    Latest TX
                  </div>
                  <div className="flex items-center gap-1 min-w-0">
                    <code className="px-2 py-1 rounded-md border border-border/60 bg-background/70 backdrop-blur min-w-0">
                      <ResponsiveId
                        value={latestOutpoint}
                        startChars={6}
                        endChars={8}
                      />
                    </code>
                    <CopyButton value={latestOutpoint} className="rounded-full hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300" />
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      className="shrink-0 rounded-full hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300"
                    >
                      <a
                        href={wocTxUrl(latestOutpointTxid)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Token Metadata */}
            <div className="rounded-xl border border-border/60 bg-background/60 backdrop-blur p-5">
              <h2 className="font-vzn-headings text-lg font-normal tracking-tight mb-3">
                Token Info
              </h2>
              {orderedMetaEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No token metadata found.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {orderedMetaEntries.map(([k, v]) => (
                    <div
                      key={k}
                      className="flex items-start justify-between gap-3 py-2.5"
                    >
                      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground min-w-[120px]">
                        {k}
                      </div>
                      <div className="text-sm font-mono break-all flex-1 tabular-nums">
                        {typeof v === "object" && v !== null
                          ? JSON.stringify(v)
                          : String(v)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
