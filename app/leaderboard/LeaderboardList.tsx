"use client";

import Link from "next/link";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/app/components/ui/avatar";
import { formatSatsAbbreviated, formatUSD } from "@/app/lib/utils";
import type { LeaderboardProfile } from "@/types";

interface LeaderboardListProps {
  rankedProfiles: LeaderboardProfile[];
  bsvPrice: number;
}

export default function LeaderboardList({
  rankedProfiles,
  bsvPrice,
}: LeaderboardListProps) {
  if (!rankedProfiles || rankedProfiles.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-background/60 backdrop-blur p-8 text-center text-muted-foreground">
        No active lockers found yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rankedProfiles.map((profile, index) => (
        <Link
          key={profile.user_id}
          href={`/${profile.username || profile.user_id}`}
          className="block"
        >
          <div className="group flex items-center gap-4 p-4 rounded-2xl border border-border/60 bg-background/60 backdrop-blur hover:border-amber-400/40 hover:bg-amber-400/[0.04] transition-colors">
            <div className="relative">
              <Avatar className="h-12 w-12 ring-1 ring-border/60 group-hover:ring-amber-400/50 transition-all">
                <AvatarImage
                  src={profile.avatar_url || "/default-avy.png"}
                  alt={profile.username || "User avatar"}
                />
                <AvatarFallback>
                  {profile.username
                    ? profile.username.charAt(0).toUpperCase()
                    : "B"}
                </AvatarFallback>
              </Avatar>
              <span
                className={`absolute -left-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 font-mono text-[10px] tabular-nums ${
                  index === 0
                    ? "bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 text-black shadow-[0_6px_16px_-6px_rgba(245,158,11,0.6)]"
                    : "border border-border/60 bg-background/90 text-muted-foreground backdrop-blur"
                }`}
              >
                {index + 1}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold truncate group-hover:text-amber-600 dark:group-hover:text-amber-300 transition-colors">
                {profile.username || `..${profile.owner_public_key.slice(-12)}`}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {profile.activeLocksCount} active lock
                {profile.activeLocksCount !== 1 ? "s" : ""}
              </div>
            </div>

            {/* Sats and USD columns - same on mobile and desktop */}
            <div className="flex gap-4 md:gap-6 items-center">
              {/* Sats column */}
              <div className="text-right min-w-[70px] md:min-w-[100px]">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Sats
                </div>
                <div className="text-sm font-medium font-mono tabular-nums text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24]">
                  {formatSatsAbbreviated(profile.totalLockedSats)}
                </div>
              </div>

              {/* Divider */}
              <div className="h-8 w-px bg-border/60" />

              {/* USD column */}
              <div className="text-right min-w-[60px] md:min-w-[80px]">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  USD
                </div>
                <div className="text-sm font-medium font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatUSD(profile.totalLockedSats, bsvPrice)}
                </div>
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
