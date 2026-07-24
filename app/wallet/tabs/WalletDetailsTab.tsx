"use client";

import { Copy, Download, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/app/components/ui/alert";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { wocAddressUrl, wocTxUrl } from "@/app/lib/explorer";
import { formatShortTxid } from "@/app/lib/utils";

type UnconfirmedTx = { txid: string; value: number };

export type WalletDetailsTabProps = {
  copyToClipboard: (text: string) => void;
  profileOwnerAddress: string | null | undefined;
  profilePaymentAddress: string | null | undefined;
  isFetchingBalance: boolean;
  fetchDetailedBalance: () => void | Promise<void>;
  walletBalance: number;
  calculateUSDValue: (sats: number) => string | number;
  confirmedBalance: number;
  unconfirmedTxs: UnconfirmedTx[];
  isUpdatingProfile: boolean;
  isSending: boolean;
  setIsSendDialogOpen: (open: boolean) => void;
  setIsPrepareMintDialogOpen: (open: boolean) => void;
  backupWallet: (filename: string) => void | Promise<void>;
};

export default function WalletDetailsTab(props: WalletDetailsTabProps) {
  const {
    copyToClipboard,
    profileOwnerAddress,
    profilePaymentAddress,
    isFetchingBalance,
    fetchDetailedBalance,
    walletBalance,
    calculateUSDValue,
    confirmedBalance,
    unconfirmedTxs,
    isUpdatingProfile,
    isSending,
    setIsSendDialogOpen,
    setIsPrepareMintDialogOpen,
    backupWallet,
  } = props;

  return (
    <Card className="w-full rounded-2xl border-border/60 bg-background/60 backdrop-blur shadow-none">
      <CardContent className="space-y-4 mt-4">
        <div className="p-3 rounded-xl border border-border/60 bg-background/60 space-y-1 backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Owner address
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-full hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300"
              onClick={() => copyToClipboard(profileOwnerAddress || "")}
              title="Copy Owner Address"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="font-mono text-xs sm:text-sm break-all text-foreground/90">
            {profileOwnerAddress || "Not Set"}
          </p>
        </div>
        <div className="p-3 rounded-xl border border-border/60 bg-background/60 space-y-1 backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Payment address
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-full hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300"
              onClick={() => copyToClipboard(profilePaymentAddress || "")}
              title="Copy Payment Address"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="font-mono text-xs sm:text-sm break-all text-foreground/90">
            {profilePaymentAddress || "Not Set"}
          </p>
          {profilePaymentAddress && (
            <div className="flex items-center space-x-2 pt-2">
              <a
                href={wocAddressUrl(profilePaymentAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-amber-600 dark:hover:text-amber-300 transition-colors"
              >
                WhatsOnChain
              </a>
              <span className="text-xs text-muted-foreground/50">·</span>
              <a
                href={`https://bitails.io/address/${profilePaymentAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-amber-600 dark:hover:text-amber-300 transition-colors"
              >
                Bitails
              </a>
            </div>
          )}
        </div>

        <div className="pt-4 space-y-4 border-t border-border/60 mt-4">
          <div
            className="text-center cursor-pointer group"
            onClick={!isFetchingBalance ? fetchDetailedBalance : undefined}
            title="Click to refresh balance with confirmation details"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Wallet balance
            </p>
            <div className="flex items-center justify-center mt-1">
              <p className="text-2xl font-bold font-mono tabular-nums text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24]">
                {walletBalance.toLocaleString("en-US")}{" "}
                <span className="text-lg font-sans -ml-2">sats</span>
              </p>
              {isFetchingBalance ? (
                <Loader2 className="h-5 w-5 ml-2 animate-spin text-amber-500 dark:text-amber-400" />
              ) : (
                <RefreshCw className="h-4 w-4 ml-2 text-muted-foreground group-hover:text-amber-500 dark:group-hover:text-amber-300 transition-colors" />
              )}
            </div>
            <p className="text-sm text-muted-foreground font-sans">
              ${calculateUSDValue(walletBalance)} USD
            </p>

            <div className="mt-3 pt-3 border-t border-border/60">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="text-center">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Confirmed</p>
                  <p className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums mt-1">
                    {confirmedBalance.toLocaleString()} sats
                  </p>
                  <p className="text-muted-foreground text-xs">
                    ${calculateUSDValue(confirmedBalance)}
                  </p>
                </div>
                <div className="text-center">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    Unconfirmed
                  </p>
                  <p className="font-mono font-semibold text-amber-600 dark:text-amber-400 tabular-nums mt-1">
                    {(() => {
                      const uniqueTxs = unconfirmedTxs.filter(
                        (tx, index: number, arr: UnconfirmedTx[]) =>
                          arr.findIndex((t) => t.txid === tx.txid) === index,
                      );
                      return `${uniqueTxs.length} ${uniqueTxs.length === 1 ? "transaction" : "transactions"}`;
                    })()}
                  </p>
                  {unconfirmedTxs.length > 0 && (
                    <div className="text-muted-foreground text-xs space-y-1 mt-1">
                      {(() => {
                        const uniqueTxs = unconfirmedTxs.filter(
                          (tx, index: number, arr: UnconfirmedTx[]) =>
                            arr.findIndex((t) => t.txid === tx.txid) === index,
                        );
                        return uniqueTxs.slice(0, 3).map((tx) => (
                          <div key={tx.txid}>
                            <a
                              href={wocTxUrl(tx.txid)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-muted-foreground hover:text-amber-600 dark:hover:text-amber-300 transition-colors"
                            >
                              {formatShortTxid(tx.txid, {
                                headChars: 8,
                                tailChars: 8,
                              })}
                            </a>
                          </div>
                        ));
                      })()}
                      {(() => {
                        const uniqueTxs = unconfirmedTxs.filter(
                          (tx, index: number, arr: UnconfirmedTx[]) =>
                            arr.findIndex((t) => t.txid === tx.txid) === index,
                        );
                        return (
                          uniqueTxs.length > 3 && (
                            <div className="text-xs text-muted-foreground">
                              +{uniqueTxs.length - 3} more
                            </div>
                          )
                        );
                      })()}
                    </div>
                  )}
                  {unconfirmedTxs.length === 0 && (
                    <p className="text-muted-foreground text-xs">None</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <Alert className="rounded-xl border border-amber-400/30 bg-gradient-to-b from-amber-400/[0.08] to-amber-400/[0.02] backdrop-blur">
            <div className="flex items-start gap-2">
              <Download className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div>
                <AlertTitle className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  Back up your keys
                </AlertTitle>
                <AlertDescription className="text-xs text-amber-700/80 dark:text-amber-300/80">
                  Your encrypted keys are saved in our database, but we
                  recommend downloading a local backup in case the website ever
                  goes down.
                </AlertDescription>
              </div>
            </div>
          </Alert>

          <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
            <Button
              variant="outline"
              className="flex-1 rounded-full border-border/70 bg-background/60 backdrop-blur transition-colors hover:border-amber-400/60 hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300"
              onClick={() => setIsSendDialogOpen(true)}
              disabled={isUpdatingProfile || isFetchingBalance || isSending}
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Send
            </Button>
            <Button
              variant="outline"
              className="flex-1 rounded-full border-border/70 bg-background/60 backdrop-blur transition-colors hover:border-amber-400/60 hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300"
              onClick={() => setIsPrepareMintDialogOpen(true)}
              disabled={isUpdatingProfile || isFetchingBalance || isSending || walletBalance <= 0}
              title="Split balance into funding UTXOs for LLMs"
            >
              Prepare UTXOs
            </Button>
            <Button
              variant="outline"
              className="flex-1 rounded-full border-border/70 bg-background/60 backdrop-blur transition-colors hover:border-amber-400/60 hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300"
              onClick={() => backupWallet("wallet-backup")}
              disabled={isUpdatingProfile || isFetchingBalance}
            >
              Backup
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
