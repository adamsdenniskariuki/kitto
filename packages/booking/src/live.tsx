'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@kitto/auth/client';

/**
 * Re-renders the page when a tenant's reservations change, so two front-desk
 * screens never disagree for long. Supabase Realtime applies RLS, so a user
 * only hears about rows they could read anyway. Renders nothing.
 */
export function LiveRefresh({
  tenantId,
  table = 'reservations',
}: {
  tenantId: string;
  table?: string;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const db = createBrowserSupabase();
    const channel = db
      .channel(`kitto:${table}:${tenantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `tenant_id=eq.${tenantId}` },
        () => {
          // A recurring booking inserts many rows at once: refresh once.
          clearTimeout(timer.current);
          timer.current = setTimeout(() => router.refresh(), 300);
        },
      )
      .subscribe();
    return () => {
      clearTimeout(timer.current);
      void db.removeChannel(channel);
    };
  }, [router, table, tenantId]);

  return null;
}
