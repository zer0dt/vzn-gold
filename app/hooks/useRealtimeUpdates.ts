'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

const supabase = createClient();

/**
 * Custom hook to subscribe to Supabase realtime Postgres changes (INSERT events).
 *
 * @param tableName The name of the table to listen to.
 * @param schema The database schema (defaults to 'public').
 * @param onNewRecord Callback function triggered when a new record is inserted.
 *                      Receives the 'new' record object from the payload.
 */
type RealtimeInsertPayload<T> = {
  new: T | null;
  [key: string]: unknown;
};

export function useRealtimeUpdates<T extends Record<string, unknown>>(
  tableName: string,
  onNewRecord: (newRecord: T) => void,
  schema: string = 'public'
) {
  const onNewRecordRef = useRef(onNewRecord);

  useEffect(() => {
    onNewRecordRef.current = onNewRecord;
  }, [onNewRecord]);

  useEffect(() => {
    // Keep channel identity stable so we don't churn realtime subscriptions unnecessarily.
    const channelName = `db-${schema}-${tableName}-insert`;
    let channel: RealtimeChannel | null = null;
    const retryTimers: Array<ReturnType<typeof setTimeout>> = [];

    const setupSubscription = () => {
      // Clean up previous channel if it exists
      if (channel) {
        void supabase.removeChannel(channel).catch((err: unknown) => {
          console.error(`[useRealtimeUpdates] removeChannel failed (${tableName})`, err);
        });
      }

      channel = supabase.channel(channelName);

      const handleInsert = (payload: RealtimeInsertPayload<T>) => {
        const newRecord = payload.new;

        if (newRecord) {
          try {
            onNewRecordRef.current(newRecord);
          } catch (error) {
            console.error(`[useRealtimeUpdates - ${tableName}] Error in onNewRecord callback:`, error);
          }
        } else {
          console.warn(`[useRealtimeUpdates - ${tableName}] Received insert payload without 'new' record:`, payload);
        }
      };

      channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: schema,
          table: tableName,
        },
        (payload) =>
          handleInsert(payload as unknown as RealtimeInsertPayload<T>),
      )
        .subscribe((status, err) => {
          if (!channel) return; // Prevent logs if channel was cleaned up before subscribe callback runs

          if (status === 'SUBSCRIBED') {
            return;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            const timer = setTimeout(setupSubscription, 3000);
            retryTimers.push(timer);
            if (process.env.NODE_ENV === 'development') {
              console.warn(`[useRealtimeUpdates] ${status} for ${tableName}. Retrying subscription...`, err);
            }
          }
        });
    };

    // Set up the subscription initially.
    setupSubscription();

    // Cleanup function
    return () => {
      retryTimers.forEach(clearTimeout);
      if (channel) {
        void supabase.removeChannel(channel).catch((err: unknown) => {
          console.error(`[useRealtimeUpdates] removeChannel failed on cleanup (${tableName})`, err);
        });
        channel = null; // Ensure channel is marked as removed
      }
    };
  }, [tableName, schema]);
} 