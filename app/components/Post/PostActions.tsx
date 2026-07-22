import { useQueryClient } from "@tanstack/react-query";
import { Link2, MessageSquare } from "lucide-react";
import Link from "next/link";
import React, { useMemo } from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/app/components/ui/avatar";
import { Button } from "@/app/components/ui/button";
import { ThinkingOrb } from "thinking-orbs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/app/components/ui/popover";
import { useToast } from "@/app/hooks/use-toast";
import {
  cn,
  formatSatsAbbreviated,
  getTotalLockedSats,
} from "@/app/lib/utils";
import type { Like } from "@/types";
import type { PostProps } from "./postTypes";

type LikeWithLikerProfile = NonNullable<PostProps["post"]["likes"]>[number];

type PostActionsProps = {
  post: PostProps["post"];
  replyCount: number;
  likes: LikeWithLikerProfile[];
  blockHeight: number;
  isAmountAnimating: boolean;
  onShowComments: () => void;
  onShowLock: () => void;
};

/**
 * Displays the action bar below the post content, including buttons/indicators
 * for comments, copy link, and likes (locked sats).
 */
export const PostActions = React.memo(
  ({
    post,
    replyCount,
    likes,
    blockHeight,
    isAmountAnimating,
    onShowComments,
    onShowLock,
  }: PostActionsProps) => {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const hasResolvedBlockHeight = blockHeight > 0;

    // Memoize derived data
    const activeLikes = useMemo(
      () =>
        hasResolvedBlockHeight
          ? likes.filter(
              (like: LikeWithLikerProfile) => like.unlock_height > blockHeight,
            )
          : [],
      [hasResolvedBlockHeight, likes, blockHeight],
    );
    const totalLockedSats = useMemo(
      () => getTotalLockedSats(activeLikes),
      [activeLikes],
    );

    // Aggregate active locks by locker so the popover shows one row per user
    // (top lockers), not one row per individual lock tx.
    const topLockers = useMemo(() => {
      type LockerRow = {
        userId: string;
        profile: LikeWithLikerProfile["liker_profile"];
        sats: number;
        count: number;
        nextUnlock: number;
      };
      const byUser = new Map<string, LockerRow>();
      for (const like of activeLikes) {
        const sats = Number(like.sats_amount ?? 0);
        const unlock = Number(like.unlock_height ?? 0);
        const existing = byUser.get(like.user_id);
        if (existing) {
          existing.sats += sats;
          existing.count += 1;
          existing.nextUnlock = Math.min(existing.nextUnlock, unlock);
        } else {
          byUser.set(like.user_id, {
            userId: like.user_id,
            profile: like.liker_profile,
            sats,
            count: 1,
            nextUnlock: unlock,
          });
        }
      }
      return [...byUser.values()].sort((a, b) => b.sats - a.sats);
    }, [activeLikes]);

    const handleShowCommentsClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      onShowComments();
    };

    const handleShowLockClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      onShowLock();
    };

    const handleCopyLink = (e: React.MouseEvent) => {
      e.stopPropagation();
      const url = `${window.location.origin}/tx/${post.txid}`;
      navigator.clipboard
        .writeText(url)
        .then(() => {
          toast({ description: "Post link copied!", duration: 1500 });
        })
        .catch(() => {
          toast({
            variant: "destructive",
            description: "Failed to copy link",
            duration: 1500,
          });
        });
    };

    const stopPropagation = (e: React.MouseEvent) => {
      e.stopPropagation();
    };

    return (
      <div className="relative mt-1 flex min-h-6 items-center justify-between pr-6 font-post-sans">
        {/* Left - Comments (match like: icon size + text-xs mono/sans count row) */}
        <div className="flex items-center min-w-[48px]">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 w-6 rounded-full hover:bg-muted/80 transition-colors group",
                replyCount > 0
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={handleShowCommentsClick}
              title={
                replyCount > 0
                  ? `${replyCount} repl${replyCount === 1 ? "y" : "ies"}`
                  : "Reply"
              }
            >
              <MessageSquare
                className={cn(
                  "h-4 w-4 transition-colors fill-none",
                  replyCount > 0
                    ? "text-foreground stroke-[2px]"
                    : "text-muted-foreground stroke-[1.5px] group-hover:text-foreground",
                )}
              />
            </Button>
            <button
              type="button"
              className={cn(
                "flex items-baseline gap-1 text-xs cursor-pointer select-none text-left transition-colors",
                replyCount > 0
                  ? "text-muted-foreground hover:text-foreground"
                  : "text-muted-foreground/70 hover:text-muted-foreground",
              )}
              onClick={handleShowCommentsClick}
              title={
                replyCount > 0
                  ? `${replyCount} repl${replyCount === 1 ? "y" : "ies"}`
                  : "Reply"
              }
            >
              <span
                className={cn(
                  "transition-transform font-medium font-post-mono tabular-nums",
                  replyCount > 0 ? "text-foreground" : "",
                )}
              >
                {replyCount}
              </span>
              <span className="font-post-sans">
                {replyCount === 1 ? "reply" : "replies"}
              </span>
            </button>
          </div>
        </div>

        {/* Middle - Like (locked sats, centered) */}
        <div className="absolute left-1/2 top-0 -translate-x-1/2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 w-6 rounded-full hover:bg-foreground/10 transition-colors group",
                hasResolvedBlockHeight && activeLikes.length > 0
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={handleShowLockClick}
              title={
                !hasResolvedBlockHeight
                  ? "Loading active likes"
                  : activeLikes.length > 0
                    ? `View ${activeLikes.length} like${activeLikes.length === 1 ? "" : "s"}`
                    : "Like with locked sats"
              }
            >
              <ThinkingOrb
                state="listening"
                size={20}
                speed={0.7}
                theme="auto"
                aria-label={
                  hasResolvedBlockHeight && totalLockedSats > 0
                    ? `${totalLockedSats.toLocaleString()} sats locked`
                    : "Like with locked sats"
                }
              />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "flex w-[4.75rem] items-baseline justify-start gap-1 whitespace-nowrap text-xs transition-colors",
                    hasResolvedBlockHeight && totalLockedSats > 0
                      ? "text-muted-foreground hover:text-foreground"
                      : "text-muted-foreground/70 hover:text-muted-foreground",
                  )}
                  onClick={stopPropagation}
                  disabled={!hasResolvedBlockHeight || totalLockedSats === 0}
                  title={
                    !hasResolvedBlockHeight
                      ? "Waiting for block height"
                      : totalLockedSats > 0
                        ? `${totalLockedSats.toLocaleString()} sats locked`
                        : "No active locks"
                  }
                >
                  <span
                    className={cn(
                      "transition-transform font-medium font-post-mono tabular-nums",
                      hasResolvedBlockHeight && totalLockedSats > 0
                        ? "text-foreground"
                        : "",
                      isAmountAnimating && "animate-scale-bounce",
                    )}
                  >
                    {hasResolvedBlockHeight
                      ? formatSatsAbbreviated(totalLockedSats)
                      : "..."}
                  </span>
                  <span className="font-post-sans">sats</span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[min(17rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] sm:w-80 sm:max-w-none overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-b from-background/95 to-background/85 p-0 font-post-sans backdrop-blur-xl shadow-[0_0_0_1px_rgba(245,158,11,0.15),0_20px_50px_-20px_rgba(0,0,0,0.45)]"
                align="center"
                onClick={stopPropagation}
              >
                <div className="flex items-center gap-2 border-b border-border/60 bg-gradient-to-r from-amber-500/5 via-transparent to-transparent px-3 py-2">
                  <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                    <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/70" />
                    <span className="relative h-1.5 w-1.5 rounded-full bg-amber-400" />
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Lock Terminal
                  </span>
                </div>

                <div className="p-3">
                  {topLockers.length === 0 ? (
                    <div className="py-4 text-center text-sm text-muted-foreground">
                      No active locks yet.
                    </div>
                  ) : (
                    <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1">
                      {topLockers.map((entry, index, arr) => {
                        const profile = entry.profile;
                        const profileTarget =
                          profile?.username || entry.userId;
                        const displayName =
                          profile?.username ||
                          (entry.userId
                            ? `..${entry.userId.slice(-6)}`
                            : "Anon");
                        const isOp = entry.userId === post.user_id;
                        const topSats = arr[0]?.sats ?? 1;
                        const share = topSats > 0 ? (entry.sats / topSats) * 100 : 0;

                        const profileHref = profileTarget
                          ? `/${profileTarget}`
                          : null;

                        return (
                          <div
                            key={entry.userId}
                            className="flex items-center gap-2"
                          >
                            <span className="w-4 text-center font-post-mono text-[10px] tabular-nums text-muted-foreground">
                              {index + 1}
                            </span>
                            {profileHref ? (
                              <Link
                                href={profileHref}
                                onClick={stopPropagation}
                                title={`View profile: ${displayName}`}
                                className="flex-shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                              >
                                <Avatar className="h-6 w-6 flex-shrink-0 cursor-pointer ring-1 ring-border/60 bg-muted transition-opacity hover:opacity-80">
                                  {profile?.avatar_url ? (
                                    <AvatarImage
                                      src={profile.avatar_url}
                                      alt={`${displayName} avatar`}
                                    />
                                  ) : (
                                    <AvatarImage
                                      src="/default-avy.png"
                                      alt="default"
                                    />
                                  )}
                                  <AvatarFallback>
                                    {displayName.charAt(0).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                              </Link>
                            ) : (
                              <Avatar className="h-6 w-6 flex-shrink-0 ring-1 ring-border/60 bg-muted">
                                <AvatarImage
                                  src="/default-avy.png"
                                  alt="default"
                                />
                                <AvatarFallback>
                                  {displayName.charAt(0).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                {profileHref ? (
                                  <Link
                                    href={profileHref}
                                    onClick={stopPropagation}
                                    className="flex min-w-0 items-center gap-1 truncate text-[12px] text-foreground transition-colors hover:text-primary hover:underline underline-offset-2 decoration-amber-400/60 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                                    title={profileTarget}
                                  >
                                    <span className="truncate">
                                      {displayName}
                                    </span>
                                    {isOp && (
                                      <span className="inline-flex flex-shrink-0 items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-1 py-0 font-mono text-[8px] uppercase tracking-[0.12em] text-amber-600 dark:text-amber-300">
                                        OP
                                      </span>
                                    )}
                                  </Link>
                                ) : (
                                  <span
                                    className="flex min-w-0 items-center gap-1 truncate text-[12px] text-muted-foreground"
                                    title={displayName}
                                  >
                                    <span className="truncate">
                                      {displayName}
                                    </span>
                                    {isOp && (
                                      <span className="inline-flex flex-shrink-0 items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-1 py-0 font-mono text-[8px] uppercase tracking-[0.12em] text-amber-600 dark:text-amber-300">
                                        OP
                                      </span>
                                    )}
                                  </span>
                                )}
                                <span className="flex-shrink-0 font-post-mono text-[11px] font-medium tabular-nums text-amber-600 dark:text-amber-300">
                                  {formatSatsAbbreviated(entry.sats)} sats
                                </span>
                              </div>
                              <div className="relative mt-1 h-1 overflow-hidden rounded-full bg-muted/40">
                                <div
                                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-500 to-amber-300"
                                  style={{ width: `${share}%` }}
                                />
                              </div>
                              <div className="mt-0.5 font-post-mono text-[9px] tabular-nums text-muted-foreground">
                                {entry.count} lock
                                {entry.count === 1 ? "" : "s"}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Right - Copy Link */}
        <div className="flex items-center min-w-[48px] justify-end">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-full hover:bg-muted/80 transition-colors group"
            onClick={handleCopyLink}
            title="Copy post link"
          >
            <Link2 className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </Button>
        </div>
      </div>
    );
  },
);

PostActions.displayName = "PostActions";
