import { KittoError, unwrap, type KittoClient, type Tables } from '@kitto/core';
import type { CustomerInput } from './schemas';

export type Customer = Tables<'customers'>;
export type CustomerNote = Tables<'customer_notes'>;

export interface CustomerQuery {
  /** Matches name, phone or email (case-insensitive substring). */
  q?: string | undefined;
  tag?: string | undefined;
  includeArchived?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/** Strip characters that have meaning inside a PostgREST or=() filter. */
export function searchTerm(q: string): string {
  return q
    .replace(/[,()*%\\:"]/g, ' ')
    .trim()
    .slice(0, 100);
}

export async function listCustomers(
  db: KittoClient,
  tenantId: string,
  query: CustomerQuery = {},
): Promise<{ rows: Customer[]; count: number }> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  let req = db
    .from('customers')
    .select('*', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('name')
    .range(offset, offset + limit - 1);
  if (!query.includeArchived) req = req.is('archived_at', null);
  if (query.tag) req = req.contains('tags', [query.tag.toLowerCase()]);
  const term = query.q ? searchTerm(query.q) : '';
  if (term) {
    const digits = term.replace(/[^0-9]/g, '');
    const filters = [`name.ilike.*${term}*`, `email.ilike.*${term}*`];
    // "0712 345" should find +254712345678: match on the trailing digits.
    if (digits.length >= 3) filters.push(`phone.ilike.*${digits.replace(/^0/, '')}*`);
    req = req.or(filters.join(','));
  }
  const res = await req;
  if (res.error) throw new KittoError(res.error.message, res.error.code);
  return { rows: res.data, count: res.count ?? res.data.length };
}

/** Active customers as select options (for booking, orders, invoices). */
export async function customerOptions(
  db: KittoClient,
  tenantId: string,
): Promise<{ value: string; label: string }[]> {
  const rows = unwrap(
    await db
      .from('customers')
      .select('id, name, phone')
      .eq('tenant_id', tenantId)
      .is('archived_at', null)
      .order('name')
      .limit(500),
  );
  return rows.map((c) => ({ value: c.id, label: c.phone ? `${c.name} (${c.phone})` : c.name }));
}

export async function getCustomer(db: KittoClient, id: string): Promise<Customer | null> {
  const res = await db.from('customers').select('*').eq('id', id).maybeSingle();
  if (res.error) throw new KittoError(res.error.message, res.error.code);
  return res.data;
}

export async function createCustomer(
  db: KittoClient,
  tenantId: string,
  input: CustomerInput,
): Promise<Customer> {
  return unwrap(
    await db
      .from('customers')
      .insert({ tenant_id: tenantId, ...input })
      .select()
      .single(),
  );
}

export async function updateCustomer(
  db: KittoClient,
  id: string,
  input: CustomerInput,
): Promise<Customer> {
  return unwrap(await db.from('customers').update(input).eq('id', id).select().single());
}

export async function setCustomerArchived(
  db: KittoClient,
  id: string,
  archived: boolean,
): Promise<Customer> {
  return unwrap(
    await db
      .from('customers')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', id)
      .select()
      .single(),
  );
}

/**
 * Delete a customer with no history. RLS hides rows the user may not delete,
 * so "nothing deleted" means permission denied; references (reservations,
 * invoices...) raise 23503 and the caller should archive instead.
 */
export async function deleteCustomer(db: KittoClient, id: string): Promise<void> {
  const rows = unwrap(await db.from('customers').delete().eq('id', id).select('id'));
  if (rows.length === 0) throw new KittoError('Permission denied', '42501');
}

export async function listCustomerNotes(
  db: KittoClient,
  customerId: string,
): Promise<CustomerNote[]> {
  return unwrap(
    await db
      .from('customer_notes')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false }),
  );
}

export async function addCustomerNote(
  db: KittoClient,
  tenantId: string,
  customerId: string,
  body: string,
): Promise<CustomerNote> {
  return unwrap(
    await db
      .from('customer_notes')
      .insert({ tenant_id: tenantId, customer_id: customerId, body })
      .select()
      .single(),
  );
}

export async function deleteCustomerNote(db: KittoClient, id: string): Promise<void> {
  const rows = unwrap(await db.from('customer_notes').delete().eq('id', id).select('id'));
  if (rows.length === 0) throw new KittoError('Permission denied', '42501');
}
