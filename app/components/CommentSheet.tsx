"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/app/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/app/components/ui/sheet";
import { Textarea } from "@/app/components/ui/textarea";
import { useAuth } from "@/app/contexts/AuthContext";
import { toast } from "@/app/hooks/use-toast";
import { useWallet } from "@/app/hooks/use-wallet";
import { getOwnerKey, signWithAIP } from "@/app/lib/aip-signer";
import { wocTxUrl } from "@/app/lib/explorer";
import { replyQueryKeys } from "@/app/lib/query-keys";
import {
  clearOptimisticReply,
  registerOptimisticReply,
  syncReplyCountAcrossPostCaches,
} from "@/app/lib/supabase/posts";
import { getProfileByUserId } from "@/app/lib/supabase/profiles";
import {
  formatProgressElapsedTime,
  getTransactionProgressLabel,
} from "@/app/lib/transaction-progress";
import {
  formatPublicKey,
  formatShortTxid,
  formatTimeAgo,
} from "@/app/lib/utils";
import { createClient } from "@/utils/supabase/client";

type Reply = {
  txid: string;
  post_txid: string;
  user_id: string;
  content: string;
  created_at: string;
  profile?: {
    username?: string | null;
    avatar_url?: string | null;
  } | null;
};

type CommentSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  postTxid: string;
  ownerUserId: string;
  onReplyAdded?: () => void;
};

// Add this to store comment drafts by post ID
const commentDrafts = new Map<string, string>();
const walletToastCooldowns = new Map<string, number>();

export default function CommentSheet({
  isOpen,
  onClose,
  postTxid,
  ownerUserId,
  onReplyAdded,
}: CommentSheetProps) {
  const { user } = useAuth();
  const { isWalletReady } = useWallet();

  // Show toast when sheet opens without wallet
  React.useEffect(() => {
    if (isOpen && user && !isWalletReady) {
      const toastKey = `${user.id}:${postTxid}`;
      const now = Date.now();
      const lastShownAt = walletToastCooldowns.get(toastKey) ?? 0;

      if (now - lastShownAt < 1500) {
        return;
      }

      walletToastCooldowns.set(toastKey, now);
      toast({
        title: "Wallet Required",
        description: "Unlock wallet to reply",
        duration: 2000,
      });
    }
  }, [isOpen, user, isWalletReady, postTxid]);

  // Initialize comment from stored draft if available
  const [comment, setComment] = useState(
    () => commentDrafts.get(postTxid) || "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const commentsContainerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Extract the query function to avoid duplication
  const fetchRepliesWithProfiles = async () => {
    const response = await fetch(
      `/api/replies?post_txid=${postTxid}&with_profiles=true`,
    );
    if (!response.ok) {
      throw new Error("Failed to fetch replies");
    }
    const result = await response.json();
    return result.replies || [];
  };

  // Use the extracted query function
  const { data: replies = [], isLoading } = useQuery({
    queryKey: replyQueryKeys.byPost(postTxid),
    queryFn: fetchRepliesWithProfiles,
    enabled: isOpen,
    staleTime: 1000 * 60 * 5, // 5 minutes (match Post component)
    gcTime: 1000 * 60 * 30, // 30 minutes
    retry: 3,
    retryDelay: (attemptIndex: number) =>
      Math.min(1000 * 2 ** attemptIndex, 10000), // Exponential backoff
  });

  // Scroll to bottom when new comments are added
  useEffect(() => {
    if (commentsContainerRef.current) {
      commentsContainerRef.current.scrollTop =
        commentsContainerRef.current.scrollHeight;
    }
  }, [replies]);

  useEffect(() => {
    let interval: number | undefined;

    if (isSubmitting) {
      setElapsedSeconds(0);
      interval = window.setInterval(() => {
        setElapsedSeconds((seconds) => seconds + 1);
      }, 1000);
    }

    return () => {
      if (interval) {
        window.clearInterval(interval);
      }
    };
  }, [isSubmitting]);

  // Note: Realtime updates for replies are handled by feed-level subscriptions,
  // which keep the ['replies', postTxid] cache deduped across mounted surfaces.

  // Save comment draft when changing
  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setComment(newValue);
    commentDrafts.set(postTxid, newValue);
  };

  const handleSubmit = async () => {
    if (!comment.trim() || isSubmitting || !user) {
      if (!user) {
        toast({
          title: "Login Required",
          description: "Please login to reply",
          variant: "default",
        });
      }
      return;
    }
    if (!isWalletReady) {
      toast({
        title: "Wallet Required",
        description: "Unlock wallet to reply",
        duration: 2000,
      });
      return;
    }
    let optimisticReplyTxid: string | null = null;

    try {
      setIsSubmitting(true);
      setProgress(25);

      // Generate AIP signature using user's owner key (client-side)
      const ownerKeyWif = getOwnerKey();
      let aipSignature: string | undefined;
      let signerAddress: string | undefined;

      if (ownerKeyWif) {
        const aipData = signWithAIP(comment, ownerKeyWif, postTxid);
        if (aipData) {
          aipSignature = aipData.signature;
          signerAddress = aipData.address;
        }
      }

      if (!aipSignature || !signerAddress) {
        toast({
          title: "Signing failed",
          description:
            "Could not sign with your owner key. Unlock your wallet and try again.",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      setProgress(50);

      // Call server-side API to sign and broadcast the reply transaction
      // This keeps the APP_PAYMENT_KEY secure on the server
      const signResponse = await fetch("/api/sign-and-pay", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: comment,
          type: "reply",
          replyToTxid: postTxid,
          aipSignature,
          signerAddress,
        }),
      });

      setProgress(80);

      if (!signResponse.ok) {
        const error = await signResponse.json();
        console.error("Sign and pay error:", error);
        throw new Error(error.error || "Failed to create reply");
      }

      const { txid } = await signResponse.json();
      optimisticReplyTxid = txid;

      registerOptimisticReply(txid);

      // Save to database using user_id from context
      setProgress(85);

      // Use API route instead of direct Supabase insert
      const response = await fetch("/api/replies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          txid,
          post_txid: postTxid,
          user_id: user.id,
          content: comment,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save reply");
      }

      const supabase = createClient();
      const profileData = await getProfileByUserId(supabase, user.id, {
        fallbackUsername: "You",
      });

      const newReply: Reply = {
        txid,
        post_txid: postTxid,
        user_id: user.id,
        content: comment,
        created_at: new Date().toISOString(),
        profile: profileData || {
          username: null,
          avatar_url: null,
        },
      };

      // Immediately add to cache
      queryClient.setQueryData<Reply[]>(
        replyQueryKeys.byPost(postTxid),
        (oldData) => {
          const currentReplies = oldData || [];
          // Check if already exists to prevent duplicates
          if (currentReplies.some((reply) => reply.txid === txid)) {
            return currentReplies;
          }
          return [...currentReplies, newReply];
        },
      );

      syncReplyCountAcrossPostCaches(queryClient, postTxid);

      // Reset form
      setProgress(100);
      setElapsedSeconds(0);
      setComment("");
      commentDrafts.delete(postTxid);
      onReplyAdded?.();

      // Reset progress after a brief delay
      setTimeout(() => {
        setProgress(0);
      }, 500);
    } catch (error) {
      if (optimisticReplyTxid) {
        clearOptimisticReply(optimisticReplyTxid);
      }
      console.error("Error submitting reply:", error);
      setProgress(0);
      setElapsedSeconds(0);
      // Show error to user
      toast({
        title: "Error posting reply",
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  const PRIMARY_CTA =
    "inline-flex items-center justify-center gap-2 rounded-full border-2 border-amber-400 bg-inherit px-6 py-3 text-sm font-semibold text-foreground transition-colors duration-200 ease-in-out animate-pulse-orange hover:bg-amber-400/10 focus:outline-none focus-visible:border-amber-400 focus-visible:ring-2 focus-visible:ring-amber-400/45 disabled:pointer-events-none disabled:opacity-60";

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent
        side="bottom"
        className="z-[200] mx-auto flex h-[80vh] w-full max-w-[600px] flex-col overflow-hidden rounded-t-2xl border-t border-border/60 bg-background/95 p-0 shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_-20px_50px_-20px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:h-[70vh]"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-amber-400/15 blur-3xl"
        />

        <SheetHeader className="sr-only">
          <SheetTitle>Replies</SheetTitle>
        </SheetHeader>

        <div
          className="relative mt-12 flex-1 overflow-y-auto px-6 font-post-sans"
          ref={commentsContainerRef}
        >
          <div className="space-y-5 pb-3">
            {isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : replies.length === 0 ? (
              <div className="py-8 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                No replies yet
              </div>
            ) : (
              replies.map((reply: Reply) => (
                <div key={reply.txid} className="flex gap-3">
                  <Avatar className="h-10 w-10 flex-shrink-0 bg-muted ring-1 ring-border/60">
                    {reply.profile?.avatar_url ? (
                      <AvatarImage src={reply.profile.avatar_url} />
                    ) : (
                      <>
                        <AvatarImage
                          src="/default-avy.png"
                          alt="Default Avatar"
                          className="transition-opacity duration-200 dark:opacity-0"
                        />
                        <AvatarImage
                          src="/default-avy.png"
                          alt="Default Avatar"
                          className="absolute inset-0 opacity-0 transition-opacity duration-200 dark:opacity-100"
                        />
                      </>
                    )}
                    <AvatarFallback>
                      {reply.profile?.username?.charAt(0)?.toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex w-full items-center justify-between gap-2">
                      <div className="flex min-w-0 items-baseline gap-1.5">
                        <span className="truncate text-[15px] font-medium text-foreground">
                          {reply.profile?.username ||
                            formatPublicKey(reply.user_id)}
                        </span>
                        {reply.user_id === ownerUserId && (
                          <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-amber-600 dark:text-amber-300">
                            OP
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground/50">·</span>
                        <a
                          href={wocTxUrl(reply.txid)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0 text-xs text-muted-foreground hover:text-foreground"
                        >
                          {formatTimeAgo(reply.created_at)}
                        </a>
                      </div>
                      <a
                        href={wocTxUrl(reply.txid)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 flex-shrink-0 font-post-mono text-[11px] tabular-nums text-muted-foreground/70 transition-colors hover:text-amber-500 dark:hover:text-amber-300"
                        title={`View on Whatsonchain: ${reply.txid}`}
                      >
                        {formatShortTxid(reply.txid)}
                      </a>
                    </div>
                    <p className="mt-1 text-[15px] leading-snug text-foreground/90">
                      {reply.content}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="relative border-t border-border/60 bg-background/60 px-6 pb-6 pt-4 font-post-sans backdrop-blur">
          <Textarea
            placeholder="Write a reply…"
            value={comment}
            onChange={handleCommentChange}
            className="min-h-[84px] resize-none rounded-xl border-border/70 bg-background/70 font-post-sans backdrop-blur focus-visible:border-amber-400/60 focus-visible:ring-amber-400/30"
            disabled={!user || !isWalletReady}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                isSubmitting || !user || !isWalletReady || !comment.trim()
              }
              className={`${PRIMARY_CTA} min-w-[180px]`}
            >
              <span className="flex items-center justify-center gap-2">
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">
                      {getTransactionProgressLabel(progress)}…{" "}
                      {formatProgressElapsedTime(elapsedSeconds)}
                    </span>
                  </>
                ) : (
                  "Reply"
                )}
              </span>
            </button>
          </div>
          {progress > 0 && (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border/60">
              <div
                className="h-full bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 transition-[width] duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
