import { usePathname, useRouter } from "next/navigation";
import React from "react";
import { Button } from "@/app/components/ui/button";
import { wocTxUrl } from "@/app/lib/explorer";
import { formatShortTxid, formatTimeAgo } from "@/app/lib/utils";
import type { PostProps } from "./postTypes";

type PostHeaderProps = {
  post: PostProps["post"]; // Use the nested post type from PostProps
};

/**
 * Displays the header info of a post (username, verification status, timestamp)
 * and a share button. Avatar is rendered by the parent component.
 */
export const PostHeader = React.memo(({ post }: PostHeaderProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const profile = post.profile;
  const userIdentifier = profile?.username || post.user_id;
  const displayName =
    profile?.username ||
    (post.user_id ? `User ${post.user_id.substring(0, 6)}...` : "Anonymous");
  const profileLink = `/${userIdentifier}`;
  const xLink = profile?.username
    ? `https://x.com/${profile.username}`
    : undefined;
  const shortTxid = formatShortTxid(post.txid, { headChars: 6, tailChars: 6 });
  const isTxDetailPage =
    pathname?.startsWith("/tx/") && pathname?.split("/")[2] === post.txid;

  const handleUsernameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (userIdentifier) {
      router.push(profileLink);
    }
  };

  const handleTimestampClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(wocTxUrl(post.txid), "_blank", "noopener,noreferrer");
  };

  const handleXBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (xLink) {
      window.open(xLink, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="flex items-center justify-between w-full font-post-sans">
      {/* Left: Name + badge + dot + time */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <span
            className="font-vzn-headings font-normal text-[14px] tracking-[0.01em] hover:underline cursor-pointer truncate"
            onClick={handleUsernameClick}
            title={displayName}
          >
            {displayName}
          </span>
          <span className="text-sm text-muted-foreground/60">·</span>
          <span
            className="text-sm text-muted-foreground hover:text-foreground cursor-pointer flex-shrink-0 transition-colors"
            title={`View on Whatsonchain (${new Date(post.created_at).toLocaleString()})`}
            onClick={handleTimestampClick}
          >
            {formatTimeAgo(post.created_at)}
          </span>
        </div>
      </div>
      {/* Right: short txid button */}
      <div className="flex-shrink-0">
        <Button
          variant="ghost"
          className="h-6 px-2 font-post-mono tabular-nums text-xs text-muted-foreground hover:text-amber-600 dark:hover:text-amber-300 hover:bg-amber-400/10 transition-colors group"
          onClick={(e) => {
            e.stopPropagation();
            if (isTxDetailPage) {
              window.open(wocTxUrl(post.txid), "_blank", "noopener,noreferrer");
            } else {
              router.push(`/tx/${post.txid}`);
            }
          }}
          title={isTxDetailPage ? "View on Whatsonchain" : "Open post"}
          aria-label={isTxDetailPage ? "View on Whatsonchain" : "Open post"}
        >
          {shortTxid}
        </Button>
      </div>
    </div>
  );
});

PostHeader.displayName = "PostHeader";
