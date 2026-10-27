'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@kitto/auth/client';
import { formatMoney, toMinorUnits } from '@kitto/core';
import { Button, TextField } from '@kitto/ui';
import { documentTotals, lineAmounts, percentToBp } from './math';
import type { RawLine } from './schemas';

type Row = RawLine & { key: number };

const blank = (key: number): Row => ({
  key,
  description: '',
  quantity: '1',
  unitPrice: '',
  taxRate: '0',
});

/**
 * Line items for the draft form. Posts repeated fields (lineDescription,
 * lineQuantity, linePrice, lineTax) that linesFromForm() zips back together,
 * and previews totals with the same rounding as the database.
 */
export function LineItemsEditor({
  initial,
  currency,
  locale,
  defaultTaxRate = '0',
}: {
  initial: RawLine[];
  currency: string;
  locale: string;
  defaultTaxRate?: string;
}) {
  const nextKey = useRef(initial.length + 1);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.length > 0
      ? initial.map((r, i) => ({ ...r, key: i + 1 }))
      : [{ ...blank(0), taxRate: defaultTaxRate }],
  );
  const money = (minor: number) => formatMoney(minor, { currency, locale });
  const amounts = (r: Row) => {
    const price = Number(r.unitPrice.replace(/,/g, ''));
    return {
      quantity: r.quantity.trim() || '1',
      unitPriceMinor: Number.isFinite(price) && price >= 0 ? toMinorUnits(price, currency) : 0,
      taxRateBp: percentToBp(r.taxRate.trim()) ?? 0,
    };
  };
  const totals = documentTotals(rows.map(amounts));
  const update = (key: number, patch: Partial<RawLine>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <fieldset className="space-y-3">
      <legend className="label">Lines</legend>
      <ol className="space-y-3">
        {rows.map((r, i) => {
          const n = i + 1;
          const id = (f: string) => `f-line-${n}-${f}`;
          return (
            <li
              key={r.key}
              className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_5rem_8rem_5rem_auto] sm:items-end"
            >
              <TextField
                id={id('description')}
                label={`Line ${n} description`}
                name="lineDescription"
                maxLength={500}
                autoComplete="off"
                value={r.description}
                onChange={(e) => update(r.key, { description: e.target.value })}
              />
              <TextField
                id={id('quantity')}
                label={`Line ${n} quantity`}
                name="lineQuantity"
                inputMode="decimal"
                autoComplete="off"
                value={r.quantity}
                onChange={(e) => update(r.key, { quantity: e.target.value })}
              />
              <TextField
                id={id('price')}
                label={`Line ${n} unit price (${currency})`}
                name="linePrice"
                inputMode="decimal"
                autoComplete="off"
                value={r.unitPrice}
                onChange={(e) => update(r.key, { unitPrice: e.target.value })}
              />
              <TextField
                id={id('tax')}
                label={`Line ${n} tax %`}
                name="lineTax"
                inputMode="decimal"
                autoComplete="off"
                value={r.taxRate}
                onChange={(e) => update(r.key, { taxRate: e.target.value })}
              />
              <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                <span className="text-sm tabular-nums">
                  {money(lineAmounts(amounts(r)).totalMinor)}
                </span>
                {rows.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  >
                    Remove<span className="sr-only"> line {n}</span>
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {rows.length < 100 && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            setRows((rs) => [...rs, { ...blank(nextKey.current++), taxRate: defaultTaxRate }])
          }
        >
          Add line
        </Button>
      )}
      <dl className="ml-auto grid max-w-xs grid-cols-2 gap-x-6 gap-y-1 text-sm" aria-live="polite">
        <dt className="text-muted">Subtotal</dt>
        <dd className="text-right tabular-nums">{money(totals.subtotalMinor)}</dd>
        <dt className="text-muted">Tax</dt>
        <dd className="text-right tabular-nums">{money(totals.taxMinor)}</dd>
        <dt className="font-semibold">Total</dt>
        <dd className="text-right font-semibold tabular-nums">{money(totals.totalMinor)}</dd>
      </dl>
    </fieldset>
  );
}

/**
 * Re-renders the page when a tenant's rows in `table` change (e.g. a payment
 * arriving from an M-Pesa callback). Realtime applies RLS. Renders nothing.
 */
export function BillingLiveRefresh({ tenantId, table }: { tenantId: string; table: string }) {
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
