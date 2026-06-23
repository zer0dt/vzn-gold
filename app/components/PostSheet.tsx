"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from 'next/image';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/app/components/ui/sheet";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import { ImagePlus, Loader2, X } from "lucide-react";
import { useToast } from "@/app/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { cn } from "@/app/lib/utils";
import LinkCard from "./LinkCard";
import { useTheme } from "next-themes";
import { useAuth } from '@/app/contexts/AuthContext';
import { components as tweetComponents, tweetEmbedClassName } from './embeds/X/tweet-components';
import { SafeTweet } from './embeds/X/SafeTweet';
import { useWallet } from '@/app/hooks/use-wallet';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { createClient } from '@/utils/supabase/client';
import type { Post as PostType } from '@/types';
import { signWithAIP, getOwnerKey } from '@/app/lib/aip-signer';
import { feedQueryKeys } from '@/app/lib/query-keys';
import { createOptimisticPost, prependPostToInfiniteData, type HydratedPost } from '@/app/lib/supabase/posts';
import { getProfileByUserId } from '@/app/lib/supabase/profiles';
import {
  formatImageSize,
  POST_IMAGE_INPUT_ACCEPT,
  preparePostImage,
  type PreparedPostImage,
} from '@/app/lib/post-image-utils';

// URL regex pattern
const URL_PATTERN = /https?:\/\/[^\s<]+[^<.,:;"')\]\s]/g;
const TWITTER_PATTERN =
  /https?:\/\/((?:x|twitter)\.com\/\w+\/status\/\d+)[^\s]*/gi;
const TWITTER_STATUS_URL_PATTERN =
  /https?:\/\/(?:x|twitter)\.com\/\w+\/status\/\d+[^\s]*/i;
const YOUTUBE_PATTERN =
  /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[^&\s]+|youtu\.be\/[^&\s]+)[^\s]*/gi;
const DEXSCREENER_PATTERN =
  /https?:\/\/(?:www\.)?dexscreener\.com\/([^/\s]+)\/([^/\s?&]+)[^\s]*/gi;

// Custom component for Twitter embeds
// Removed local TwitterEmbed definition

// Add this component near TwitterEmbed
const YouTubeEmbed = ({ url }: { url: string }) => {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  const videoId = match?.[1];

  if (!videoId) return null;

  return (
    <div className="aspect-video my-2">
      <iframe
        width="100%"
        height="100%"
        src={`https://www.youtube.com/embed/${videoId}`}
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="rounded-md"
      />
    </div>
  );
};

// Add this component near TwitterEmbed and YouTubeEmbed
const DexScreenerEmbed = ({ url }: { url: string }) => {
  // Add the theme hook
  const { theme } = useTheme();

  // Clean the URL first to remove any markdown formatting
  const cleanUrl = url
    .replace(/\[([^\]]*)\]\((.*?)\)/g, "$2")
    .replace(/\]\(https?:.*$/g, ""); // Remove trailing markdown artifacts

  // Extract the chain and pair address from the URL
  const match = cleanUrl.match(/dexscreener\.com\/([^/\s]+)\/([^/\s?&]+)/);
  const chain = match?.[1];
  const pairAddress = match?.[2];

  if (!chain || !pairAddress) return null;

  // Use the current theme to determine chart theme
  const chartTheme = theme === "dark" ? "dark" : "light";

  return (
    <div className="-mx-4 sm:-mx-2 md:mx-0 pr-4 sm:pr-2 md:pr-0 bg-transparent">
      {/* Mobile view (hidden on md and up) */}
      <div
        className="md:hidden relative w-full"
        style={{ paddingBottom: "140%" }}
      >
        <iframe
          src={`https://dexscreener.com/${chain}/${pairAddress}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartDefaultOnMobile=1&chartTheme=${chartTheme}&theme=${chartTheme}&chartStyle=1&chartType=usd&interval=5`}
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            top: 0,
            left: 0,
            border: 0,
          }}
          className="rounded-md"
        />
      </div>

      {/* Desktop view (hidden on smaller than md) */}
      <div className="hidden md:block relative w-full h-[200px]">
        <iframe
          src={`https://dexscreener.com/${chain}/${pairAddress}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartDefaultOnMobile=1&chartTheme=${chartTheme}&theme=${chartTheme}&chartStyle=1&chartType=usd&interval=5`}
          style={{ width: "100%", height: "100%", border: 0 }}
          className="rounded-md"
        />
      </div>
    </div>
  );
};

function containsTwitterStatusUrl(value: string): boolean {
  return TWITTER_STATUS_URL_PATTERN.test(value);
}

export default function PostSheet({
  isOpen,
  onClose,
  initialContent = "",
}: {
  isOpen: boolean;
  onClose: () => void;
  initialContent?: string;
}) {
  const [content, setContent] = useState("");
  const [isPreview, setIsPreview] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isImageProcessing, setIsImageProcessing] = useState(false);
  const [selectedImage, setSelectedImage] = useState<PreparedPostImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const { toast } = useToast();
  const { user, isLoading: isAuthLoading } = useAuth();
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  const { ownerAddress, calculateUSDValue, isWalletReady } = useWallet();

  // Add ref for the textarea
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Add ref for the sheet content
  const sheetContentRef = useRef<HTMLDivElement>(null);
  const previousIsOpenRef = useRef(false);

  // Function to reset component state
  const resetState = () => {
    if (selectedImage?.previewUrl) {
      URL.revokeObjectURL(selectedImage.previewUrl);
    }
    setContent("");
    setIsPreview(false);
    setIsLoading(false);
    setIsImageProcessing(false);
    setSelectedImage(null);
    setImageError(null);
    setProgress(0);
    setElapsedSeconds(0);
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  };

  // Show toast when sheet opens without wallet
  useEffect(() => {
    if (isOpen && user && !isWalletReady) {
      toast({ description: "Unlock wallet to post", duration: 2000 });
    }
  }, [isOpen, user, isWalletReady]);

  useEffect(() => {
    if (isOpen && !previousIsOpenRef.current) {
      setContent(initialContent);
      setIsPreview(containsTwitterStatusUrl(initialContent));
    }

    previousIsOpenRef.current = isOpen;
  }, [initialContent, isOpen]);

  useEffect(() => {
    let interval: number | undefined;

    if (isLoading) {
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
  }, [isLoading]);

  // Handle iOS specific issues with focus
  useEffect(() => {
    if (isOpen) {
      // For iOS detection
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      
      if (isIOS) {
        // iOS needs special handling for software keyboard
        const scrollToInput = () => {
          // Wait for iOS to render the input field
          setTimeout(() => {
            // Ensure the input is in view
            textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Try to focus it again
            textareaRef.current?.focus();
          }, 300);
        };
        
        // Run the iOS specific handling
        scrollToInput();
        
        // Add additional iOS specific event
        document.addEventListener('visibilitychange', scrollToInput);
        window.addEventListener('resize', scrollToInput);
        
        return () => {
          document.removeEventListener('visibilitychange', scrollToInput);
          window.removeEventListener('resize', scrollToInput);
        };
      }
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (selectedImage?.previewUrl) {
        URL.revokeObjectURL(selectedImage.previewUrl);
      }
    };
  }, [selectedImage?.previewUrl]);

  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setImageError(null);
    setIsImageProcessing(true);

    try {
      const preparedImage = await preparePostImage(file);
      setSelectedImage((previousImage) => {
        if (previousImage?.previewUrl) {
          URL.revokeObjectURL(previousImage.previewUrl);
        }
        return preparedImage;
      });
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Could not prepare image.");
      if (imageInputRef.current) {
        imageInputRef.current.value = "";
      }
    } finally {
      setIsImageProcessing(false);
    }
  };

  const handleRemoveImage = () => {
    if (selectedImage?.previewUrl) {
      URL.revokeObjectURL(selectedImage.previewUrl);
    }
    setSelectedImage(null);
    setImageError(null);
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  };

  // Modified useEffect with mobile-specific fixes
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      // Force blur any active element first (helps on mobile)
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      
      // More aggressive approach for mobile
      const focusTextarea = () => {
        if (textareaRef.current) {
          // Try multiple focus techniques
          textareaRef.current.focus();
          // Mobile-specific technique
          setTimeout(() => {
            textareaRef.current?.click();
            textareaRef.current?.focus();
          }, 50);
        }
      };
      
      // Initial focus attempts with increasing delays
      [100, 300, 500, 800, 1200].forEach(delay => {
        setTimeout(focusTextarea, delay);
      });
      
      // Add touch event listeners specifically for mobile
      const sheetContent = sheetContentRef.current || document.querySelector('.w-full.md\\:w-1\\/3.mx-auto') as HTMLElement;
      if (sheetContent) {
        const touchHandler = () => {
          focusTextarea();
          return false; // Prevent default
        };
        
        sheetContent.addEventListener('touchstart', touchHandler, { passive: false });
        sheetContent.addEventListener('click', focusTextarea);
        
        return () => {
          sheetContent.removeEventListener('touchstart', touchHandler);
          sheetContent.removeEventListener('click', focusTextarea);
        };
      }
    }
  }, [isOpen]);

  const handlePost = async () => {
    // Check Supabase auth status instead of wallet
    if (isAuthLoading) {
      // Optionally, show a loading indicator or disable the post button
      // For now, just prevent posting while auth state is loading
      return;
    }
    if (!user) {
      toast({
        variant: "destructive",
        title: "Authentication Required",
        description: "Please sign in before posting.",
        duration: 3000,
      });
      return;
    }
    if (!isWalletReady) {
      toast({ description: "Unlock wallet to post", duration: 2000 });
      return;
    }

    const finalContent = content.trim();
    const imagePayload = selectedImage
      ? {
          dataBase64: selectedImage.dataBase64,
          mediaType: selectedImage.mediaType,
          size: selectedImage.size,
        }
      : undefined;

    if (!finalContent && !imagePayload) {
      toast({
        variant: "destructive",
        description: "Add text or an image before posting.",
      });
      return;
    }

    setIsLoading(true);
    setProgress(0);

    try {
      setProgress(25);

      // Generate AIP signature using user's owner key (client-side)
      const ownerKeyWif = getOwnerKey();
      let aipSignature: string | undefined;
      let signerAddress: string | undefined;

      if (ownerKeyWif) {
        const aipData = signWithAIP(finalContent, ownerKeyWif, undefined, imagePayload, 'post');
        if (aipData) {
          aipSignature = aipData.signature;
          signerAddress = aipData.address;
          console.log('Generated AIP signature for owner address:', signerAddress);
        }
      }

      if (!aipSignature || !signerAddress) {
        toast({
          variant: "destructive",
          description: "Could not sign with your owner key. Unlock your wallet and try again.",
        });
        setIsLoading(false);
        return;
      }

      setProgress(50);

      // Call server-side API to sign and broadcast the transaction
      // This keeps the APP_PAYMENT_KEY secure on the server
      const response = await fetch('/api/sign-and-pay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: finalContent,
          type: 'post',
          image: imagePayload,
          aipSignature,
          signerAddress
        })
      });

      setProgress(80);

      if (!response.ok) {
        const error = await response.json();
        console.error('Sign and pay error:', error);
        throw new Error(error.error || 'Failed to create post');
      }

      const { txid } = await response.json();
      console.log('Transaction broadcasted successfully via API:', txid);

      // Save post metadata to database
      setProgress(95);
      await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: finalContent, // Use finalContent
          txid,
          has_image: Boolean(imagePayload)
        }),
      });

      console.log(`Post data sent to /api/posts for txid: ${txid}`);

      // *** Optimistic Update: Add post to feed cache immediately ***
      try {
        const profileData = await getProfileByUserId(supabase, user.id, {
          fallbackUsername: 'You',
        });
        const newPost = createOptimisticPost({
          txid,
          content: finalContent,
          userId: user.id,
          profile: profileData,
          hasImage: Boolean(imagePayload),
        });

        queryClient.setQueryData<InfiniteData<HydratedPost[], number>>(
          feedQueryKeys.new(),
          (oldData) => prependPostToInfiniteData(oldData, newPost)
        );

        console.log('Optimistically added new post to feed cache:', txid);
      } catch (cacheError) {
        console.warn('Failed to optimistically update cache (post still created):', cacheError);
      }
      // *** End Optimistic Update ***

      toast({ description: "Post created successfully!", duration: 1200 });
      resetState();
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (error) {
      console.error("Error creating post:", error);
      toast({
        variant: "destructive",
        description:
          error instanceof Error ? error.message : "Failed to create post",
      });
    } finally {
      setIsLoading(false);
      setProgress(0);
    }
  };

  // Handle closing the sheet
  const handleSheetClose = (open: boolean) => {
    if (!open) {
      resetState(); // Reset state when sheet closes
      onClose(); // Call the original onClose passed from parent
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={handleSheetClose}>
      <SheetContent
        ref={sheetContentRef}
        side="bottom"
        className="z-[200] mx-auto w-full overflow-hidden rounded-t-2xl border-t border-border/60 bg-background/95 p-6 shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_-20px_50px_-20px_rgba(0,0,0,0.55)] backdrop-blur-xl md:w-1/3"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-amber-400/15 blur-3xl"
        />

        <SheetHeader>
          <SheetTitle className="sr-only">Create post</SheetTitle>
          <SheetDescription className="sr-only">Create a new post. Add content and links.</SheetDescription>
        </SheetHeader>

        <div className="relative space-y-4 pt-6">
          {/* Content Input */}
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 ease-out">
          {isPreview ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none min-h-[200px] max-h-[70vh] overflow-y-auto rounded-xl border border-border/60 bg-background/60 p-3 backdrop-blur transition-colors hover:border-amber-400/40"
              onClick={() => setIsPreview(false)}
            >
              <ReactMarkdown
                remarkPlugins={[remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  a: ({ node, href, children, ...props }) => {
                    if (
                      href &&
                      (TWITTER_PATTERN.test(href) ||
                        YOUTUBE_PATTERN.test(href) ||
                        DEXSCREENER_PATTERN.test(href))
                    ) {
                      return (
                        <a
                          {...props}
                          href={href}
                          className="text-amber-600 hover:underline dark:text-amber-300"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {children}
                        </a>
                      );
                    }

                    if (
                      href &&
                      !href.startsWith("/") &&
                      !href.startsWith("#")
                    ) {
                      return <LinkCard href={href}>{children}</LinkCard>;
                    }

                    return (
                      <a
                        {...props}
                        href={href}
                        className="text-amber-600 hover:underline dark:text-amber-300"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {content
                  .replace(
                    /\[([^\]]*)\]\(https?:\/\/(x|twitter)\.com[^)]*\)/gi,
                    "$1"
                  )
                  .replace(TWITTER_PATTERN, "")

                  .replace(
                    /\[([^\]]*)\]\(https?:\/\/(www\.)?(youtube\.com|youtu\.be)[^)]*\)/gi,
                    "$1"
                  )
                  .replace(YOUTUBE_PATTERN, "")

                  .replace(
                    /\[([^\]]*)\]\(https?:\/\/(www\.)?dexscreener\.com[^)]*\)/gi,
                    "$1"
                  )
                  .replace(DEXSCREENER_PATTERN, "")

                  .trim()}
              </ReactMarkdown>

              {/* Twitter embed handling - Extract from both formats */}
              {(() => {
                const match = content.match(
                  /(?:twitter|x)\.com\/[^/]+\/status\/(\d+)/
                );
                const tweetId = match?.[1];

                // If no valid ID found, don't render
                if (!tweetId) return null;

                // Render the tweet with the ID
                return (
                  <div className={`${tweetEmbedClassName} mt-4`}>
                    <SafeTweet id={tweetId} components={tweetComponents} />
                  </div>
                );
              })()}

              {/* YouTube embed */}
              {Array.from(content.matchAll(YOUTUBE_PATTERN))[0] && (
                <YouTubeEmbed
                  url={
                    Array.from(content.matchAll(YOUTUBE_PATTERN))[0][0].split(
                      "&"
                    )[0]
                  }
                />
              )}

              {/* DexScreener embed */}
              {Array.from(content.matchAll(DEXSCREENER_PATTERN))[0] && (
                <DexScreenerEmbed
                  url={Array.from(content.matchAll(DEXSCREENER_PATTERN))[0][0]}
                />
              )}
            </div>
          ) : (
            <div className="relative">
              <Textarea
                ref={textareaRef}
                placeholder={selectedImage ? "Add a caption…" : "What's happening?"}
                value={content}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setContent(nextValue);
                  if (containsTwitterStatusUrl(nextValue)) {
                    setIsPreview(true);
                  }
                }}
                onPaste={(e) => {
                  const pastedText = e.clipboardData.getData('text');
                  if (containsTwitterStatusUrl(pastedText)) {
                    window.setTimeout(() => {
                      setIsPreview(true);
                    }, 0);
                  }
                }}
                className="min-h-[120px] resize-none relative z-[100] font-sans text-base
                  rounded-xl border border-border/60 bg-background/60 backdrop-blur
                  focus-visible:border-amber-400/60 focus-visible:ring-2 focus-visible:ring-amber-400/30
                  focus-visible:outline-none focus-visible:ring-offset-0
                  transition-all duration-200"
                style={{
                  WebkitAppearance: "none",
                  WebkitTapHighlightColor: "transparent",
                  fontSize: "16px"
                }}
                maxLength={2000}
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>
          )}
          </div>

          <div className="space-y-2">
            <input
              ref={imageInputRef}
              type="file"
              accept={POST_IMAGE_INPUT_ACCEPT}
              className="hidden"
              onChange={handleImageSelect}
              disabled={isLoading || isImageProcessing}
            />

            {selectedImage && (
              <div className="relative overflow-hidden rounded-xl border border-border/60 bg-background/60">
                <div className="relative flex max-h-64 items-center justify-center bg-muted/30 p-2">
                  <Image
                    src={selectedImage.previewUrl}
                    alt="Selected post attachment"
                    width={selectedImage.width}
                    height={selectedImage.height}
                    className="block h-auto max-h-60 w-auto max-w-full rounded-xl ring-1 ring-black/10 drop-shadow-[0_2px_10px_rgba(0,0,0,0.18)]"
                    unoptimized
                  />
                </div>
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="absolute right-2 top-2 rounded-full bg-background/85 p-1 text-foreground shadow backdrop-blur transition hover:bg-background"
                  aria-label="Remove selected image"
                  disabled={isLoading}
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="border-t border-border/60 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {selectedImage.mediaType.replace("image/", "")} · {formatImageSize(selectedImage.size)} / 1 MB
                </div>
              </div>
            )}

            {imageError && (
              <p className="text-sm text-destructive">{imageError}</p>
            )}
          </div>

          <div className="space-y-4">
            {isLoading && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/60">
                <div
                  className="h-full bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 transition-[width] duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsPreview(!isPreview)}
                  className="rounded-full font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300"
                  disabled={!content.trim()}
                >
                  {isPreview ? "Edit" : "Preview"}
                </Button>
                <span className="font-mono tabular-nums text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {content.length}/2000
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => imageInputRef.current?.click()}
                  className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300"
                  disabled={isLoading || isImageProcessing}
                  aria-label="Add image"
                  title="Add image"
                >
                  {isImageProcessing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImagePlus className="h-4 w-4" />
                  )}
                </Button>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handlePost}
                  disabled={isLoading || isImageProcessing || !isWalletReady || (!content.trim() && !selectedImage)}
                  className={cn(
                    "inline-flex min-w-[112px] items-center justify-center gap-2 rounded-full border-2 border-amber-400 bg-inherit px-5 py-2.5 text-sm font-semibold text-foreground transition-colors duration-200 ease-in-out animate-pulse-orange hover:bg-amber-400/10 focus:outline-none focus-visible:border-amber-400 focus-visible:ring-2 focus-visible:ring-amber-400/45 sm:min-w-[170px] sm:px-6",
                    "disabled:pointer-events-none disabled:opacity-60"
                  )}
                >
                  <span className="flex items-center justify-center gap-2">
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <span>Post</span>
                    )}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
