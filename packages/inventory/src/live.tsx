'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@kitto/auth/client';

/**
 * Re-renders the page when a tenant's rows in `table` change (stock levels by
 * default), so a low-stock list or a kitchen screen stays current. Supabase
 * Realtime applies RLS, so a user only hears about rows they could read
 * anyway. Renders nothing.
 */
export function InventoryLiveRefresh({
  tenantId,
  table = 'stock_levels',
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
          // A purchase or an order moves many rows at once: refresh once.
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
