import { KittoError, unwrap, type KittoClient, type Tables } from '@kitto/core';
import type { OpeningHoursInput, ReservationFormInput } from './schemas';
import type { ReservationStatus } from './status';

export type Resource = Tables<'resources'>;
export type ResourceHours = Tables<'resource_hours'>;
export type Reservation = Tables<'reservations'>;

/** A reservation with what it books and who for, as the pages show it. */
export type ReservationRow = Reservation & {
  resource: Pick<Resource, 'id' | 'name' | 'kind'> | null;
  customer: { id: string; name: string; phone: string | null } | null;
};

const RESERVATION_SELECT =
  '*, resource:resources(id, name, kind), customer:customers(id, name, phone)' as const;

// -------------------------------------------------------------- resources

export async function listResources(
  db: KittoClient,
  tenantId: string,
  opts: { kind?: string | undefined; activeOnly?: boolean } = {},
): Promise<Resource[]> {
  let req = db.from('resources').select('*').eq('tenant_id', tenantId);
  if (opts.kind) req = req.eq('kind', opts.kind);
  if (opts.activeOnly) req = req.eq('active', true);
  return unwrap(await req.order('position').order('name'));
}

export async function getResource(db: KittoClient, id: string): Promise<Resource | null> {
  const res = await db.from('resources').select('*').eq('id', id).maybeSingle();
  if (res.error) throw new KittoError(res.error.message, res.error.code);
  return res.data;
}

export interface ResourceInput {
  kind: string;
  name: string;
  description: string;
  capacity: number;
  rateMinor: number;
  rateUnit: string;
  active: boolean;
}

const resourceRow = (r: ResourceInput) => ({
  kind: r.kind,
  name: r.name,
  description: r.description,
  capacity: r.capacity,
  rate_minor: r.rateMinor,
  rate_unit: r.rateUnit,
  active: r.active,
});

export async function createResource(
  db: KittoClient,
  tenantId: string,
  input: ResourceInput,
): Promise<Resource> {
  return unwrap(
    await db
      .from('resources')
      .insert({ tenant_id: tenantId, ...resourceRow(input) })
      .select()
      .single(),
  );
}

export async function updateResource(
  db: KittoClient,
  id: string,
  input: ResourceInput,
): Promise<Resource> {
  return unwrap(
    await db.from('resources').update(resourceRow(input)).eq('id', id).select().single(),
  );
}

/** Delete a resource that was never booked (23503 otherwise: deactivate it instead). */
export async function deleteResource(db: KittoClient, id: string): Promise<void> {
  const rows = unwrap(await db.from('resources').delete().eq('id', id).select('id'));
  if (rows.length === 0) throw new KittoError('Permission denied', '42501');
}

export async function listResourceHours(
  db: KittoClient,
  resourceId: string,
): Promise<ResourceHours[]> {
  return unwrap(
    await db
      .from('resource_hours')
      .select('*')
      .eq('resource_id', resourceId)
      .order('weekday')
      .order('opens'),
  );
}

export async function addResourceHours(
  db: KittoClient,
  tenantId: string,
  resourceId: string,
  hours: OpeningHoursInput,
): Promise<void> {
  unwrap(
    await db
      .from('resource_hours')
      .insert({ tenant_id: tenantId, resource_id: resourceId, ...hours })
      .select('id'),
  );
}

export async function deleteResourceHours(db: KittoClient, id: string): Promise<void> {
  const rows = unwrap(await db.from('resource_hours').delete().eq('id', id).select('id'));
  if (rows.length === 0) throw new KittoError('Permission denied', '42501');
}

// ----------------------------------------------------------- reservations

export interface ReservationQuery {
  /** Overlapping [from, to): ISO instants. */
  from?: string | undefined;
  to?: string | undefined;
  resourceId?: string | undefined;
  customerId?: string | undefined;
  statuses?: readonly ReservationStatus[] | undefined;
  limit?: number | undefined;
  ascending?: boolean | undefined;
}

export async function listReservations(
  db: KittoClient,
  tenantId: string,
  q: ReservationQuery = {},
): Promise<ReservationRow[]> {
  let req = db.from('reservations').select(RESERVATION_SELECT).eq('tenant_id', tenantId);
  // Overlap test on the generated columns: starts before the window ends, ends after it starts.
  if (q.to) req = req.lt('starts_at', q.to);
  if (q.from) req = req.gt('ends_at', q.from);
  if (q.resourceId) req = req.eq('resource_id', q.resourceId);
  if (q.customerId) req = req.eq('customer_id', q.customerId);
  if (q.statuses?.length) req = req.in('status', [...q.statuses]);
  const rows = unwrap(
    await req.order('starts_at', { ascending: q.ascending ?? true }).limit(q.limit ?? 500),
  );
  return rows as ReservationRow[];
}

export async function getReservation(db: KittoClient, id: string): Promise<ReservationRow | null> {
  const res = await db.from('reservations').select(RESERVATION_SELECT).eq('id', id).maybeSingle();
  if (res.error) throw new KittoError(res.error.message, res.error.code);
  return res.data as ReservationRow | null;
}

/** Book a resource. Raises 23P01 (conflict) if the time is taken. */
export async function createReservation(
  db: KittoClient,
  input: Omit<ReservationFormInput, 'repeat' | 'occurrences'>,
): Promise<Reservation> {
  return unwrap(
    await db
      .rpc('create_reservation', {
        p_resource_id: input.resourceId,
        p_starts_local: input.start,
        p_ends_local: input.end,
        ...(input.customerId ? { p_customer_id: input.customerId } : {}),
        p_guests: input.guests,
        p_title: input.title,
        p_notes: input.notes,
        p_status: input.status,
      })
      .single(),
  ) as Reservation;
}

/** Book the same slot `occurrences` times, `every` apart; all or nothing. */
export async function createRecurringReservations(
  db: KittoClient,
  input: {
    resourceId: string;
    start: string;
    durationMinutes: number;
    every: '1 day' | '1 week';
    occurrences: number;
    customerId: string | null;
    guests: number;
    title: string;
    notes: string;
  },
): Promise<Reservation[]> {
  return unwrap(
    await db.rpc('create_recurring_reservations', {
      p_resource_id: input.resourceId,
      p_starts_local: input.start,
      p_duration_minutes: input.durationMinutes,
      p_every: input.every,
      p_occurrences: input.occurrences,
      ...(input.customerId ? { p_customer_id: input.customerId } : {}),
      p_guests: input.guests,
      p_title: input.title,
      p_notes: input.notes,
    }),
  ) as Reservation[];
}

export async function setReservationStatus(
  db: KittoClient,
  id: string,
  status: ReservationStatus,
): Promise<Reservation> {
  return unwrap(await db.from('reservations').update({ status }).eq('id', id).select().single());
}

export async function updateReservationDetails(
  db: KittoClient,
  id: string,
  input: { title: string; notes: string; guests: number; customerId: string | null },
): Promise<Reservation> {
  return unwrap(
    await db
      .from('reservations')
      .update({
        title: input.title,
        notes: input.notes,
        guests: input.guests,
        customer_id: input.customerId,
      })
      .eq('id', id)
      .select()
      .single(),
  );
}

/** Move a reservation to new absolute times (ISO strings). */
export async function rescheduleReservation(
  db: KittoClient,
  id: string,
  startsAt: string,
  endsAt: string,
): Promise<Reservation> {
  return unwrap(
    await db
      .from('reservations')
      .update({ during: `[${startsAt},${endsAt})` })
      .eq('id', id)
      .select()
      .single(),
  );
}

// ----------------------------------------------------------- availability

export async function availableSlots(
  db: KittoClient,
  resourceId: string,
  day: string,
  durationMinutes: number,
  stepMinutes = 30,
): Promise<{ starts_at: string; ends_at: string }[]> {
  return unwrap(
    await db.rpc('available_slots', {
      p_resource_id: resourceId,
      p_day: day,
      p_duration_minutes: durationMinutes,
      p_step_minutes: stepMinutes,
    }),
  );
}

export async function availableResources(
  db: KittoClient,
  tenantId: string,
  startLocal: string,
  endLocal: string,
  opts: { kind?: string | undefined; guests?: number | undefined } = {},
): Promise<Resource[]> {
  return unwrap(
    await db.rpc('available_resources', {
      p_tenant_id: tenantId,
      p_starts_local: startLocal,
      p_ends_local: endLocal,
      ...(opts.kind ? { p_kind: opts.kind } : {}),
      p_guests: opts.guests ?? 1,
    }),
  ) as Resource[];
}
