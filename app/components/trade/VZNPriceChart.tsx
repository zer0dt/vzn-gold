"use client";

import { Box, ExternalLink, Loader2 } from "lucide-react";
import React, { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { wocTxUrl } from "@/app/lib/explorer";

interface SaleRecord {
  txid: string;
  outpoint: string;
  amt: string;
  price: string;
  pricePer: string;
  height: number | null;
  spendHeight: number | null;
  owner: string;
}

interface ChartSaleData {
  txid: string;
  amt: string;
  price: string;
  pricePerToken: number;
  spendHeight: number | null;
}

interface VZNPriceChartProps {
  salesHistory: SaleRecord[];
  currentBlockHeight: number | null;
  isFetchingSales: boolean;
  bsvPrice: number | null;
  calculateUSDValue: (sats: number) => number;
}

export default function VZNPriceChart({
  salesHistory,
  currentBlockHeight,
  isFetchingSales,
  bsvPrice,
  calculateUSDValue,
}: VZNPriceChartProps) {
  const [chartRange, setChartRange] = useState<"10" | "100" | "1K" | "10K">(
    "10K",
  );
  const [chartData, setChartData] = useState<number[]>([]);
  const [chartSalesData, setChartSalesData] = useState<ChartSaleData[]>([]);
  const [hoveredSaleIndex, setHoveredSaleIndex] = useState<number | null>(null);
  const [pinnedSaleIndex, setPinnedSaleIndex] = useState<number | null>(null);
  const lastPriceSats = chartData.length
    ? chartData[chartData.length - 1]
    : 100;

  // Generate chart data from real sales history filtered by block range
  useEffect(() => {
    if (salesHistory.length === 0) {
      setChartData([]);
      setChartSalesData([]);
      return;
    }

    const blockRangeMap: Record<typeof chartRange, number> = {
      "10": 10,
      "100": 100,
      "1K": 1000,
      "10K": 10000,
    };
    const blocksToShow = blockRangeMap[chartRange];
    const minBlockHeight = currentBlockHeight
      ? currentBlockHeight - blocksToShow
      : 0;

    const salesWithPrices = salesHistory
      .filter((sale) => sale.price && sale.amt)
      .filter((sale) => {
        if (currentBlockHeight && sale.spendHeight) {
          return sale.spendHeight >= minBlockHeight;
        }
        return true;
      })
      .map((sale) => {
        const totalPrice = parseInt(sale.price, 10);
        const amount = parseInt(sale.amt, 10);
        const pricePerToken = amount > 0 ? Math.round(totalPrice / amount) : 0;
        return {
          txid: sale.txid,
          amt: sale.amt,
          price: sale.price,
          pricePerToken,
          spendHeight: sale.spendHeight,
        };
      })
      .filter((sale) => sale.pricePerToken > 0)
      .slice(0, 50);

    if (salesWithPrices.length === 0) {
      setChartData([]);
      setChartSalesData([]);
      return;
    }

    const reversed = salesWithPrices.reverse();
    setChartData(reversed.map((s) => s.pricePerToken));
    setChartSalesData(reversed);
  }, [chartRange, salesHistory, currentBlockHeight]);

  return (
    <div className="grid grid-cols-1 gap-3">
      <Card className="p-3 rounded-2xl border-border/60 bg-background/60 backdrop-blur shadow-none">
        {/* Price and range controls - stacked on mobile, side by side on desktop */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              VZN Price
            </div>
            <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums">
              {chartData.length > 0 ? lastPriceSats.toLocaleString() : "--"}{" "}
              sats
              {bsvPrice && chartData.length > 0 ? (
                <span className="ml-1 sm:ml-2 text-xs sm:text-sm text-muted-foreground">
                  (${calculateUSDValue(lastPriceSats).toFixed(4)})
                </span>
              ) : null}
            </div>
            {(() => {
              if (chartData.length < 2) {
                let message = "No sales data";
                if (isFetchingSales) {
                  message = "Loading…";
                } else if (salesHistory.length > 0 && chartData.length === 0) {
                  message = "No sales in this range";
                } else if (chartData.length === 1) {
                  message = "1 sale (need 2+ for chart)";
                }
                return (
                  <div className="text-xs sm:text-sm font-medium text-muted-foreground">
                    {message}
                  </div>
                );
              }
              const firstPrice = chartData[0];
              const currentPrice = chartData[chartData.length - 1];
              const changePercent =
                ((currentPrice - firstPrice) / firstPrice) * 100;
              const isPositive = changePercent >= 0;
              return (
                <div
                  className={`text-xs sm:text-sm font-medium ${isPositive ? "text-emerald-500" : "text-red-500"}`}
                >
                  {isPositive ? "▲" : "▼"} {isPositive ? "+" : ""}
                  {changePercent.toFixed(1)}% ({chartData.length} sales)
                </div>
              );
            })()}
          </div>
          {/* Block range buttons - horizontal scroll on mobile */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
            {(["10", "100", "1K", "10K"] as const).map((r) => (
              <Button
                key={r}
                size="sm"
                variant="outline"
                className={`h-7 sm:h-8 px-2 sm:px-3 rounded-full text-xs sm:text-sm font-medium flex-shrink-0 backdrop-blur transition-colors ${
                  chartRange === r
                    ? "border-amber-400/60 bg-amber-400/10 text-amber-600 dark:text-amber-300"
                    : "border-border/70 bg-background/60 text-muted-foreground hover:border-amber-400/40 hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300"
                }`}
                onClick={() => setChartRange(r)}
              >
                <Box className="h-3 w-3 mr-1 hidden sm:inline" />
                <Box className="h-2.5 w-2.5 mr-0.5 sm:hidden" />
                {r}
              </Button>
            ))}
          </div>
        </div>
        {/* Simple SVG line/area chart with interactive dots */}
        <div className="w-full h-48 relative">
          {isFetchingSales && chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="flex flex-col items-center">
                <Loader2 className="h-6 w-6 animate-spin text-amber-500 dark:text-amber-400 mb-2" />
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Loading chart data…
                </div>
              </div>
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-muted-foreground text-sm">
                  No sales data yet
                </div>
                <div className="text-muted-foreground text-xs mt-1">
                  Price chart will appear after trades occur
                </div>
              </div>
            </div>
          ) : (
            <>
              <svg
                viewBox="0 0 1000 300"
                className="w-full h-full"
                onMouseLeave={() => {
                  if (pinnedSaleIndex === null) setHoveredSaleIndex(null);
                }}
                onClick={() => {
                  if (pinnedSaleIndex !== null) {
                    setPinnedSaleIndex(null);
                    setHoveredSaleIndex(null);
                  }
                }}
              >
                {(() => {
                  const min = Math.min(...chartData);
                  const max = Math.max(...chartData);
                  const range = Math.max(1, max - min);
                  const stepX = 1000 / (chartData.length - 1 || 1);
                  const pointsData = chartData.map((v, i) => {
                    const x = i * stepX;
                    const y = 300 - ((v - min) / range) * 280 - 10;
                    return { x, y, value: v };
                  });
                  const pointsStr = pointsData
                    .map((p) => `${p.x},${p.y}`)
                    .join(" ");
                  const areaPath = `M0,300 L${pointsStr} L1000,300 Z`;
                  const activeIndex = pinnedSaleIndex ?? hoveredSaleIndex;
                  return (
                    <>
                      <defs>
                        <linearGradient
                          id="vznArea"
                          x1="0"
                          x2="0"
                          y1="0"
                          y2="1"
                        >
                          <stop offset="0%" stopColor="rgba(245,158,11,0.28)" />
                          <stop
                            offset="100%"
                            stopColor="rgba(245,158,11,0.02)"
                          />
                        </linearGradient>
                        <linearGradient
                          id="vznLine"
                          x1="0"
                          x2="1"
                          y1="0"
                          y2="0"
                        >
                          <stop offset="0%" stopColor="#FBBF24" />
                          <stop offset="50%" stopColor="#F59E0B" />
                          <stop offset="100%" stopColor="#FBBF24" />
                        </linearGradient>
                      </defs>
                      <path d={areaPath} fill="url(#vznArea)" />
                      <polyline
                        fill="none"
                        stroke="url(#vznLine)"
                        strokeWidth="3"
                        points={pointsStr}
                      />
                      {pointsData.map((point, i) => (
                        <circle
                          key={i}
                          cx={point.x}
                          cy={point.y}
                          r={activeIndex === i ? 12 : 8}
                          fill={activeIndex === i ? "#F59E0B" : "#FBBF24"}
                          stroke="white"
                          strokeWidth="2"
                          className="cursor-pointer transition-all"
                          onMouseEnter={() => {
                            if (pinnedSaleIndex === null)
                              setHoveredSaleIndex(i);
                          }}
                          onClick={() => {
                            if (pinnedSaleIndex === i) {
                              setPinnedSaleIndex(null);
                              setHoveredSaleIndex(null);
                            } else {
                              setPinnedSaleIndex(i);
                              setHoveredSaleIndex(i);
                            }
                          }}
                          style={{
                            filter:
                              activeIndex === i
                                ? "drop-shadow(0 0 8px rgba(245, 158, 11, 0.7))"
                                : "none",
                          }}
                        />
                      ))}
                    </>
                  );
                })()}
              </svg>
              {/* Tooltip for hovered/pinned sale */}
              {(() => {
                const activeIndex = pinnedSaleIndex ?? hoveredSaleIndex;
                if (activeIndex === null || !chartSalesData[activeIndex])
                  return null;
                const sale = chartSalesData[activeIndex];
                return (
                  <div
                    className={`absolute bg-background/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-[0_0_0_1px_rgba(245,158,11,0.15),0_12px_30px_-10px_rgba(0,0,0,0.45)] p-3 z-10 ${pinnedSaleIndex !== null ? "pointer-events-auto" : "pointer-events-none"}`}
                    style={{
                      left: `${Math.min(85, Math.max(15, (activeIndex / (chartData.length - 1 || 1)) * 100))}%`,
                      top: "10px",
                      transform: "translateX(-50%)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-4 mb-2">
                      <div className="font-semibold text-amber-600 dark:text-amber-300 text-sm font-mono tabular-nums">
                        {parseInt(sale.amt).toLocaleString()} VZN
                      </div>
                      <a
                        href={wocTxUrl(sale.txid)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-amber-600 dark:hover:text-amber-300 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                        title="View on WhatsOnChain"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                    <div className="text-xs space-y-1">
                      <div className="flex justify-between gap-3">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground self-center">Price</span>
                        <span className="font-medium font-mono tabular-nums">
                          {sale.pricePerToken >= 1000000
                            ? `${(sale.pricePerToken / 1000000).toFixed(1)}M`
                            : sale.pricePerToken >= 1000
                              ? `${(sale.pricePerToken / 1000).toFixed(0)}K`
                              : sale.pricePerToken.toLocaleString()}{" "}
                          sats
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground self-center">Total</span>
                        <span className="font-medium font-mono tabular-nums">
                          {parseInt(sale.price) >= 1000000
                            ? `${(parseInt(sale.price) / 1000000).toFixed(1)}M`
                            : parseInt(sale.price) >= 1000
                              ? `${(parseInt(sale.price) / 1000).toFixed(0)}K`
                              : parseInt(sale.price).toLocaleString()}{" "}
                          sats
                        </span>
                      </div>
                      {sale.spendHeight && (
                        <div className="flex justify-between gap-3">
                          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground self-center">Block</span>
                          <span className="font-mono tabular-nums">
                            {sale.spendHeight.toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
