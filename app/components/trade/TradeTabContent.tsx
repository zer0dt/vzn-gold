"use client";

import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import Image from "next/image";
import React, { useCallback, useEffect, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { useBlockHeightContext } from "@/app/contexts/BlockHeightContext";
import { useNetworkStats } from "@/app/hooks/use-network-stats";
import { useToast } from "@/app/hooks/use-toast";
import { useWallet } from "@/app/hooks/use-wallet";
import { wocTxUrl } from "@/app/lib/explorer";
import { formatTokenTicker } from "@/app/lib/formatTokenTicker";
import { getCachedNetworkStats } from "@/app/lib/network-stats-client";
import VZNInfoDialog from "./VZNInfoDialog";
import VZNPriceChart from "./VZNPriceChart";

interface TradeTabContentProps {
  calculateUSDValue: (sats: number) => number;
  bsvPrice: number | null;
}

export function TradeTabContent({
  calculateUSDValue,
  bsvPrice,
}: TradeTabContentProps) {
  const { data: networkStats } = useNetworkStats();
  const ticker = formatTokenTicker(networkStats?.symbol ?? "VZN");

  // Get current block height for chart filtering
  const { blockHeight: currentBlockHeight } = useBlockHeightContext();

  // VZN state
  const [vznBalance, setVznBalance] = useState<number>(0);
  const [isFetchingVznBalance, setIsFetchingVznBalance] =
    useState<boolean>(false);
  const [isVZNInfoOpen, setIsVZNInfoOpen] = useState<boolean>(false);
  // List Tokens modal state
  const [isListTokensModalOpen, setIsListTokensModalOpen] = useState(false);
  const [tokenUtxos, setTokenUtxos] = useState<
    Array<{
      txid: string;
      vout: number;
      outpoint: string;
      amt: string;
      script: string;
      owner: string;
    }>
  >([]);
  // User's active token listings (for "My Orders")
  const [userTokenListings, setUserTokenListings] = useState<
    Array<{
      txid: string;
      vout: number;
      outpoint: string;
      amt: string;
      script: string;
      owner: string;
      price: string;
      pricePer: string;
    }>
  >([]);
  const [isFetchingTokenUtxos, setIsFetchingTokenUtxos] = useState(false);
  const [listingPricePerToken, setListingPricePerToken] = useState("");
  const [tokensToList, setTokensToList] = useState("");

  // Marketplace listings (all listings for the VZN token)
  const [marketplaceListings, setMarketplaceListings] = useState<
    Array<{
      txid: string;
      vout: number;
      outpoint: string;
      amt: string;
      owner: string;
      price: string;
      pricePer: string;
      height: number | null;
      script: string;
      payout: string;
    }>
  >([]);
  const [isFetchingMarketplaceListings, setIsFetchingMarketplaceListings] =
    useState(false);

  // VZN Sales History state
  const [vznSalesHistory, setVznSalesHistory] = useState<
    Array<{
      txid: string;
      outpoint: string;
      amt: string;
      price: string;
      pricePer: string;
      height: number | null;
      spendHeight: number | null;
      owner: string;
    }>
  >([]);
  const [isFetchingVznSales, setIsFetchingVznSales] = useState(false);

  // Tab state for VZN marketplace (Listed = all listings, Sales = history, My Orders = user's listings)
  const [activeVznTab, setActiveVznTab] = useState<
    "listed" | "sales" | "myorders"
  >("listed");

  // Track which specific listing is being cancelled
  const [cancellingOutpoint, setCancellingOutpoint] = useState<string | null>(
    null,
  );

  // Token purchase confirmation dialog state
  const [isTokenPurchaseDialogOpen, setIsTokenPurchaseDialogOpen] =
    useState(false);
  const [tokenPurchaseListing, setTokenPurchaseListing] = useState<{
    txid: string;
    vout: number;
    outpoint: string;
    amt: string;
    owner: string;
    price: string;
    pricePer: string;
    script?: string;
    payout: string;
    height: number | null;
  } | null>(null);

  // Import wallet functions
  const {
    ownerAddress,
    walletAddress,
    createTokenListing,
    isCreatingListing,
    purchaseTokenListing,
    isPurchasingToken,
    cancelTokenListing,
  } = useWallet();
  const { toast } = useToast();

  // Unified function to fetch token data (balance, available UTXOs, and listings)
  const fetchTokenData = useCallback(async () => {
    if (!ownerAddress) return;
    try {
      setIsFetchingVznBalance(true);
      setIsFetchingTokenUtxos(true);
      const res = await fetch(
        `/api/vzn/utxos?owner_address=${encodeURIComponent(ownerAddress)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to fetch token data");
      const data = await res.json();

      // Set available balance (excludes listed tokens)
      setVznBalance(data?.availableBalance ?? 0);

      // Set available UTXOs for creating new listings
      setTokenUtxos(data?.utxos ?? []);

      // Set user's current listings for "My Orders"
      setUserTokenListings(data?.listings ?? []);

      console.log("Fetched token data:", {
        availableBalance: data?.availableBalance,
        listedBalance: data?.listedBalance,
        utxosCount: data?.utxos?.length ?? 0,
        listingsCount: data?.listings?.length ?? 0,
      });
    } catch (err) {
      console.error("Error fetching token data:", err);
      toast({
        variant: "destructive",
        description: `Failed to fetch ${formatTokenTicker(getCachedNetworkStats()?.symbol ?? "VZN")} data`,
        duration: 2000,
      });
    } finally {
      setIsFetchingVznBalance(false);
      setIsFetchingTokenUtxos(false);
    }
  }, [ownerAddress, toast]);

  // Fetch token data when modal opens or on initial load
  useEffect(() => {
    if (isListTokensModalOpen && ownerAddress) {
      fetchTokenData();
    }
  }, [isListTokensModalOpen, ownerAddress, fetchTokenData]);

  // Fetch marketplace listings for the VZN token
  const fetchMarketplaceListings = useCallback(async () => {
    const tokenId = process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID;
    if (!tokenId) {
      console.error("Token ID not configured");
      return;
    }

    try {
      setIsFetchingMarketplaceListings(true);
      const url = `https://ordinals.gorillapool.io/api/bsv20/market?sort=price&dir=asc&limit=100&offset=0&type=all&id=${encodeURIComponent(tokenId)}`;
      const res = await fetch(url, { cache: "no-store" });

      if (!res.ok) {
        if (res.status === 404) {
          // No listings found
          setMarketplaceListings([]);
          return;
        }
        throw new Error("Failed to fetch marketplace listings");
      }

      const data = await res.json();
      const rawRows = Array.isArray(data) ? data : [];
      const activeListings = rawRows.filter(
        (listing: { listing?: boolean; spend?: string }) =>
          listing.listing === true && (!listing.spend || listing.spend === ""),
      );
      setMarketplaceListings(activeListings);
      console.log("Fetched marketplace listings:", activeListings.length);
    } catch (err) {
      console.error("Error fetching marketplace listings:", err);
      setMarketplaceListings([]);
    } finally {
      setIsFetchingMarketplaceListings(false);
    }
  }, []);

  // Fetch VZN sales history from Gorilla Pool API
  const fetchVznSalesHistory = useCallback(async () => {
    try {
      setIsFetchingVznSales(true);
      const res = await fetch("/api/vzn/sales");

      if (!res.ok) {
        if (res.status === 404) {
          setVznSalesHistory([]);
          return;
        }
        throw new Error("Failed to fetch sales history");
      }

      const data = await res.json();
      const saleRows = Array.isArray(data) ? data : [];
      const completedSales = saleRows.filter(
        (sale: { sale?: boolean }) => sale.sale === true,
      );
      completedSales.sort(
        (a: { spendHeight?: number | null }, b: { spendHeight?: number | null }) =>
          (b.spendHeight ?? 0) - (a.spendHeight ?? 0),
      );
      setVznSalesHistory(completedSales);
      console.log("Fetched VZN sales history:", completedSales.length);
    } catch (err) {
      console.error("Error fetching sales history:", err);
      setVznSalesHistory([]);
    } finally {
      setIsFetchingVznSales(false);
    }
  }, []);

  // Fetch marketplace listings and sales history on component mount
  useEffect(() => {
    fetchMarketplaceListings();
    fetchVznSalesHistory();
  }, [fetchMarketplaceListings, fetchVznSalesHistory]);

  // Auto-fetch VZN balance when wallet is available
  useEffect(() => {
    if (walletAddress) {
      fetchTokenData();
    }
  }, [walletAddress, fetchTokenData]);

  return (
    <>
      <div className="mt-0 md:mt-4">
        {/* Chart + range controls */}
        <VZNPriceChart
          salesHistory={vznSalesHistory}
          currentBlockHeight={currentBlockHeight}
          isFetchingSales={isFetchingVznSales}
          bsvPrice={bsvPrice}
          calculateUSDValue={calculateUSDValue}
        />
        {/* Balance section */}
        <div className="mt-3 rounded-2xl border border-border/60 bg-background/60 backdrop-blur p-4 shadow-[0_0_0_1px_rgba(245,158,11,0.08)]">
          <div className="flex items-center justify-between">
            <div
              className="flex items-center space-x-3 group cursor-pointer"
              onClick={() => setIsVZNInfoOpen(true)}
            >
              <div className="w-12 h-12 rounded-full overflow-hidden ring-1 ring-amber-400/30 shadow-[0_8px_24px_-12px_rgba(245,158,11,0.45)] relative">
                <Image
                  src="/vision.png"
                  alt="VZN"
                  fill
                  className="object-cover"
                />
              </div>
              <div className="flex items-baseline gap-1.5">
                <h3 className="font-vzn-headings text-lg font-normal tracking-tight text-foreground group-hover:underline">
                  Vision
                </h3>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">({ticker})</span>
              </div>
            </div>
            <div
              className="text-right cursor-pointer group"
              onClick={!isFetchingVznBalance ? fetchTokenData : undefined}
              title={`Click to refresh ${ticker} balance`}
            >
              <div className="flex items-center space-x-2">
                <p className="text-xl sm:text-2xl font-normal text-foreground font-bitcount">
                  {isFetchingVznBalance
                    ? "..."
                    : vznBalance.toLocaleString()}
                </p>
                {isFetchingVznBalance ? (
                  <Loader2 className="h-4 w-4 animate-spin text-amber-500 dark:text-amber-400" />
                ) : (
                  <RefreshCw className="h-3 w-3 text-muted-foreground group-hover:text-amber-500 dark:group-hover:text-amber-300 transition-colors" />
                )}
              </div>
            </div>
          </div>
        </div>
        {/* Marketplace header with List Tokens button */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              className={`text-sm font-medium pb-1 border-b-2 transition-colors ${activeVznTab === "listed" ? "border-amber-400 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"} flex items-center gap-1`}
              onClick={() => {
                setActiveVznTab("listed");
                fetchMarketplaceListings();
              }}
            >
              Listed
              {marketplaceListings.length > 0 && (
                <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600 dark:text-amber-300">
                  {marketplaceListings.length}
                </span>
              )}
            </button>
            <button
              className={`text-sm font-medium pb-1 border-b-2 transition-colors ${activeVznTab === "sales" ? "border-emerald-400 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"} flex items-center gap-1`}
              onClick={() => {
                setActiveVznTab("sales");
                fetchVznSalesHistory();
              }}
            >
              Sales
              {vznSalesHistory.length > 0 && (
                <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-600 dark:text-emerald-300">
                  {vznSalesHistory.length}
                </span>
              )}
            </button>
            <button
              className={`text-sm font-medium pb-1 border-b-2 transition-colors ${activeVznTab === "myorders" ? "border-amber-400 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"} flex items-center gap-1`}
              onClick={() => {
                setActiveVznTab("myorders");
                // Refresh data when switching to My Orders
                fetchTokenData();
              }}
            >
              My Orders
              {userTokenListings.length > 0 && (
                <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600 dark:text-amber-300">
                  {userTokenListings.length}
                </span>
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setIsListTokensModalOpen(true)}
            className="group relative inline-flex h-8 items-center justify-center overflow-hidden rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 px-4 text-sm font-semibold text-black shadow-[0_8px_20px_-10px_rgba(245,158,11,0.55)] transition-all hover:scale-[1.01] hover:shadow-[0_12px_30px_-10px_rgba(245,158,11,0.75)]"
          >
            <span className="absolute inset-0 bg-gradient-to-r from-amber-300 via-amber-200 to-amber-300 opacity-0 transition-opacity group-hover:opacity-100" />
            <span className="relative">List Tokens</span>
          </button>
        </div>

        {/* Content based on active tab */}
        {activeVznTab === "listed" ? (
          /* Listed Tab - Marketplace listings */
          <div className="mt-4">
            {isFetchingMarketplaceListings ? (
              <div className="py-12 flex flex-col items-center">
                <Loader2 className="h-8 w-8 animate-spin text-amber-500 dark:text-amber-400 mb-4" />
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Loading marketplace listings…
                </p>
              </div>
            ) : marketplaceListings.length === 0 ? (
              <div className="py-12 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-amber-400/20 via-amber-400/10 to-transparent ring-1 ring-amber-400/30 shadow-[0_10px_30px_-10px_rgba(245,158,11,0.35)] flex items-center justify-center">
                  <Image
                    src="/vision.png"
                    alt="VZN"
                    width={40}
                    height={40}
                    className="rounded-full"
                  />
                </div>
                <h3 className="font-vzn-headings text-xl font-normal tracking-tight text-foreground mb-2">
                  No Listings Yet
                </h3>
                <p className="text-muted-foreground text-sm mb-4 max-w-sm mx-auto">
                  {`Be the first to list your ${ticker} tokens! Click the "List Tokens" button above to get started.`}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {marketplaceListings.map((listing) => {
                  const amount = parseInt(listing.amt, 10);
                  const priceTotal = parseInt(listing.price, 10);
                  const pricePerToken = amount > 0 ? priceTotal / amount : 0;
                  const usdValue = bsvPrice
                    ? (priceTotal / 100000000) * bsvPrice
                    : 0;
                  const isOwnListing = listing.owner === ownerAddress;

                  return (
                    <Card
                      key={listing.outpoint}
                      className={`p-3 rounded-2xl backdrop-blur transition-colors ${isOwnListing ? "border-amber-400/40 bg-gradient-to-b from-amber-400/[0.06] to-transparent hover:border-amber-400/60" : "border-border/60 bg-background/60 hover:border-amber-400/40"}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <a
                          href={wocTxUrl(listing.txid)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="View on WhatsOnChain"
                        >
                          <Badge
                            variant="outline"
                            className={`rounded-full font-mono text-[10px] uppercase tracking-[0.12em] cursor-pointer transition-colors ${
                              isOwnListing
                                ? "border-amber-400/40 bg-amber-400/10 text-amber-600 dark:text-amber-300 hover:bg-amber-400/20"
                                : "border-border/60 bg-background/70 text-muted-foreground hover:border-amber-400/40 hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300"
                            }`}
                          >
                            {isOwnListing ? "Your Listing" : "Listed"}{" "}
                            <ExternalLink className="h-2.5 w-2.5 ml-1 inline" />
                          </Badge>
                        </a>
                      </div>
                      <div className="text-2xl font-bold text-foreground mb-2 font-mono tabular-nums">
                        {amount.toLocaleString()}{" "}
                        <span className="text-lg font-bold text-foreground">
                          {ticker}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1 mb-1">
                        <span className="text-amber-600 dark:text-amber-300 font-semibold font-mono tabular-nums">
                          {pricePerToken.toLocaleString()}
                        </span>
                        <span className="text-xs text-muted-foreground">{`sats/${ticker}`}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mb-3">
                        $
                        {bsvPrice
                          ? ((pricePerToken / 100000000) * bsvPrice).toFixed(6)
                          : "0.00"}
                      </div>
                      <div className="flex items-center justify-between text-xs mb-3">
                        <span className="text-amber-600 dark:text-amber-300 font-medium font-mono tabular-nums">
                          {priceTotal.toLocaleString()} sats
                        </span>
                        <span className="text-muted-foreground">
                          ${usdValue.toFixed(2)}
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        className={`w-full h-8 rounded-full text-sm font-medium transition-colors backdrop-blur ${
                          isOwnListing
                            ? "border-red-500/60 bg-background/60 text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300"
                            : "border-amber-400/60 bg-background/60 text-amber-600 dark:text-amber-300 hover:bg-amber-400/10 hover:text-amber-700 dark:hover:text-amber-200"
                        }`}
                        disabled={
                          isPurchasingToken ||
                          cancellingOutpoint === listing.outpoint
                        }
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (isOwnListing) {
                            setCancellingOutpoint(listing.outpoint);
                            const tokenId =
                              process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID;
                            if (!tokenId) {
                              toast({
                                variant: "destructive",
                                description: "Token ID not configured",
                                duration: 2000,
                              });
                              setCancellingOutpoint(null);
                              return;
                            }
                            const result = await cancelTokenListing(
                              {
                                txid: listing.txid,
                                vout: listing.vout,
                                script: listing.script,
                                amt: listing.amt,
                              },
                              tokenId,
                            );
                            setCancellingOutpoint(null);
                            if (result.success) {
                              // Refresh the listings after successful cancellation
                              fetchMarketplaceListings();
                              fetchTokenData();
                            }
                          } else {
                            // Open confirmation dialog for purchase
                            setTokenPurchaseListing(listing);
                            setIsTokenPurchaseDialogOpen(true);
                          }
                        }}
                      >
                        {isOwnListing ? (
                          cancellingOutpoint === listing.outpoint ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-1" />{" "}
                              Cancelling...
                            </>
                          ) : (
                            "Cancel"
                          )
                        ) : (
                          "Buy"
                        )}
                      </Button>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        ) : activeVznTab === "sales" ? (
          /* Sales History Tab */
          <div className="mt-4">
            {isFetchingVznSales ? (
              <div className="py-12 flex flex-col items-center">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-500 dark:text-emerald-400 mb-4" />
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Loading sales history…
                </p>
              </div>
            ) : vznSalesHistory.length === 0 ? (
              <div className="py-12 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-500/20 via-emerald-500/10 to-transparent ring-1 ring-emerald-500/30 shadow-[0_10px_30px_-10px_rgba(16,185,129,0.35)] flex items-center justify-center">
                  <Image
                    src="/vision.png"
                    alt="VZN"
                    width={40}
                    height={40}
                    className="rounded-full"
                  />
                </div>
                <h3 className="font-vzn-headings text-xl font-normal tracking-tight text-foreground mb-2">
                  No Sales Yet
                </h3>
                <p className="text-muted-foreground text-sm mb-4 max-w-sm mx-auto">
                  {`No ${ticker} token sales have been recorded yet. Be the first to make a trade!`}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {vznSalesHistory.map((sale) => {
                  const amount = parseInt(sale.amt, 10);
                  const priceTotal = parseInt(sale.price, 10);
                  const pricePerToken = amount > 0 ? priceTotal / amount : 0;
                  const usdValue = bsvPrice
                    ? (priceTotal / 100000000) * bsvPrice
                    : 0;

                  return (
                    <Card
                      key={sale.outpoint}
                      className="p-3 rounded-2xl border border-emerald-500/30 bg-background/60 backdrop-blur hover:border-emerald-500/60 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <a
                          href={wocTxUrl(sale.txid)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="View on WhatsOnChain"
                        >
                          <Badge
                            variant="outline"
                            className="rounded-full font-mono text-[10px] uppercase tracking-[0.12em] cursor-pointer border-emerald-400/40 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-400/20 transition-colors"
                          >
                            Sold{" "}
                            <ExternalLink className="h-2.5 w-2.5 ml-1 inline" />
                          </Badge>
                        </a>
                      </div>
                      <div className="text-2xl font-bold text-foreground mb-2 font-mono tabular-nums">
                        {amount.toLocaleString()}{" "}
                        <span className="text-lg font-bold text-foreground">
                          {ticker}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1 mb-1">
                        <span className="text-emerald-600 dark:text-emerald-300 font-semibold font-mono tabular-nums">
                          {pricePerToken.toLocaleString()}
                        </span>
                        <span className="text-xs text-muted-foreground">{`sats/${ticker}`}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mb-3">
                        $
                        {bsvPrice
                          ? ((pricePerToken / 100000000) * bsvPrice).toFixed(6)
                          : "0.00"}
                      </div>
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="text-emerald-600 dark:text-emerald-300 font-medium font-mono tabular-nums">
                          {priceTotal.toLocaleString()} sats
                        </span>
                        <span className="text-muted-foreground">
                          ${usdValue.toFixed(2)}
                        </span>
                      </div>
                      {sale.spendHeight && (
                        <div className="text-xs text-muted-foreground pt-2 border-t border-border/60">
                          <span className="font-mono tabular-nums">
                            ⛏️ Block {sale.spendHeight.toLocaleString()}
                          </span>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* My Orders Tab - User's token listings */
          <div className="mt-4">
            {isFetchingTokenUtxos ? (
              <div className="py-12 flex flex-col items-center">
                <Loader2 className="h-8 w-8 animate-spin text-amber-500 dark:text-amber-400 mb-4" />
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Loading your orders…
                </p>
              </div>
            ) : userTokenListings.length === 0 ? (
              <div className="py-12 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl border border-border/60 bg-background/60 backdrop-blur flex items-center justify-center">
                  <Image
                    src="/vision.png"
                    alt="VZN"
                    width={40}
                    height={40}
                    className="rounded-full opacity-50"
                  />
                </div>
                <h3 className="font-vzn-headings text-xl font-normal tracking-tight text-foreground mb-2">
                  No Active Listings
                </h3>
                <p className="text-muted-foreground text-sm mb-4 max-w-sm mx-auto">
                  {`You don't have any active ${ticker} token listings. Click "List Tokens" to create one!`}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {userTokenListings.map((listing) => {
                  const amount = parseInt(listing.amt, 10);
                  const priceTotal = parseInt(listing.price, 10);
                  const pricePerToken = amount > 0 ? priceTotal / amount : 0;
                  const usdValue = bsvPrice
                    ? (priceTotal / 100000000) * bsvPrice
                    : 0;

                  return (
                    <Card
                      key={listing.outpoint}
                      className="p-3 rounded-2xl border border-amber-400/40 bg-gradient-to-b from-amber-400/[0.06] to-transparent backdrop-blur hover:border-amber-400/60 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <a
                          href={wocTxUrl(listing.txid)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="View on WhatsOnChain"
                        >
                          <Badge
                            variant="outline"
                            className="rounded-full font-mono text-[10px] uppercase tracking-[0.12em] cursor-pointer border-amber-400/40 bg-amber-400/10 text-amber-600 dark:text-amber-300 hover:bg-amber-400/20 transition-colors"
                          >
                            Your Listing{" "}
                            <ExternalLink className="h-2.5 w-2.5 ml-1 inline" />
                          </Badge>
                        </a>
                      </div>
                      <div className="text-2xl font-bold text-foreground mb-2 font-mono tabular-nums">
                        {amount.toLocaleString()}{" "}
                        <span className="text-lg font-bold text-foreground">
                          {ticker}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1 mb-1">
                        <span className="text-amber-600 dark:text-amber-300 font-semibold font-mono tabular-nums">
                          {pricePerToken.toLocaleString()}
                        </span>
                        <span className="text-xs text-muted-foreground">{`sats/${ticker}`}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mb-3">
                        $
                        {bsvPrice
                          ? ((pricePerToken / 100000000) * bsvPrice).toFixed(6)
                          : "0.00"}
                      </div>
                      <div className="flex items-center justify-between text-xs mb-3">
                        <span className="text-amber-600 dark:text-amber-300 font-medium font-mono tabular-nums">
                          {priceTotal.toLocaleString()} sats
                        </span>
                        <span className="text-muted-foreground">
                          ${usdValue.toFixed(2)}
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        className="w-full h-8 rounded-full text-sm font-medium border-red-500/60 bg-background/60 backdrop-blur text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                        disabled={cancellingOutpoint === listing.outpoint}
                        onClick={async (e) => {
                          e.stopPropagation();
                          setCancellingOutpoint(listing.outpoint);
                          const tokenId =
                            process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID;
                          if (!tokenId) {
                            toast({
                              variant: "destructive",
                              description: "Token ID not configured",
                              duration: 2000,
                            });
                            setCancellingOutpoint(null);
                            return;
                          }
                          const result = await cancelTokenListing(
                            {
                              txid: listing.txid,
                              vout: listing.vout,
                              script: listing.script,
                              amt: listing.amt,
                            },
                            tokenId,
                          );
                          setCancellingOutpoint(null);
                          if (result.success) {
                            // Refresh the listings after successful cancellation
                            fetchTokenData();
                          }
                        }}
                      >
                        {cancellingOutpoint === listing.outpoint ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-1" />{" "}
                            Cancelling...
                          </>
                        ) : (
                          "Cancel"
                        )}
                      </Button>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* List Tokens Modal */}
        <Dialog
          open={isListTokensModalOpen}
          onOpenChange={(open) => {
            setIsListTokensModalOpen(open);
            if (!open) {
              // Reset form when closing
              setListingPricePerToken("");
              setTokensToList("");
            }
          }}
        >
          <DialogContent className="max-w-md rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_20px_50px_-20px_rgba(0,0,0,0.55)]">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold tracking-tight">
                List
              </DialogTitle>
            </DialogHeader>

            {isFetchingTokenUtxos ? (
              <div className="py-8 flex flex-col items-center">
                <Loader2 className="h-8 w-8 animate-spin text-amber-500 dark:text-amber-400 mb-4" />
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Loading your tokens…
                </p>
              </div>
            ) : tokenUtxos.length === 0 ? (
              <div className="py-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl border border-border/60 bg-background/60 backdrop-blur flex items-center justify-center">
                  <Image
                    src="/vision.png"
                    alt="VZN"
                    width={40}
                    height={40}
                    className="rounded-full opacity-50"
                  />
                </div>
                <h3 className="font-vzn-headings text-xl font-normal tracking-tight mb-2">
                  No Tokens Available
                </h3>
                <p className="text-muted-foreground text-sm">
                  {`You don't have any unlisted ${ticker} tokens to list.`}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Available balance display */}
                <div className="rounded-xl border border-amber-400/30 bg-gradient-to-b from-amber-400/[0.08] to-amber-400/[0.02] backdrop-blur p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
                    Available balance
                  </div>
                  <div className="text-xl font-bold text-foreground font-mono tabular-nums">
                    {`${tokenUtxos.reduce((sum, utxo) => sum + parseInt(utxo.amt, 10), 0).toLocaleString()} ${ticker}`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {tokenUtxos.length} UTXO{tokenUtxos.length !== 1 ? "s" : ""}
                  </div>
                </div>

                {/* Amount to list */}
                <div className="space-y-2">
                  <Label htmlFor="tokensToList" className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Amount to list</Label>
                  <Input
                    id="tokensToList"
                    type="number"
                    placeholder="e.g. 100"
                    value={tokensToList}
                    onChange={(e) => setTokensToList(e.target.value)}
                    min="1"
                    max={tokenUtxos.reduce(
                      (sum, utxo) => sum + parseInt(utxo.amt, 10),
                      0,
                    )}
                    className="h-11 rounded-xl border-border/70 bg-background/70 backdrop-blur focus-visible:border-amber-400/60 focus-visible:ring-amber-400/30"
                  />
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{`${ticker} tokens`}</span>
                    <button
                      type="button"
                      className="text-amber-600 dark:text-amber-300 hover:underline transition-colors"
                      onClick={() =>
                        setTokensToList(
                          tokenUtxos
                            .reduce(
                              (sum, utxo) => sum + parseInt(utxo.amt, 10),
                              0,
                            )
                            .toString(),
                        )
                      }
                    >
                      Max
                    </button>
                  </div>
                </div>

                {/* Price per token */}
                <div className="space-y-2">
                  <Label htmlFor="pricePerToken" className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Price per token</Label>
                  <Input
                    id="pricePerToken"
                    type="number"
                    placeholder="e.g. 1000"
                    value={listingPricePerToken}
                    onChange={(e) => setListingPricePerToken(e.target.value)}
                    min="1"
                    className="h-11 rounded-xl border-border/70 bg-background/70 backdrop-blur focus-visible:border-amber-400/60 focus-visible:ring-amber-400/30"
                  />
                  <div className="text-xs text-muted-foreground">
                    {`satoshis per ${ticker}`}
                    {bsvPrice && listingPricePerToken && (
                      <span className="ml-2">
                        ($
                        {(
                          (Number(listingPricePerToken) / 100000000) *
                          bsvPrice
                        ).toFixed(6)}{" "}
                        USD)
                      </span>
                    )}
                  </div>
                </div>

                {/* Total calculation */}
                {tokensToList && listingPricePerToken && (
                  <div className="rounded-xl border border-border/60 bg-background/60 backdrop-blur p-3">
                    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
                      You will receive
                    </div>
                    <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
                      {(
                        Number(tokensToList) * Number(listingPricePerToken)
                      ).toLocaleString()}{" "}
                      sats
                    </div>
                    {bsvPrice && (
                      <div className="text-sm text-muted-foreground">
                        ≈ $
                        {(
                          ((Number(tokensToList) *
                            Number(listingPricePerToken)) /
                            100000000) *
                          bsvPrice
                        ).toFixed(2)}{" "}
                        USD
                      </div>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsListTokensModalOpen(false)}
                    className="flex-1 inline-flex items-center justify-center rounded-full border border-border/70 bg-background/60 px-6 py-3 text-sm font-medium text-foreground backdrop-blur transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-60"
                    disabled={isCreatingListing}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="group relative flex-1 inline-flex items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 px-6 py-3 text-sm font-semibold text-black shadow-[0_10px_30px_-10px_rgba(245,158,11,0.55)] transition-all hover:scale-[1.01] hover:shadow-[0_14px_40px_-10px_rgba(245,158,11,0.75)] disabled:pointer-events-none disabled:opacity-60"
                    disabled={
                      !tokensToList ||
                      !listingPricePerToken ||
                      Number(tokensToList) <= 0 ||
                      Number(listingPricePerToken) <= 0 ||
                      Number(tokensToList) >
                        tokenUtxos.reduce(
                          (sum, utxo) => sum + parseInt(utxo.amt, 10),
                          0,
                        ) ||
                      isCreatingListing
                    }
                    onClick={async () => {
                      console.log("=== Create Listing Button Clicked ===");
                      const tokenId = process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID;
                      console.log("Token ID from env:", tokenId);

                      if (!tokenId) {
                        console.error("Token ID not configured");
                        toast({
                          variant: "destructive",
                          description: "Token ID not configured",
                          duration: 2000,
                        });
                        return;
                      }

                      console.log("Calling createTokenListing with:", {
                        utxosCount: tokenUtxos.length,
                        pricePerToken: Number(listingPricePerToken),
                        tokensToList: Number(tokensToList),
                        tokenId,
                      });

                      const result = await createTokenListing(
                        tokenUtxos.map((utxo) => ({
                          txid: utxo.txid,
                          vout: utxo.vout,
                          amt: utxo.amt,
                          script: utxo.script,
                        })),
                        Number(listingPricePerToken),
                        Number(tokensToList),
                        tokenId,
                        0, // decimals - VZN has 0 decimals
                      );

                      console.log("createTokenListing result:", result);

                      if (result.success) {
                        console.log(
                          "Listing created successfully, closing modal",
                        );
                        setIsListTokensModalOpen(false);
                        setListingPricePerToken("");
                        setTokensToList("");
                        // Refresh balance
                        fetchTokenData();
                      } else {
                        console.log("Listing creation failed");
                      }
                    }}
                  >
                    <span className="absolute inset-0 bg-gradient-to-r from-amber-300 via-amber-200 to-amber-300 opacity-0 transition-opacity group-hover:opacity-100" />
                    <span className="relative flex items-center gap-2">
                      {isCreatingListing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Creating…
                        </>
                      ) : (
                        "Create Listing"
                      )}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Token Purchase Confirmation Dialog */}
        <Dialog
          open={isTokenPurchaseDialogOpen}
          onOpenChange={(open) => {
            if (!isPurchasingToken) {
              setIsTokenPurchaseDialogOpen(open);
              if (!open) setTokenPurchaseListing(null);
            }
          }}
        >
          <DialogContent className="max-w-md rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_20px_50px_-20px_rgba(0,0,0,0.55)]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Image
                  src="/vision.png"
                  alt="VZN"
                  width={24}
                  height={24}
                  className="rounded-full ring-1 ring-amber-400/30"
                />
                <span>
                  Confirm{" "}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24]">
                    purchase
                  </span>
                </span>
              </DialogTitle>
            </DialogHeader>

            {tokenPurchaseListing &&
              (() => {
                const listingAmount = parseInt(tokenPurchaseListing.amt, 10);
                const listingPriceTotal = parseInt(
                  tokenPurchaseListing.price,
                  10,
                );
                const listingPricePerToken =
                  listingAmount > 0 ? listingPriceTotal / listingAmount : 0;
                const listingTotalBsv = listingPriceTotal / 100000000;
                const listingUsdValue = bsvPrice
                  ? listingTotalBsv * bsvPrice
                  : 0;

                return (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-amber-400/30 bg-gradient-to-b from-amber-400/[0.08] to-amber-400/[0.02] backdrop-blur p-4">
                      <div className="text-center">
                        <div className="text-3xl font-bold text-foreground mb-1 font-mono tabular-nums">
                          {`${listingAmount.toLocaleString()} ${ticker}`}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          @ {listingPricePerToken.toLocaleString()} sats per
                          token
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground self-center">
                          Total cost
                        </span>
                        <span className="font-semibold text-amber-600 dark:text-amber-300 font-mono tabular-nums">
                          {listingPriceTotal.toLocaleString()} sats
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground self-center">BSV value</span>
                        <span className="font-medium font-mono tabular-nums">
                          {listingTotalBsv.toFixed(8)} BSV
                        </span>
                      </div>
                      {bsvPrice && (
                        <div className="flex justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground self-center">
                            USD value
                          </span>
                          <span className="font-medium font-mono tabular-nums">
                            ${listingUsdValue.toFixed(2)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between pt-2 border-t border-border/60">
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground self-center">Seller</span>
                        <span className="font-mono text-xs">
                          {tokenPurchaseListing.owner.substring(0, 8)}…
                          {tokenPurchaseListing.owner.slice(-6)}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsTokenPurchaseDialogOpen(false);
                          setTokenPurchaseListing(null);
                        }}
                        className="flex-1 inline-flex items-center justify-center rounded-full border border-border/70 bg-background/60 px-6 py-3 text-sm font-medium text-foreground backdrop-blur transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-60"
                        disabled={isPurchasingToken}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="group relative flex-1 inline-flex items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 px-6 py-3 text-sm font-semibold text-black shadow-[0_10px_30px_-10px_rgba(245,158,11,0.55)] transition-all hover:scale-[1.01] hover:shadow-[0_14px_40px_-10px_rgba(245,158,11,0.75)] disabled:pointer-events-none disabled:opacity-60"
                        disabled={isPurchasingToken}
                        onClick={async () => {
                          const tokenId =
                            process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID;
                          if (!tokenId) {
                            toast({
                              variant: "destructive",
                              description: "Token ID not configured",
                              duration: 2000,
                            });
                            return;
                          }

                          // Need to fetch the script if not available
                          let scriptToUse = tokenPurchaseListing.script;
                          if (!scriptToUse) {
                            // Fetch the script from the API
                            try {
                              const res = await fetch(
                                `https://ordinals.gorillapool.io/api/txos/${tokenPurchaseListing.outpoint}?script=true`,
                              );
                              if (res.ok) {
                                const data = await res.json();
                                scriptToUse = data.script;
                              }
                            } catch (err) {
                              console.error("Failed to fetch script:", err);
                            }
                          }

                          if (!scriptToUse) {
                            toast({
                              variant: "destructive",
                              description: "Could not fetch listing script",
                              duration: 2000,
                            });
                            return;
                          }

                          const result = await purchaseTokenListing(
                            {
                              txid: tokenPurchaseListing.txid,
                              vout: tokenPurchaseListing.vout,
                              amt: tokenPurchaseListing.amt,
                              script: scriptToUse,
                              price: tokenPurchaseListing.price,
                              payout: tokenPurchaseListing.payout,
                            },
                            tokenId,
                          );

                          if (result.success) {
                            setIsTokenPurchaseDialogOpen(false);
                            setTokenPurchaseListing(null);
                            // Refresh listings
                            fetchMarketplaceListings();
                            fetchTokenData();
                          }
                        }}
                      >
                        <span className="absolute inset-0 bg-gradient-to-r from-amber-300 via-amber-200 to-amber-300 opacity-0 transition-opacity group-hover:opacity-100" />
                        <span className="relative flex items-center gap-2">
                          {isPurchasingToken ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Purchasing…
                            </>
                          ) : (
                            "Confirm Purchase"
                          )}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })()}
          </DialogContent>
        </Dialog>
      </div>

      {/* VZN Info Dialog */}
      <VZNInfoDialog isOpen={isVZNInfoOpen} onOpenChange={setIsVZNInfoOpen} />
    </>
  );
}
