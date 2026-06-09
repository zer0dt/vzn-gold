import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Like } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`; // Use 'd' for days
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`; // Use 'mo' for months
  const years = Math.floor(days / 365);
  return `${years}y`; // Use 'y' for years
}

export const formatPublicKey = (publicKey: string) => {
  return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
};

export type FormatShortTxidOptions = {
  headChars?: number;
  tailChars?: number;
  /** When set, return the full string if length is at most this (no ellipsis). */
  fullWhenLengthAtMost?: number;
};

/** Middle-ellipsis txid for UI (hex ids). Empty input yields empty string. */
export function formatShortTxid(
  txid: string | null | undefined,
  options: FormatShortTxidOptions = {},
): string {
  if (!txid) return "";
  const head = options.headChars ?? 6;
  const tail = options.tailChars ?? 6;
  const fullWhen = options.fullWhenLengthAtMost;
  if (fullWhen !== undefined && txid.length <= fullWhen) {
    return txid;
  }
  const ellipsis = "...";
  if (txid.length <= head + tail + ellipsis.length) {
    return txid;
  }
  return `${txid.slice(0, head)}${ellipsis}${txid.slice(-tail)}`;
}

export const formatNumberWithCommas = (num: number | string): string => {
  if (num === null || num === undefined) return "0";
  const numStr = String(num);
  const parts = numStr.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
};

export function formatSatsAbbreviated(amount: number): string {
  if (amount === null || amount === undefined) return "0";
  if (amount < 1000) return amount.toString();

  const suffixes = ["", "K", "M", "B", "T"]; // Kilo, Mega, Giga (Billion), Tera
  const i = Math.floor(Math.log10(amount) / 3);

  // Handle cases where i might exceed suffixes length (very large numbers)
  if (i >= suffixes.length) {
    return (
      (amount / 1000 ** (suffixes.length - 1)).toFixed(1) +
      suffixes[suffixes.length - 1]
    );
  }

  const num = amount / 1000 ** i;

  // Show one decimal place if not an integer, otherwise show integer
  const formattedNum = num % 1 === 0 ? num.toFixed(0) : num.toFixed(1);

  return formattedNum + suffixes[i];
}

export const formatUSD = (sats: number, bsvPrice: number | null): string => {
  if (bsvPrice === null || bsvPrice === 0 || sats === null) return "$...";
  const bsvAmount = sats / 100000000;
  const usdValue = bsvAmount * bsvPrice;

  if (usdValue < 0.01 && usdValue > 0) return "<$0.01";
  if (usdValue >= 1000) return `$${(usdValue / 1000).toFixed(1)}k`;
  if (usdValue >= 1000000) return `$${(usdValue / 1000000).toFixed(1)}M`;

  return `$${usdValue.toFixed(2)}`;
};

export const formatBlocksToTime = (blocks: number): string => {
  if (!blocks || blocks <= 0) return "0m";

  const minutes = blocks * 10; // Assuming 10 minutes per block

  if (minutes < 60) {
    return `≈${minutes}m`;
  }

  const hours = minutes / 60;
  if (hours < 24) {
    return `≈${hours.toFixed(1)}h`.replace(".0", "");
  }

  const days = hours / 24;
  if (days < 30) {
    return `≈${days.toFixed(1)}d`.replace(".0", "");
  }

  const months = days / 30;
  if (months < 12) {
    return `≈${months.toFixed(1)}mo`.replace(".0", "");
  }

  const years = days / 365;
  return `≈${years.toFixed(1)}y`.replace(".0", "");
};

export const getTotalLockedSats = (
  likes: Like[] | undefined | null,
): number => {
  if (!likes || !Array.isArray(likes)) return 0;
  return likes.reduce((sum, like) => sum + (like.sats_amount || 0), 0);
};

export const getBlocksUntilUnlock = (
  unlockHeight: number,
  currentBlockHeight: number,
): string => {
  const blocksRemaining = unlockHeight - currentBlockHeight;
  if (blocksRemaining <= 0) return "Unlocked";

  return `${formatNumberWithCommas(blocksRemaining)} blocks left`;
};
