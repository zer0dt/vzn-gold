'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { PostSkeleton } from './PostSkeleton'
import { useRealtimeUpdates } from '@/app/hooks/useRealtimeUpdates'
import { createClient } from '@/utils/supabase/client'
import { useBlockHeightContext } from '@/app/contexts/BlockHeightContext'
import { getProfileByUserId } from '@/app/lib/supabase/profiles'
import { replyQueryKeys, singlePostQueryKeys } from '@/app/lib/query-keys'
import {
  consumeOptimisticReply,
  fetchPostByTxid,
  syncReplyCountAcrossPostCaches,
  type HydratedPost,
} from '@/app/lib/supabase/posts'
import type { LikeRealtimeSnapshot, Profile, Reply } from '@/types'

type HydratedLike = NonNullable<HydratedPost['likes']>[number]

type ReplyWithProfile = Reply & {
  profile?: Profile | { username: string | null; avatar_url: string | null }
}

const supabase = createClient(); // Initialize Supabase client

const DynamicPost = dynamic<{ post: HydratedPost; blockHeight: number }>(
  () => import('./Post/index').then((mod) => mod.Post),
  { loading: () => <PostSkeleton /> }
)

// The prop type for ClientPost
interface ClientPostProps {
  post: HydratedPost
}

export function ClientPost({ post: initialPost }: ClientPostProps) {
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false)
  const { blockHeight } = useBlockHeightContext()
  const profileCacheRef = useRef<Map<string, Profile>>(new Map())
  const queryClient = useQueryClient()
  const postQueryKey = singlePostQueryKeys.byTxid(initialPost.txid)

  const { data: queryPostData } = useQuery<HydratedPost | null>({
    queryKey: postQueryKey,
    queryFn: async () => {
      const post = await fetchPostByTxid(supabase, initialPost.txid)
      return post
    },
    initialData: initialPost,
    enabled: Boolean(initialPost.txid),
    staleTime: 1000 * 60,
  })
  const postData = queryPostData ?? initialPost

  // Fetch profiles for all likes on initial load
  useEffect(() => {
    async function fetchLikerProfiles() {
      if (!postData?.likes?.length || isLoadingProfiles) return;
      
      setIsLoadingProfiles(true);
      console.log("[ClientPost] Fetching profiles for existing likes on load");
      
      const likesNeedingProfiles = postData.likes.filter(
        (like: HydratedLike) => !like.liker_profile || !like.liker_profile.username,
      );
      
      if (likesNeedingProfiles.length === 0) {
        console.log("[ClientPost] All likes already have profiles");
        setIsLoadingProfiles(false);
        return;
      }
      
      console.log(`[ClientPost] Found ${likesNeedingProfiles.length} likes needing profile data`);
      
      // Create an array of promises to fetch all profiles at once
      const profilePromises = likesNeedingProfiles.map(async (like: HydratedLike) => {
        try {
          return {
            likeId: like.txid,
            profile: await getProfileByUserId(supabase, like.user_id, {
              cache: profileCacheRef.current,
              fallbackUsername: 'Unknown',
            })
          };
        } catch (error) {
          console.error(`[ClientPost] Exception fetching profile for like ${like.txid}:`, error);
          return {
            likeId: like.txid,
            profile: { user_id: like.user_id, username: 'Error', avatar_url: null }
          };
        }
      });
      
      // Wait for all profile fetches to complete
      const profiles = await Promise.all(profilePromises);
      
      // Update the post data with the fetched profiles
      queryClient.setQueryData<HydratedPost | null>(postQueryKey, (currentPost) => {
        if (!currentPost) {
          return currentPost
        }

        const updatedLikes = (currentPost.likes || []).map((like: HydratedLike) => {
          const profileData = profiles.find(p => p.likeId === like.txid);
          if (profileData) {
            return {
              ...like,
              liker_profile: profileData.profile
            };
          }
          return like;
        });
        
        return {
          ...currentPost,
          likes: updatedLikes,
        } as HydratedPost;
      });
      
      console.log("[ClientPost] Updated likes with profile data");
      setIsLoadingProfiles(false);
    }
    
    fetchLikerProfiles();
  }, [isLoadingProfiles, postData?.likes, postQueryKey, queryClient]);

  // Callback function for likes - Make it async
  const handleNewLike = useCallback(async (newLike: LikeRealtimeSnapshot) => {
    console.log('[Realtime] New like received:', newLike)

    // Check if the like belongs to the post currently displayed
    if (initialPost.txid && newLike.post_txid === initialPost.txid) {
      console.log(`[Realtime] Like matches current post (${initialPost.txid}). Updating UI.`)

      // Fetch the liker's profile
      let likerProfile = null;
      try {
        console.log(`[ClientPost Realtime] Fetching profile for user_id: ${newLike.user_id}`);
        likerProfile = await getProfileByUserId(supabase, newLike.user_id, {
          cache: profileCacheRef.current,
          fallbackUsername: 'Unknown',
        });
      } catch (error) {
        console.error(`[ClientPost Realtime] Exception fetching profile for ${newLike.user_id}:`, error);
        likerProfile = { user_id: newLike.user_id, username: 'Unknown', avatar_url: null };
      }

      // Create a properly formatted like object with profile data
      const likeForState = {
        txid: newLike.txid,
        post_txid: newLike.post_txid,
        user_id: newLike.user_id,
        sats_amount: newLike.sats_amount,
        unlock_height: newLike.unlock_height,
        created_at: newLike.created_at,
        liker_profile: likerProfile,
      };

      // Update post data with new like
      queryClient.setQueryData<HydratedPost | null>(postQueryKey, (currentPost) => {
        if (!currentPost) {
          return currentPost
        }

        // Check if this like already exists to avoid duplicates
        const likeExists = currentPost.likes?.some((like: HydratedLike) => like.txid === newLike.txid);
        
        if (likeExists) {
          console.log(`[ClientPost Realtime] Like ${newLike.txid} already exists. Updating with profile info.`);
          
          // Update the existing like with profile info if missing
          return {
            ...currentPost,
            likes: currentPost.likes?.map((like: HydratedLike) =>
              like.txid === newLike.txid
                ? { ...like, liker_profile: like.liker_profile || likerProfile }
                : like,
            ),
          } as HydratedPost;
        } else {
          console.log(`[ClientPost Realtime] Adding new like ${newLike.txid} to post.`);
          return {
            ...currentPost,
            likes: [...(currentPost.likes || []), likeForState as HydratedLike],
          } as HydratedPost;
        }
      });
    } else {
      console.log(`[Realtime] Like for post ${newLike.post_txid}, but current post is ${initialPost.txid}. Ignoring.`);
    }
  }, [initialPost.txid, postQueryKey, queryClient]);

  const handleNewReply = useCallback(async (newReply: Reply) => {
    if (newReply.post_txid !== initialPost.txid) {
      return
    }

    const wasOptimisticReply = consumeOptimisticReply(newReply.txid)
    const replierProfile = await getProfileByUserId(supabase, newReply.user_id, {
      cache: profileCacheRef.current,
      fallbackUsername: 'Anon',
    })

    const enrichedReply = {
      ...newReply,
      profile: replierProfile || { username: null, avatar_url: null },
    }

    let replyWasNew = false

    queryClient.setQueryData<ReplyWithProfile[]>(replyQueryKeys.byPost(newReply.post_txid), (oldData) => {
      const currentReplies = oldData || []
      if (currentReplies.some((reply) => reply.txid === newReply.txid)) {
        return currentReplies
      }

      replyWasNew = true
      return [...currentReplies, enrichedReply]
    })

    if (wasOptimisticReply || !replyWasNew) {
      return
    }

    syncReplyCountAcrossPostCaches(queryClient, newReply.post_txid)
  }, [initialPost.txid, queryClient])

  // Use the hook to subscribe to 'likes' table inserts
  useRealtimeUpdates<LikeRealtimeSnapshot>('likes', handleNewLike);
  useRealtimeUpdates<Reply>('replies', handleNewReply);

  // Pass the potentially updated postData to the dynamically loaded Post component
  return <DynamicPost post={postData} blockHeight={blockHeight} />
}
