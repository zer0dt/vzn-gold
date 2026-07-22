"use client";

import type { QueryClient } from "@tanstack/react-query";
import { ArrowUpDown, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import { useLikes } from "@/app/hooks/use-likes";
import { wocTxUrl } from "@/app/lib/explorer";
import type {
  BatchUnlockCandidate,
  BatchUnlockProgressEvent,
} from "@/app/lib/unlockCoins";
import {
  LOCK_LIKE_MINT_LOCK_VOUT,
  unlockCoinsBatch,
} from "@/app/lib/unlockCoins";
import { cn, formatSatsAbbreviated, formatShortTxid } from "@/app/lib/utils";
import type { Like } from "@/types";
import VaultLoadingState from "./VaultLoadingState";

type ToastFn = (typeof import("@/app/hooks/use-toast"))["toast"];

type SortConfig = {
  key: "unlock_height" | "sats_amount" | "created_at" | null;
  direction: "asc" | "desc";
};

interface VaultContentProps {
  userId: string;
  blockHeight: number;
  bsvPrice: number;
  toast: ToastFn;
  queryClient: QueryClient;
}

// Helper functions
const formatSatsToUSD = (sats: number, bsvPrice: number) => {
  if (!bsvPrice) return "Loading...";
  const bsv = sats / 100_000_000;
  const usd = bsv * bsvPrice;
  return usd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

type VaultUnlockPhase =
  | "idle"
  | "building_tx"
  | "cleaning_db"
  | "broadcasting"
  | "updating_db";

const VAULT_SHORT_TXID = {
  headChars: 12,
  tailChars: 6,
  fullWhenLengthAtMost: 18,
} as const;

/** Shorter txids in the vault table so columns fit without horizontal scroll. */
const VAULT_TABLE_SHORT_TXID = {
  headChars: 8,
  tailChars: 4,
  fullWhenLengthAtMost: 14,
} as const;

function vaultUnlockPhaseCopy(
  phase: VaultUnlockPhase,
  dbRecordIndex: number,
  dbRecordTotal: number,
): { headline: string; detail: string } {
  switch (phase) {
    case "building_tx":
      return {
        headline: "Checking chain and building unlock",
        detail:
          "Verifies lock vout on-chain, signs spends, merges into one transaction.",
      };
    case "broadcasting":
      return {
        headline: "Broadcasting",
        detail: "BEEF build on the server, then ARC relay.",
      };
    case "cleaning_db":
      return {
        headline: "Syncing Supabase",
        detail:
          "Mark rows already spent on-chain or remove stale rows.",
      };
    case "updating_db":
      return {
        headline:
          dbRecordTotal <= 1
            ? "Updating vault"
            : `Updating vault (${dbRecordIndex} of ${dbRecordTotal})`,
        detail: "Recording the unlock spend on your likes.",
      };
    default:
      return { headline: "Working…", detail: "" };
  }
}

export default function VaultContent({
  userId,
  blockHeight,
  bsvPrice,
  toast,
  queryClient,
}: VaultContentProps) {
  const formatSatsExact = (sats: number) =>
    `${sats.toLocaleString("en-US")} sats`;
  const formatBytes = (bytes: number) =>
    `${bytes.toLocaleString("en-US")} bytes`;
  // State
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: null,
    direction: "asc",
  });
  const [activeView, setActiveView] = useState<"locked" | "unlockable">(
    "locked",
  );
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockableLimit, setUnlockableLimit] = useState(10);
  const [unlockStatus, setUnlockStatus] = useState<{
    isProcessing: boolean;
    phase: VaultUnlockPhase;
    stepProgressPct: number;
    dbRecordIndex: number;
    dbRecordTotal: number;
  }>({
    isProcessing: false,
    phase: "idle",
    stepProgressPct: 0,
    dbRecordIndex: 0,
    dbRecordTotal: 0,
  });
  const [unlockComplete, setUnlockComplete] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockLogs, setUnlockLogs] = useState<string[]>([]);
  const [unlockSummary, setUnlockSummary] = useState<{
    updated: number;
    total: number;
  } | null>(null);
  const [unlockBroadcastTxid, setUnlockBroadcastTxid] = useState<string | null>(
    null,
  );

  const resetUnlockWizard = () => {
    setUnlockError(null);
    setUnlockLogs([]);
    setUnlockSummary(null);
    setUnlockComplete(false);
    setUnlockBroadcastTxid(null);
    setUnlockStatus({
      isProcessing: false,
      phase: "idle",
      stepProgressPct: 0,
      dbRecordIndex: 0,
      dbRecordTotal: 0,
    });
  };

  // Fetch likes data from Supabase using the hook
  const {
    data: activeLikesData,
    isLoading: isLoadingActive,
    error: activeError,
    refetch: refetchActive,
  } = useLikes({
    userId,
    tab: "active",
    blockHeight,
    enabled: !!userId && blockHeight > 0,
  });

  const {
    data: unlockableLikesData,
    isLoading: isLoadingUnlockable,
    error: unlockableError,
    refetch: refetchUnlockable,
  } = useLikes({
    userId,
    tab: "unlockable",
    blockHeight,
    enabled: !!userId && blockHeight > 0,
  });

  // Process the likes data
  const stillLockedLikes = useMemo(
    () => activeLikesData?.likes || [],
    [activeLikesData?.likes],
  );
  const unlockableLikes = useMemo(
    () => unlockableLikesData?.likes || [],
    [unlockableLikesData?.likes],
  );

  // Prefer API totals so summary cards remain correct if rows are paginated.
  const totalLockedCount =
    activeLikesData?.totalCount ?? stillLockedLikes.length;
  const totalLockedSats =
    activeLikesData?.totalSatsLocked ??
    stillLockedLikes.reduce((sum, like) => sum + like.sats_amount, 0);
  const unlockableCount =
    unlockableLikesData?.totalCount ?? unlockableLikes.length;
  const unlockableSats =
    unlockableLikesData?.totalSatsLocked ??
    unlockableLikes.reduce((sum, like) => sum + like.sats_amount, 0);

  const getBlocksUntilUnlock = (unlockHeight: number) => {
    return Math.max(0, unlockHeight - (blockHeight || 0));
  };

  const handleSort = (key: "unlock_height" | "sats_amount" | "created_at") => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const getSortedLikes = (
    likes: Like[],
    defaultSort?: {
      key: "unlock_height" | "sats_amount" | "created_at";
      direction: "asc" | "desc";
    },
  ) => {
    const config = sortConfig.key ? sortConfig : defaultSort;
    if (!config) return likes;

    return [...likes].sort((a, b) => {
      let aVal: number;
      let bVal: number;

      switch (config.key) {
        case "unlock_height":
          aVal = a.unlock_height;
          bVal = b.unlock_height;
          break;
        case "sats_amount":
          aVal = a.sats_amount;
          bVal = b.sats_amount;
          break;
        case "created_at":
          aVal = new Date(a.created_at).getTime();
          bVal = new Date(b.created_at).getTime();
          break;
        default:
          return 0;
      }

      if (config.direction === "asc") {
        return aVal - bVal;
      } else {
        return bVal - aVal;
      }
    });
  };

  const runAutomaticVaultUnlock = async () => {
    if (isUnlocking) return;

    const addLog = (msg: string) => {
      setUnlockLogs((prev) => [...prev, msg]);
    };

    const pkWIF = window.sessionStorage.getItem("walletKey");
    const receiveAddress = window.sessionStorage.getItem("walletAddress");
    if (!pkWIF || !receiveAddress) {
      setUnlockError(
        "Wallet information not found. Please ensure your wallet is connected.",
      );
      return;
    }

    const likesSnapshot = unlockableLikes;
    const n = likesSnapshot.length;
    if (n === 0) {
      setUnlockError("Nothing in Ready to Unlock.");
      return;
    }

    setUnlockError(null);
    setUnlockBroadcastTxid(null);
    setIsUnlocking(true);
    setUnlockStatus({
      isProcessing: true,
      phase: "building_tx",
      stepProgressPct: 0,
      dbRecordIndex: 0,
      dbRecordTotal: n,
    });

    let reconcileSpent = 0;

    try {
      console.log(`[VAULT] Automatic unlock for ${n} likes`);
      // contract_output_vout identifies the continuing minter output, not the
      // parallel contract's gated lock. Vault unlocks always spend vout 2.
      const unlockCandidates: BatchUnlockCandidate[] = likesSnapshot.map(
        (like) => ({
          txid: like.txid,
        }),
      );
      addLog(
        `Starting: ${n} row(s), parallel lock vout ${LOCK_LIKE_MINT_LOCK_VOUT} (spent checked on-chain, then Supabase).`,
      );
      addLog(`Receive address ${receiveAddress}`);
      const allTxids = unlockCandidates.map((candidate) => candidate.txid);
      addLog(
        `Fetching ${allTxids.length} source transaction${allTxids.length === 1 ? "" : "s"}…`,
      );

      const handleBuildProgress = (event: BatchUnlockProgressEvent) => {
        if (event.phase === "fetch_complete") {
          setUnlockStatus((prev) => ({
            ...prev,
            stepProgressPct: Math.max(
              prev.stepProgressPct,
              Math.round(
                (event.fetchedTxids / Math.max(event.totalTxids, 1)) * 35,
              ),
            ),
          }));
          addLog(
            `Fetched WOC chunk ${event.chunkIndex}/${event.chunkCount} (${event.fetchedTxids}/${event.totalTxids} txids).`,
          );
          return;
        }

        if (event.phase === "spent_check_complete") {
          setUnlockStatus((prev) => ({
            ...prev,
            stepProgressPct: Math.max(
              prev.stepProgressPct,
              35 +
                Math.round(
                  (event.checkedOutpoints /
                    Math.max(event.totalOutpoints, 1)) *
                    20,
                ),
            ),
          }));
          addLog(
            `Checked vout ${event.vout ?? LOCK_LIKE_MINT_LOCK_VOUT} spend status ${event.chunkIndex}/${event.chunkCount} (${event.checkedOutpoints}/${event.totalOutpoints}).`,
          );
          return;
        }

        if (event.phase === "inputs_ready") {
          setUnlockStatus((prev) => ({
            ...prev,
            stepProgressPct: Math.max(prev.stepProgressPct, 58),
          }));
          addLog(
            `Prepared ${event.validInputs} input${event.validInputs === 1 ? "" : "s"}; skipped ${event.skippedCount}.`,
          );
          return;
        }

        if (event.phase === "signing_progress") {
          setUnlockStatus((prev) => ({
            ...prev,
            stepProgressPct: Math.max(
              prev.stepProgressPct,
              58 +
                Math.round(
                  (event.signedInputs / Math.max(event.inputCount, 1)) * 12,
                ),
            ),
          }));
          addLog(
            `Signed ${event.signedInputs}/${event.inputCount} input${event.inputCount === 1 ? "" : "s"}.`,
          );
        }
      };

      const { rawtx, details } = await unlockCoinsBatch(
        pkWIF,
        receiveAddress,
        unlockCandidates,
        handleBuildProgress,
      );

      addLog(
        `Tx details: ${details.fetchedTxDetails}/${details.requestedTxids}; ${details.inputCount} spendable input${details.inputCount === 1 ? "" : "s"}.`,
      );
      if (details.unconfirmedTxids.length > 0) {
        addLog(
          `Skipped ${details.unconfirmedTxids.length} unconfirmed: ${details.unconfirmedTxids.map((txid: string) => formatShortTxid(txid, VAULT_SHORT_TXID)).join(", ")}`,
        );
      }
      if (details.missingTxids.length > 0) {
        addLog(
          `Skipped ${details.missingTxids.length} not found: ${details.missingTxids.map((txid: string) => formatShortTxid(txid, VAULT_SHORT_TXID)).join(", ")}`,
        );
      }
      if (details.spentTxids.length > 0) {
        addLog(
          `Already spent on-chain: ${details.spentTxids.map((txid: string) => formatShortTxid(txid, VAULT_SHORT_TXID)).join(", ")}`,
        );
      }
      if (details.unknownOutpointTxids.length > 0) {
        addLog(
          `Unknown outpoint: ${details.unknownOutpointTxids.map((txid: string) => formatShortTxid(txid, VAULT_SHORT_TXID)).join(", ")}`,
        );
      }
      if (details.skippedTxids.length > 0) {
        const remainingSkippedTxids = details.skippedTxids.filter((txid) => {
          return (
            !details.missingTxids.includes(txid) &&
            !details.unconfirmedTxids.includes(txid) &&
            !details.spentTxids.includes(txid) &&
            !details.unknownOutpointTxids.includes(txid)
          );
        });
        if (remainingSkippedTxids.length > 0) {
          addLog(
            `Invalid unlock scripts: ${remainingSkippedTxids.map((txid: string) => formatShortTxid(txid, VAULT_SHORT_TXID)).join(", ")}`,
          );
        }
      }

      if (rawtx && details.inputCount > 0) {
        addLog(
          `Built ${formatShortTxid(details.txid, VAULT_SHORT_TXID)} (${details.inputCount} in, fee ${formatSatsExact(details.feeSatoshis)}).`,
        );
      }

      const spentForDb = details.spentRows
        .map((row) => ({
          txid: row.txid.trim(),
          spent_txid: row.spentTxid.trim(),
        }))
        .filter(
          (row) =>
            row.txid.length === 64 &&
            row.spent_txid.length === 64 &&
            row.txid.toLowerCase() !== row.spent_txid.toLowerCase(),
        );

      if (spentForDb.length > 0) {
        setUnlockStatus((prev) => ({
          ...prev,
          phase: "cleaning_db",
          stepProgressPct: Math.max(prev.stepProgressPct, 72),
        }));
        addLog(
          `Updating Supabase for ${spentForDb.length} like(s) already spent on-chain…`,
        );
        addLog(
          `Mark spent: ${spentForDb.map((row) => formatShortTxid(row.txid, VAULT_SHORT_TXID)).join(", ")}`,
        );
        const cleanupRes = await fetch("/api/likes/reconcile-unlockable", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spent: spentForDb }),
        });
        if (!cleanupRes.ok) {
          const errorData = await cleanupRes.json().catch(() => ({}));
          throw new Error(
            typeof errorData.error === "string"
              ? errorData.error
              : `Vault reconciliation failed (${cleanupRes.status})`,
          );
        }
        const cleanupData = (await cleanupRes.json()) as {
          updatedSpentCount?: number;
        };
        reconcileSpent =
          typeof cleanupData.updatedSpentCount === "number"
            ? cleanupData.updatedSpentCount
            : 0;
        addLog(`Supabase: marked ${reconcileSpent} row(s) spent with on-chain spending txid.`);
        await refetchActive();
        await refetchUnlockable();
        queryClient.invalidateQueries({ queryKey: ["likes"] });
      } else if (details.spentRows.length > 0) {
        addLog(
          "Skipping Supabase updates: no valid spent_txid distinct from like txid after chain verification.",
        );
      } else {
        addLog("No prior on-chain spends among selected rows to reconcile.");
      }

      if (!rawtx || details.inputCount === 0) {
        const didReconcile = spentForDb.length > 0;
        if (didReconcile) {
          setUnlockSummary({
            updated: reconcileSpent,
            total: spentForDb.length,
          });
          setUnlockComplete(true);
          await refetchActive();
          await refetchUnlockable();
          queryClient.invalidateQueries({ queryKey: ["likes"] });
          toast({
            title: "Vault updated",
            description:
              "Lock outputs were already spent on-chain; database rows updated.",
          });
        } else {
          throw new Error("No valid unlockable inputs found");
        }
        return;
      }

      setUnlockStatus((prev) => ({
        ...prev,
        phase: "broadcasting",
        stepProgressPct: 78,
      }));
      addLog(
        `Broadcasting ${formatShortTxid(details.txid, VAULT_SHORT_TXID)} (${formatBytes(details.byteLength)})…`,
      );
      const knownTxids = details.includedTxids?.length
        ? details.includedTxids
        : [];
      const includedTxidSet = new Set(details.includedTxids ?? []);
      const syncedLikes = likesSnapshot.filter((like) =>
        includedTxidSet.has(like.txid.trim().toLowerCase()),
      );
      const overlayBsv21Parents = syncedLikes
        .map((like) => ({
          originId: like.contract_id.trim(),
          txid: like.txid.trim(),
        }))
        .filter((parent) => parent.originId.length > 0 && parent.txid.length === 64);
      if (overlayBsv21Parents.length > 0) {
        addLog(
          `Requesting ${overlayBsv21Parents.length} overlay parent BEEF${overlayBsv21Parents.length === 1 ? "" : "s"} before WOC fallback…`,
        );
      }
      const beefRes = await fetch("/api/beef-cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawtx,
          knownTxids,
          overlayBsv21Parents,
          broadcastArc: true,
        }),
      });
      if (!beefRes.ok) {
        const errBody = await beefRes.json().catch(() => ({}));
        throw new Error(
          typeof errBody.error === "string"
            ? errBody.error
            : `BEEF build or ARC broadcast failed (${beefRes.status})`,
        );
      }
      setUnlockStatus((prev) => ({ ...prev, stepProgressPct: 88 }));
      const broadcastJson = (await beefRes.json()) as {
        txid?: string;
        status?: "accepted" | "already-known";
      };
      const unlockTxid = broadcastJson.txid?.trim();
      if (!unlockTxid) {
        throw new Error("No TXID returned from ARC broadcast");
      }
      if (details.txid && details.txid !== unlockTxid) {
        addLog(
          `ARC txid ${formatShortTxid(unlockTxid, VAULT_SHORT_TXID)} (local ${formatShortTxid(details.txid, VAULT_SHORT_TXID)}).`,
        );
      } else {
        addLog(`Broadcast ok — ${formatShortTxid(unlockTxid, VAULT_SHORT_TXID)}`);
      }
      setUnlockBroadcastTxid(unlockTxid);

      const syncTotal = syncedLikes.length;
      if (syncTotal === 0) {
        throw new Error("No inputs were included in the unlock transaction.");
      }

      setUnlockStatus((prev) => ({
        ...prev,
        phase: "updating_db",
        stepProgressPct: 92,
        dbRecordTotal: syncTotal,
      }));
      addLog(`Updating ${syncTotal} vault row(s) with spend txid…`);

      const successfulUnlocks: string[] = [];
      let likeIndex = 0;
      for (const like of syncedLikes) {
        likeIndex += 1;
        setUnlockStatus((prev) => ({
          ...prev,
          dbRecordIndex: likeIndex,
          stepProgressPct:
            92 + Math.round((likeIndex / Math.max(syncTotal, 1)) * 8),
        }));
        try {
          if (
            like.txid.trim().toLowerCase() === unlockTxid.trim().toLowerCase()
          ) {
            addLog(
              `Skipped ${formatShortTxid(like.txid, VAULT_SHORT_TXID)} — broadcast txid cannot equal like txid.`,
            );
            continue;
          }
          const updateRes = await fetch("/api/likes/update-spent", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              txid: like.txid,
              spent_txid: unlockTxid,
            }),
          });
          if (!updateRes.ok) {
            const errorData = await updateRes.json().catch(() => ({}));
            addLog(
              `Failed ${formatShortTxid(like.txid, VAULT_SHORT_TXID)}: ${(errorData as { error?: string })?.error ?? "error"}`,
            );
          } else {
            successfulUnlocks.push(like.txid);
            addLog(`Updated ${formatShortTxid(like.txid, VAULT_SHORT_TXID)}`);
          }
        } catch (apiError) {
          addLog(
            `Error ${formatShortTxid(like.txid, VAULT_SHORT_TXID)}: ${apiError instanceof Error ? apiError.message : String(apiError)}`,
          );
        }
      }

      if (successfulUnlocks.length > 0) {
        setUnlockSummary({
          updated: successfulUnlocks.length,
          total: syncTotal,
        });
        setUnlockComplete(true);
        setUnlockStatus((prev) => ({ ...prev, stepProgressPct: 100 }));
        toast({
          title: "Success",
          description: `Unlocked ${successfulUnlocks.length} transaction${successfulUnlocks.length !== 1 ? "s" : ""}`,
        });
      } else {
        setUnlockError(
          "Broadcast succeeded but no vault rows were updated. Check the log.",
        );
        toast({
          title: "Warning",
          description: "Transaction may be on-chain; vault rows not updated.",
          variant: "destructive",
        });
      }

      await refetchActive();
      await refetchUnlockable();
      queryClient.invalidateQueries({ queryKey: ["likes"] });
    } catch (error) {
      console.error("[VAULT] Unlock error:", error);
      const message =
        error instanceof Error ? error.message : "Unlock failed";
      setUnlockError(message);
      setUnlockLogs((prev) => [...prev, `Error: ${message}`]);
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsUnlocking(false);
      setUnlockStatus((prev) => ({
        ...prev,
        isProcessing: false,
        phase: "idle",
      }));
    }
  };

  const handleDone = async () => {
    setShowUnlockModal(false);
    // Refetch both active and unlockable likes to update the UI
    await refetchActive();
    await refetchUnlockable();
    // Invalidate the likes queries to ensure fresh data
    queryClient.invalidateQueries({ queryKey: ["likes"] });
    setUnlockComplete(false);
    setUnlockSummary(null);
    setUnlockBroadcastTxid(null);
  };

  const renderLikesTable = (
    likes: Like[],
    tableType: "unlockable" | "still-locked" = "unlockable",
    limit?: number,
  ) => {
    const defaultSort =
      tableType === "still-locked"
        ? { key: "unlock_height" as const, direction: "asc" as const }
        : { key: "sats_amount" as const, direction: "desc" as const };

    const sortedLikes = getSortedLikes(likes, defaultSort);
    const displayLikes = limit ? sortedLikes.slice(0, limit) : sortedLikes;

    return (
      <Table className="table-fixed w-full">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[34%] text-[10px] sm:text-sm px-1.5 sm:px-3">
              Transaction
            </TableHead>
            <TableHead className="w-[22%] text-[10px] sm:text-sm px-1.5 sm:px-3">
              <Button
                variant="ghost"
                onClick={() => handleSort("sats_amount")}
                className="flex items-center gap-0.5 h-auto p-0 text-[10px] sm:text-sm max-w-full"
              >
                <span className="truncate">Amount</span>
                <ArrowUpDown className="h-2 w-2 sm:h-3.5 sm:w-3.5 shrink-0" />
              </Button>
            </TableHead>
            <TableHead className="w-[24%] text-[10px] sm:text-sm px-1.5 sm:px-3">
              {tableType === "still-locked" ? (
                <Button
                  variant="ghost"
                  onClick={() => handleSort("unlock_height")}
                  className="flex items-center gap-0.5 h-auto p-0 text-[10px] sm:text-sm max-w-full"
                >
                  <span className="truncate">Status</span>
                  <ArrowUpDown className="h-2 w-2 sm:h-3.5 sm:w-3.5 shrink-0" />
                </Button>
              ) : (
                <span className="text-[10px] sm:text-sm">Status</span>
              )}
            </TableHead>
            <TableHead className="w-[20%] text-[10px] sm:text-sm px-1.5 sm:px-3">
              <span className="sm:hidden">USD</span>
              <span className="hidden sm:inline">USD Value</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayLikes.map((like) => (
            <TableRow key={like.txid}>
              <TableCell className="min-w-0 px-1.5 sm:px-3 py-2">
                <a
                  href={wocTxUrl(like.txid)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] sm:text-sm font-mono text-muted-foreground hover:text-amber-600 dark:hover:text-amber-300 transition-colors block truncate"
                  title={like.txid}
                >
                  {formatShortTxid(like.txid, VAULT_TABLE_SHORT_TXID)}
                </a>
              </TableCell>
              <TableCell className="font-medium text-[10px] sm:text-sm px-1.5 sm:px-3 py-2 tabular-nums">
                <span className="block truncate">
                  {formatSatsAbbreviated(like.sats_amount)} sats
                </span>
              </TableCell>
              <TableCell className="text-[10px] sm:text-sm px-1.5 sm:px-3 py-2">
                <span className="block truncate">
                  {tableType === "still-locked"
                    ? `${getBlocksUntilUnlock(like.unlock_height)} blocks`
                    : "Unlockable"}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground text-[10px] sm:text-sm px-1.5 sm:px-3 py-2 tabular-nums">
                <span className="block truncate">
                  {formatSatsToUSD(like.sats_amount, bsvPrice)}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  // Show loading if data is still loading
  const isLoading = isLoadingActive || isLoadingUnlockable;
  const hasError = activeError || unlockableError;

  if (isLoading) {
    return <VaultLoadingState />;
  }

  // Show error state
  if (hasError) {
    return (
      <div className="relative">
        <div className="w-full max-w-4xl lg:my-0 mt-4 mx-auto px-2 sm:px-4 pb-4 sm:pb-8">
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <div className="p-4 rounded-2xl border border-destructive/30 bg-destructive/5 backdrop-blur text-center">
              <div className="text-sm text-destructive">
                Failed to load your locked likes. Please try refreshing the
                page.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="w-full max-w-4xl lg:my-0 mx-auto px-2 sm:px-4 pb-4 sm:pb-8">
        {/* Stat Cards */}
        <div className="grid grid-cols-2 gap-1.5 sm:gap-4 mb-4 sm:mb-10">
          <div
            onClick={() => setActiveView("locked")}
            className={cn(
              "p-1.5 sm:p-4 border rounded-2xl cursor-pointer transition-all duration-300 min-h-[80px] sm:min-h-[120px] flex flex-col backdrop-blur",
              activeView === "locked"
                ? "border-border/80 bg-muted/60 shadow-[0_0_0_1px_rgba(245,158,11,0.12),0_10px_30px_-20px_rgba(0,0,0,0.45)]"
                : "border-border/60 bg-background/50 hover:border-border hover:bg-muted/40",
            )}
          >
            <div className="flex-1 space-y-0.5 sm:space-y-1">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Currently Locked ({totalLockedCount})
              </div>
              <div className="text-sm sm:text-2xl font-bold font-mono tabular-nums">
                {formatSatsAbbreviated(totalLockedSats)} sats
              </div>
              <div className="text-[10px] sm:text-sm text-muted-foreground">
                {formatSatsToUSD(totalLockedSats, bsvPrice)}
              </div>
            </div>
            <div className="h-5 sm:h-8 flex items-end">
              {/* Empty space to match the other card */}
            </div>
          </div>
          <div
            onClick={() => {
              setActiveView("unlockable");
              if (unlockableSats > 0) {
                // Optional: could still show unlock modal on secondary click
              }
            }}
            className={cn(
              "p-1.5 sm:p-4 border rounded-2xl cursor-pointer transition-all duration-300 min-h-[80px] sm:min-h-[120px] flex flex-col backdrop-blur",
              activeView === "unlockable"
                ? "border-amber-400/60 bg-gradient-to-b from-amber-400/[0.12] to-amber-400/[0.02] shadow-[0_0_0_1px_rgba(245,158,11,0.3),0_18px_45px_-20px_rgba(245,158,11,0.45)]"
                : unlockableSats > 0
                  ? "border-amber-400/30 hover:border-amber-400/60 hover:bg-amber-400/5"
                  : "border-border/60 bg-background/50 hover:border-border hover:bg-muted/40",
            )}
          >
            <div className="flex-1 space-y-0.5 sm:space-y-1">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Ready to Unlock ({unlockableCount})
              </div>
              <div className={cn(
                "text-sm sm:text-2xl font-bold font-mono tabular-nums",
                unlockableSats > 0 ? "text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24]" : "",
              )}>
                {formatSatsAbbreviated(unlockableSats)} sats
              </div>
              <div className="text-[10px] sm:text-sm text-muted-foreground">
                {formatSatsToUSD(unlockableSats, bsvPrice)}
              </div>
            </div>
            <div className="h-5 sm:h-8 flex items-end">
              <div
                className={cn(
                  "w-full transition-all duration-300 ease-in-out",
                  unlockableSats > 0 && activeView === "unlockable"
                    ? "opacity-100 transform translate-y-0"
                    : "opacity-0 transform translate-y-2 pointer-events-none",
                )}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    resetUnlockWizard();
                    setShowUnlockModal(true);
                    requestAnimationFrame(() => void runAutomaticVaultUnlock());
                  }}
                  className="group relative inline-flex w-full items-center justify-center overflow-hidden rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 px-3 text-[10px] sm:text-xs font-semibold text-black h-5 sm:h-8 shadow-[0_8px_20px_-10px_rgba(245,158,11,0.55)] transition-all hover:scale-[1.01] hover:shadow-[0_12px_30px_-10px_rgba(245,158,11,0.75)]"
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-amber-300 via-amber-200 to-amber-300 opacity-0 transition-opacity group-hover:opacity-100" />
                  <span className="relative">Unlock All</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Table Content */}
        <Card className="w-full rounded-2xl border-border/60 bg-background/60 backdrop-blur shadow-none">
          <CardContent className="space-y-2 p-2 sm:p-6">
            <div className="rounded-xl border border-border/60 overflow-hidden h-[300px] sm:h-[400px] bg-background/40 backdrop-blur">
              <div className="h-full overflow-y-auto overflow-x-hidden">
                <div className="w-full max-w-full h-full">
                  {activeView === "locked" ? (
                    stillLockedLikes.length > 0 ? (
                      renderLikesTable(stillLockedLikes, "still-locked")
                    ) : (
                      <div className="flex items-center justify-center h-full p-2 sm:p-4">
                        <div className="text-center text-muted-foreground text-xs sm:text-sm">
                          No likes are currently locked
                        </div>
                      </div>
                    )
                  ) : unlockableLikes.length > 0 ? (
                    <>
                      {renderLikesTable(
                        unlockableLikes,
                        "unlockable",
                        unlockableLimit,
                      )}
                      {unlockableLikes.length > unlockableLimit && (
                        <div className="p-2 sm:p-4 border-t border-border/60 bg-background/40 backdrop-blur">
                          <Button
                            variant="outline"
                            onClick={() =>
                              setUnlockableLimit((prev) => prev + 10)
                            }
                            className="w-full rounded-full border-border/70 bg-background/60 backdrop-blur text-xs sm:text-sm hover:border-amber-400/60 hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300"
                          >
                            Show More (
                            {unlockableLikes.length - unlockableLimit}{" "}
                            remaining)
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center justify-center h-full p-2 sm:p-4">
                      <div className="text-center text-muted-foreground text-xs sm:text-sm">
                        No likes are ready to unlock in your wallet
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Unlock Status Modal */}
        <Dialog
          open={showUnlockModal}
          onOpenChange={(open) => {
            setShowUnlockModal(open);
            if (!open) {
              resetUnlockWizard();
            }
          }}
        >
          <DialogContent className="w-[92vw] max-w-md max-h-[85vh] p-5 sm:p-6 mx-auto rounded-2xl flex flex-col gap-0 border border-border/60 bg-background/95 backdrop-blur-xl shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_20px_50px_-20px_rgba(0,0,0,0.55)] overflow-hidden">
            <DialogHeader className="pb-3 text-center shrink-0">
              <DialogTitle className="font-vzn-headings text-2xl font-normal tracking-tight">
                {unlockComplete ? (
                  <>Unlock <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24]">complete</span></>
                ) : unlockError ? (
                  <>Unlock <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24]">failed</span></>
                ) : (
                  <>Unlock <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24]">vault</span></>
                )}
              </DialogTitle>
              {!unlockComplete && !unlockError && (
                <p className="text-xs sm:text-sm text-muted-foreground font-normal pt-1 leading-snug">
                  Checking parallel-contract lock vout {LOCK_LIKE_MINT_LOCK_VOUT}, syncing Supabase, then broadcasting if needed.
                </p>
              )}
            </DialogHeader>

            <div className="flex-1 flex flex-col min-h-0 space-y-4 py-1">
              {unlockError ? (
                <div className="text-center space-y-4">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-red-500/20 via-red-500/10 to-transparent ring-1 ring-red-500/30 shadow-[0_10px_30px_-10px_rgba(239,68,68,0.35)] flex items-center justify-center">
                    <div className="text-xl font-semibold text-red-600 dark:text-red-400">!</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-base font-semibold text-red-600 dark:text-red-400">
                      Something went wrong
                    </div>
                    <div className="text-sm text-muted-foreground break-words max-w-sm mx-auto text-left">
                      {unlockError}
                    </div>
                  </div>
                </div>
              ) : !unlockComplete ? (
                <>
                  {(() => {
                    const { phase, dbRecordIndex, dbRecordTotal } =
                      unlockStatus;
                    const running = isUnlocking || unlockStatus.isProcessing;
                    const { headline, detail } = vaultUnlockPhaseCopy(
                      running ? phase : "building_tx",
                      dbRecordIndex,
                      dbRecordTotal,
                    );
                    const progressPct = Math.min(
                      100,
                      Math.round(unlockStatus.stepProgressPct),
                    );
                    return (
                      <div className="space-y-3 w-full">
                        <div className="rounded-xl border border-border/60 bg-background/60 backdrop-blur px-3 py-2.5 text-left space-y-1">
                          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            {running ? "In progress" : "Starting…"}
                          </div>
                          <div className="text-sm sm:text-base font-semibold leading-tight">
                            {headline}
                          </div>
                          <p className="text-xs sm:text-sm text-muted-foreground leading-snug">
                            {detail}
                          </p>
                        </div>

                        <div className="w-full space-y-1.5">
                          <div className="h-2 w-full overflow-hidden rounded-full bg-border/60">
                            <div
                              className="h-full bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 transition-[width] duration-150"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
                            <span className="font-mono tabular-nums">
                              {progressPct}%
                            </span>
                            <span
                              className="truncate text-right"
                              title={unlockLogs[unlockLogs.length - 1]}
                            >
                              {unlockLogs.length > 0
                                ? unlockLogs[unlockLogs.length - 1]
                                : "Preparing…"}
                            </span>
                          </div>
                        </div>

                        {unlockBroadcastTxid ? (
                          <div className="rounded-xl border border-border/60 bg-background/60 backdrop-blur px-3 py-2 text-left">
                            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                              Unlock transaction
                            </div>
                            <a
                              href={wocTxUrl(unlockBroadcastTxid)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-block text-xs sm:text-sm font-medium font-mono text-amber-600 dark:text-amber-300 hover:underline break-all"
                              title={unlockBroadcastTxid}
                            >
                              {unlockBroadcastTxid}
                            </a>
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}

                  <div className="w-full flex-1 min-h-[100px] max-h-[200px] overflow-auto rounded-xl border border-border/60 p-2.5 bg-background/40 backdrop-blur text-[10px] sm:text-xs text-left">
                    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1.5">
                      Activity log
                    </div>
                    {unlockLogs.length === 0 ? (
                      <div className="text-muted-foreground">
                        Log lines appear as each step finishes.
                      </div>
                    ) : (
                      <ul className="space-y-1.5">
                        {unlockLogs.map((l, idx) => (
                          <li
                            key={idx}
                            className="break-words border-l-2 border-amber-400/40 pl-2"
                          >
                            {l}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center space-y-4">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500/20 via-emerald-500/10 to-transparent ring-1 ring-emerald-500/30 shadow-[0_10px_30px_-10px_rgba(16,185,129,0.35)] flex items-center justify-center">
                    <div className="text-xl text-emerald-600 dark:text-emerald-400">
                      ✓
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-base font-semibold text-emerald-600 dark:text-emerald-400">
                      Success
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {!unlockBroadcastTxid && unlockSummary
                        ? `Removed or updated ${unlockSummary.updated} vault row${unlockSummary.updated === 1 ? "" : "s"}. Nothing left to unlock on-chain.`
                        : unlockSummary &&
                            unlockSummary.updated === unlockSummary.total
                          ? `All ${unlockSummary.total} transaction${unlockSummary.total === 1 ? "" : "s"} ${unlockSummary.total === 1 ? "was" : "were"} unlocked and synced.`
                          : unlockSummary
                            ? `Synced ${unlockSummary.updated} of ${unlockSummary.total} vault record${unlockSummary.total === 1 ? "" : "s"}. Open the log if any row failed.`
                            : "Your vault has been updated."}
                    </div>
                    {unlockBroadcastTxid ? (
                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-left">
                        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          Unlock transaction
                        </div>
                        <a
                          href={wocTxUrl(unlockBroadcastTxid)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block text-sm font-medium font-mono text-emerald-700 dark:text-emerald-400 hover:underline break-all"
                          title={unlockBroadcastTxid}
                        >
                          {unlockBroadcastTxid}
                        </a>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 flex flex-col gap-2">
              {unlockError ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowUnlockModal(false);
                    setUnlockError(null);
                  }}
                  className="w-full inline-flex items-center justify-center rounded-full border border-border/70 bg-background/60 px-6 py-3 text-sm font-medium text-foreground backdrop-blur transition-colors hover:bg-muted/60"
                >
                  Close
                </button>
              ) : unlockComplete ? (
                <button
                  type="button"
                  onClick={handleDone}
                  className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 px-6 py-3 text-sm font-semibold text-black shadow-[0_10px_30px_-10px_rgba(245,158,11,0.55)] transition-all hover:scale-[1.01] hover:shadow-[0_14px_40px_-10px_rgba(245,158,11,0.75)]"
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-amber-300 via-amber-200 to-amber-300 opacity-0 transition-opacity group-hover:opacity-100" />
                  <span className="relative">Done</span>
                </button>
              ) : (
                <div
                  aria-hidden
                  className="w-full inline-flex items-center justify-center gap-2 rounded-full border border-border/60 bg-muted/30 px-6 py-3 text-sm text-muted-foreground"
                >
                  {isUnlocking || unlockStatus.isProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      Unlocking…
                    </>
                  ) : (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      Starting…
                    </>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
