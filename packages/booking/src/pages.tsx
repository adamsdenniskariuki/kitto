import 'server-only';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  addDays,
  flashMessages,
  formatDate,
  fromMinorUnits,
  isLocalDateTime,
  todayIn,
  utcToZonedLocal,
  zonedTimeToUtc,
} from '@kitto/core';
import {
  param,
  requirePermission,
  type TenantContext,
  type TenantPageProps,
} from '@kitto/auth/server';
import { CUSTOMER_PERMISSIONS, customerOptions } from '@kitto/customers';
import {
  Badge,
  Card,
  Checkbox,
  DataTable,
  DateTime,
  EmptyState,
  Flash,
  Money,
  PageHeader,
  SectionHeading,
  SelectField,
  TenantField,
  TextField,
  TextareaField,
  buttonClass,
} from '@kitto/ui';
import { ConfirmSubmit, SubmitButton } from '@kitto/ui/client';
import {
  addResourceHoursAction,
  createReservationAction,
  createResourceAction,
  deleteResourceAction,
  deleteResourceHoursAction,
  setReservationStatusAction,
  updateReservationAction,
  updateResourceAction,
} from './actions';
import {
  availableSlots,
  getReservation,
  getResource,
  listReservations,
  listResourceHours,
  listResources,
  type ReservationRow,
  type Resource,
} from './data';
import { LiveRefresh } from './live';
import { BOOKING_PERMISSIONS as P } from './permissions';
import { addLocalMinutes } from './schemas';
import { BOOKING_ERRORS, BOOKING_NOTICES } from './shared';
import {
  isReservationStatus,
  RATE_UNIT_LABELS,
  RATE_UNITS,
  STATUS_ACTIONS,
  STATUS_LABELS,
  STATUS_TONES,
  STATUS_TRANSITIONS,
  WEEKDAYS,
  type ReservationStatus,
} from './status';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DURATIONS = [30, 60, 90, 120, 180, 240];

function flash(searchParams: TenantPageProps['searchParams']) {
  return <Flash {...flashMessages(searchParams, BOOKING_NOTICES, BOOKING_ERRORS)} />;
}

function StatusBadge({ status }: { status: string }) {
  return isReservationStatus(status) ? (
    <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
  ) : (
    <Badge>{status}</Badge>
  );
}

const time = (value: string | null, ctx: TenantContext) =>
  value ? formatDate(value, ctx.tenant, { timeStyle: 'short' }) : '';

/** "Mon 3 Mar 14:00 – 15:30", dropping the second date when it's the same day. */
function When({ r, ctx }: { r: ReservationRow; ctx: TenantContext }) {
  if (!r.starts_at || !r.ends_at) return null;
  const tz = ctx.tenant.timezone;
  const sameDay =
    utcToZonedLocal(r.starts_at, tz).slice(0, 10) === utcToZonedLocal(r.ends_at, tz).slice(0, 10);
  const day = (v: string) =>
    formatDate(v, ctx.tenant, { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <>
      <time dateTime={r.starts_at}>
        {day(r.starts_at)} {time(r.starts_at, ctx)}
      </time>
      {' – '}
      <time dateTime={r.ends_at}>
        {sameDay ? '' : `${day(r.ends_at)} `}
        {time(r.ends_at, ctx)}
      </time>
    </>
  );
}

function bookingsHeader(
  ctx: TenantContext,
  title: string,
  description?: string,
  actions?: ReactNode,
) {
  return (
    <PageHeader
      eyebrow={
        title === 'Bookings' ? undefined : (
          <Link href={ctx.path('/bookings')} className="hover:underline">
            Bookings
          </Link>
        )
      }
      title={title}
      description={description}
      actions={actions}
    />
  );
}

// ---------------------------------------------------------------- agenda

/** A week of reservations from ?day= (default today), grouped by local day. */
export async function BookingsPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.view);
  const tz = ctx.tenant.timezone;
  const today = todayIn(tz);
  const dayParam = param(searchParams, 'day');
  const from = DAY.test(dayParam) ? dayParam : today;
  const resourceParam = param(searchParams, 'resource');
  const resourceId = UUID.test(resourceParam) ? resourceParam : undefined;
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));

  const [resources, reservations] = await Promise.all([
    listResources(ctx.db, ctx.tenant.id),
    listReservations(ctx.db, ctx.tenant.id, {
      from: zonedTimeToUtc(`${from}T00:00`, tz).toISOString(),
      to: zonedTimeToUtc(`${addDays(from, 7)}T00:00`, tz).toISOString(),
      resourceId,
    }),
  ]);

  // Each reservation is listed on its first day in the window.
  const byDay = new Map<string, ReservationRow[]>(days.map((d) => [d, []]));
  for (const r of reservations) {
    const local = utcToZonedLocal(r.starts_at!, tz).slice(0, 10);
    byDay.get(local < from ? from : local)?.push(r);
  }
  const weekHref = (day: string) =>
    ctx.path(
      `/bookings?${new URLSearchParams({ day, ...(resourceId && { resource: resourceId }) })}`,
    );
  const dayLabel = (d: string) =>
    formatDate(zonedTimeToUtc(`${d}T12:00`, tz), ctx.tenant, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

  return (
    <>
      <LiveRefresh tenantId={ctx.tenant.id} />
      {bookingsHeader(
        ctx,
        'Bookings',
        'Reservations for the week. The list updates as colleagues book.',
        <>
          {ctx.can(P.configure) && (
            <Link href={ctx.path('/bookings/resources')} className={buttonClass('secondary')}>
              Resources
            </Link>
          )}
          {ctx.can(P.create) && resources.length > 0 && (
            <Link href={ctx.path('/bookings/new')} className={buttonClass()}>
              New reservation
            </Link>
          )}
        </>,
      )}
      {flash(searchParams)}

      <form className="mb-6 flex flex-wrap items-end gap-3" action={ctx.path('/bookings')}>
        <TextField
          label="Week from"
          name="day"
          type="date"
          defaultValue={from}
          wrapperClassName="basis-40"
        />
        <SelectField
          label="Resource"
          name="resource"
          placeholder="All resources"
          options={resources.map((r) => ({ value: r.id, label: r.name }))}
          defaultValue={resourceId ?? ''}
          wrapperClassName="min-w-0 flex-1 basis-48"
        />
        <button type="submit" className={buttonClass('secondary')}>
          Show
        </button>
      </form>
      <nav aria-label="Weeks" className="mb-6 flex flex-wrap gap-2">
        <Link href={weekHref(addDays(from, -7))} className={buttonClass('ghost', 'sm')}>
          ← Previous week
        </Link>
        {from !== today && (
          <Link href={weekHref(today)} className={buttonClass('ghost', 'sm')}>
            Today
          </Link>
        )}
        <Link href={weekHref(addDays(from, 7))} className={buttonClass('ghost', 'sm')}>
          Next week →
        </Link>
      </nav>

      {resources.length === 0 ? (
        <EmptyState
          title="Nothing to book yet"
          action={
            ctx.can(P.configure) && (
              <Link href={ctx.path('/bookings/resources')} className={buttonClass()}>
                Add a resource
              </Link>
            )
          }
        >
          Add rooms, tables, vehicles or anything else people reserve.
        </EmptyState>
      ) : (
        <ol className="space-y-6">
          {days.map((d) => {
            const rows = byDay.get(d)!;
            const headingId = `day-${d}`;
            return (
              <li key={d}>
                <Card aria-labelledby={headingId}>
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <SectionHeading id={headingId}>
                      {dayLabel(d)} {d === today && <Badge tone="brand">Today</Badge>}
                    </SectionHeading>
                    {ctx.can(P.create) && (
                      <Link
                        href={ctx.path(
                          `/bookings/new?${new URLSearchParams({ day: d, ...(resourceId && { resource: resourceId }) })}`,
                        )}
                        className="text-sm underline-offset-2 hover:underline"
                      >
                        Book<span className="sr-only"> on {dayLabel(d)}</span>
                      </Link>
                    )}
                  </div>
                  {rows.length === 0 ? (
                    <p className="text-sm text-muted">No reservations.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {rows.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                          <Link
                            href={ctx.path(`/bookings/${r.id}`)}
                            className="font-medium underline-offset-2 hover:underline"
                          >
                            {r.resource?.name ?? 'Resource'}
                            {r.title ? ` · ${r.title}` : ''}
                          </Link>
                          <span className="text-sm text-muted">
                            <When r={r} ctx={ctx} />
                          </span>
                          {r.customer && <span className="text-sm">{r.customer.name}</span>}
                          <StatusBadge status={r.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

// ------------------------------------------------------- new reservation

/**
 * Two forms: a GET form picks the resource, day and length and lists the free
 * slots; each slot is a link that prefills the booking form below it.
 */
export async function NewReservationPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.create);
  const tz = ctx.tenant.timezone;
  const resources = await listResources(ctx.db, ctx.tenant.id, { activeOnly: true });
  const resourceParam = param(searchParams, 'resource');
  const resource = resources.find((r) => r.id === resourceParam) ?? resources[0];
  const dayParam = param(searchParams, 'day');
  const day = DAY.test(dayParam) ? dayParam : todayIn(tz);
  const duration = DURATIONS.includes(Number(param(searchParams, 'duration')))
    ? Number(param(searchParams, 'duration'))
    : 60;
  const startParam = param(searchParams, 'start');
  const start =
    isLocalDateTime(startParam) && startParam.length >= 16 ? startParam.slice(0, 16) : '';
  const customerParam = param(searchParams, 'customer');

  const [slots, customers] = await Promise.all([
    resource ? availableSlots(ctx.db, resource.id, day, duration) : Promise.resolve([]),
    ctx.can(CUSTOMER_PERMISSIONS.view)
      ? customerOptions(ctx.db, ctx.tenant.id)
      : Promise.resolve([]),
  ]);
  const slotHref = (localStart: string) =>
    ctx.path(
      `/bookings/new?${new URLSearchParams({
        resource: resource!.id,
        day,
        duration: String(duration),
        start: localStart,
        ...(customerParam && { customer: customerParam }),
      })}`,
    );

  if (!resource) {
    return (
      <>
        {bookingsHeader(ctx, 'New reservation')}
        <EmptyState title="Nothing to book yet">
          Add an active resource first, under Bookings → Resources.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      {bookingsHeader(ctx, 'New reservation')}
      {flash(searchParams)}
      <div className="grid gap-8 lg:grid-cols-2">
        <Card aria-labelledby="slots-heading">
          <SectionHeading id="slots-heading">Find a free time</SectionHeading>
          <form className="mb-4 grid gap-3 sm:grid-cols-2" action={ctx.path('/bookings/new')}>
            <SelectField
              label="Resource"
              name="resource"
              id="find-resource"
              options={resources.map((r) => ({ value: r.id, label: `${r.name} (${r.kind})` }))}
              defaultValue={resource.id}
              wrapperClassName="sm:col-span-2"
            />
            <TextField label="Day" name="day" type="date" defaultValue={day} />
            <SelectField
              label="Length"
              name="duration"
              options={DURATIONS.map((m) => ({
                value: String(m),
                label: m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`,
              }))}
              defaultValue={String(duration)}
            />
            {customerParam && <input type="hidden" name="customer" value={customerParam} />}
            <button type="submit" className={buttonClass('secondary')}>
              Show free times
            </button>
          </form>
          {slots.length === 0 ? (
            <p className="text-sm text-muted">
              No free {duration}-minute slots for {resource.name} on that day.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label={`Free times for ${resource.name}`}>
              {slots.map((s) => {
                const local = utcToZonedLocal(s.starts_at, tz);
                return (
                  <li key={s.starts_at}>
                    <Link
                      href={slotHref(local)}
                      className={buttonClass(local === start ? 'primary' : 'secondary', 'sm')}
                      aria-current={local === start ? 'true' : undefined}
                    >
                      {local.slice(11, 16)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card aria-labelledby="book-heading">
          <SectionHeading id="book-heading">Reservation</SectionHeading>
          <form action={createReservationAction} className="space-y-4">
            <TenantField slug={ctx.tenant.slug} />
            <SelectField
              label="Resource"
              name="resourceId"
              options={resources.map((r) => ({ value: r.id, label: r.name }))}
              defaultValue={resource.id}
              required
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Starts"
                name="start"
                type="datetime-local"
                required
                defaultValue={start || `${day}T09:00`}
              />
              <TextField
                label="Ends"
                name="end"
                type="datetime-local"
                required
                defaultValue={addLocalMinutes(start || `${day}T09:00`, duration)}
              />
            </div>
            {customers.length > 0 && (
              <SelectField
                label="Customer"
                name="customerId"
                placeholder="No customer"
                options={customers}
                defaultValue={customers.some((c) => c.value === customerParam) ? customerParam : ''}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Guests"
                name="guests"
                type="number"
                inputMode="numeric"
                min={1}
                max={resource.capacity}
                defaultValue="1"
                hint={`${resource.name} holds ${resource.capacity}`}
              />
              <SelectField
                label="Status"
                name="status"
                options={[
                  { value: 'confirmed', label: 'Confirmed' },
                  { value: 'tentative', label: 'Tentative (hold)' },
                ]}
                defaultValue="confirmed"
              />
            </div>
            <TextField
              label="Title"
              name="title"
              maxLength={200}
              autoComplete="off"
              hint="Optional, e.g. Birthday dinner"
            />
            <TextareaField label="Notes" name="notes" rows={2} maxLength={2000} />
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-medium">Repeat</legend>
              <SelectField
                label="Repeats"
                name="repeat"
                options={[
                  { value: '', label: 'Does not repeat' },
                  { value: 'daily', label: 'Every day' },
                  { value: 'weekly', label: 'Every week' },
                ]}
                defaultValue=""
              />
              <TextField
                label="Times"
                name="occurrences"
                type="number"
                inputMode="numeric"
                min={2}
                max={52}
                hint="All are booked or none are"
              />
            </fieldset>
            <SubmitButton pendingLabel="Booking…">Book</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}

// --------------------------------------------------- reservation detail

export async function ReservationDetailPage({
  ctx,
  searchParams,
  reservationId,
}: TenantPageProps & { reservationId: string }) {
  requirePermission(ctx, P.view);
  if (!UUID.test(reservationId)) notFound();
  const r = await getReservation(ctx.db, reservationId);
  if (!r || r.tenant_id !== ctx.tenant.id) notFound();
  const canManage = ctx.can(P.manage);
  const next = isReservationStatus(r.status) ? STATUS_TRANSITIONS[r.status] : [];
  const customers =
    canManage && ctx.can(CUSTOMER_PERMISSIONS.view)
      ? await customerOptions(ctx.db, ctx.tenant.id)
      : [];
  // Keep the current customer selectable even if they've since been archived.
  if (r.customer && !customers.some((c) => c.value === r.customer!.id)) {
    customers.unshift({ value: r.customer.id, label: r.customer.name });
  }

  return (
    <>
      <LiveRefresh tenantId={ctx.tenant.id} />
      {bookingsHeader(ctx, `${r.resource?.name ?? 'Reservation'}${r.title ? ` · ${r.title}` : ''}`)}
      {flash(searchParams)}
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-8">
          <Card aria-labelledby="summary-heading">
            <SectionHeading id="summary-heading">Summary</SectionHeading>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-muted">Status</dt>
              <dd>
                <StatusBadge status={r.status} />
              </dd>
              <dt className="text-muted">When</dt>
              <dd>
                <When r={r} ctx={ctx} />
              </dd>
              <dt className="text-muted">Resource</dt>
              <dd>
                {ctx.can(P.configure) && r.resource ? (
                  <Link
                    href={ctx.path(`/bookings/resources/${r.resource.id}`)}
                    className="underline"
                  >
                    {r.resource.name}
                  </Link>
                ) : (
                  r.resource?.name
                )}
              </dd>
              <dt className="text-muted">Customer</dt>
              <dd>
                {r.customer ? (
                  ctx.can(CUSTOMER_PERMISSIONS.view) ? (
                    <Link href={ctx.path(`/customers/${r.customer.id}`)} className="underline">
                      {r.customer.name}
                    </Link>
                  ) : (
                    r.customer.name
                  )
                ) : (
                  '—'
                )}
              </dd>
              <dt className="text-muted">Guests</dt>
              <dd>{r.guests}</dd>
              <dt className="text-muted">Price</dt>
              <dd>
                <Money minor={r.price_minor} tenant={ctx.tenant} />
              </dd>
              {r.series_id && (
                <>
                  <dt className="text-muted">Series</dt>
                  <dd>Part of a recurring booking</dd>
                </>
              )}
              <dt className="text-muted">Booked</dt>
              <dd>
                <DateTime value={r.created_at} tenant={ctx.tenant} />
              </dd>
            </dl>
          </Card>

          <Card aria-labelledby="details-heading">
            <SectionHeading id="details-heading">Details</SectionHeading>
            <form action={updateReservationAction} className="space-y-4">
              <TenantField slug={ctx.tenant.slug} />
              <input type="hidden" name="reservationId" value={r.id} />
              <fieldset disabled={!canManage} className="space-y-4">
                <TextField
                  label="Title"
                  name="title"
                  maxLength={200}
                  defaultValue={r.title}
                  autoComplete="off"
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Guests"
                    name="guests"
                    type="number"
                    min={1}
                    defaultValue={String(r.guests)}
                  />
                  {customers.length > 0 && (
                    <SelectField
                      label="Customer"
                      name="customerId"
                      placeholder="No customer"
                      options={customers}
                      defaultValue={r.customer_id ?? ''}
                    />
                  )}
                </div>
                {customers.length === 0 && (
                  <input type="hidden" name="customerId" value={r.customer_id ?? ''} />
                )}
                <TextareaField
                  label="Notes"
                  name="notes"
                  rows={3}
                  maxLength={2000}
                  defaultValue={r.notes}
                />
              </fieldset>
              {canManage && <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>}
            </form>
          </Card>
        </div>

        {canManage && next.length > 0 && (
          <Card aria-labelledby="status-heading">
            <SectionHeading id="status-heading">Status</SectionHeading>
            <div className="flex flex-wrap gap-3">
              {next.map((s: ReservationStatus) => (
                <form key={s} action={setReservationStatusAction}>
                  <TenantField slug={ctx.tenant.slug} />
                  <input type="hidden" name="reservationId" value={r.id} />
                  <input type="hidden" name="status" value={s} />
                  {s === 'cancelled' || s === 'no_show' ? (
                    <ConfirmSubmit message={`${STATUS_ACTIONS[s]}? This cannot be undone.`}>
                      {STATUS_ACTIONS[s]}
                    </ConfirmSubmit>
                  ) : (
                    <SubmitButton size="sm" variant={s === next[0] ? 'primary' : 'secondary'}>
                      {STATUS_ACTIONS[s]}
                    </SubmitButton>
                  )}
                </form>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------- resources

function ResourceFields({ resource, ctx }: { resource?: Resource; ctx: TenantContext }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          name="name"
          required
          maxLength={120}
          autoComplete="off"
          defaultValue={resource?.name}
        />
        <TextField
          label="Kind"
          name="kind"
          maxLength={40}
          autoComplete="off"
          hint="e.g. room, table, vehicle"
          defaultValue={resource?.kind ?? 'room'}
        />
      </div>
      <TextareaField
        label="Description"
        name="description"
        rows={2}
        maxLength={1000}
        defaultValue={resource?.description}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Capacity"
          name="capacity"
          type="number"
          inputMode="numeric"
          min={1}
          max={10000}
          required
          defaultValue={String(resource?.capacity ?? 1)}
        />
        <TextField
          label={`Rate (${ctx.tenant.currency})`}
          name="rate"
          inputMode="decimal"
          autoComplete="off"
          pattern="[0-9,]+(\.[0-9]{1,3})?"
          defaultValue={String(
            resource ? fromMinorUnits(resource.rate_minor, ctx.tenant.currency) : 0,
          )}
        />
        <SelectField
          label="Charged"
          name="rateUnit"
          options={RATE_UNITS.map((u) => ({ value: u, label: RATE_UNIT_LABELS[u] }))}
          defaultValue={resource?.rate_unit ?? 'night'}
        />
      </div>
      <Checkbox
        label="Taking reservations"
        name="active"
        defaultChecked={resource?.active ?? true}
        description="Inactive resources keep their history but can't be booked."
      />
    </>
  );
}

export async function ResourcesPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.configure);
  const resources = await listResources(ctx.db, ctx.tenant.id);
  return (
    <>
      {bookingsHeader(ctx, 'Resources', 'Rooms, tables, vehicles, bays: anything people reserve.')}
      {flash(searchParams)}
      <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0">
          {resources.length === 0 ? (
            <EmptyState title="No resources yet">Add the first one with the form.</EmptyState>
          ) : (
            <DataTable
              caption="Resources"
              hideCaption
              rows={resources}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  rowHeader: true,
                  cell: (r) => (
                    <>
                      <Link
                        href={ctx.path(`/bookings/resources/${r.id}`)}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {r.name}
                      </Link>
                      {!r.active && (
                        <>
                          {' '}
                          <Badge>Inactive</Badge>
                        </>
                      )}
                    </>
                  ),
                },
                { key: 'kind', header: 'Kind', cell: (r) => r.kind },
                {
                  key: 'capacity',
                  header: 'Capacity',
                  align: 'right',
                  hideOnMobile: true,
                  cell: (r) => r.capacity,
                },
                {
                  key: 'rate',
                  header: 'Rate',
                  align: 'right',
                  cell: (r) => (
                    <>
                      <Money minor={r.rate_minor} tenant={ctx.tenant} />{' '}
                      <span className="text-muted">
                        {RATE_UNIT_LABELS[r.rate_unit as keyof typeof RATE_UNIT_LABELS]}
                      </span>
                    </>
                  ),
                },
              ]}
            />
          )}
        </div>
        <Card aria-labelledby="new-resource-heading">
          <SectionHeading id="new-resource-heading">Add a resource</SectionHeading>
          <form action={createResourceAction} className="space-y-4">
            <TenantField slug={ctx.tenant.slug} />
            <ResourceFields ctx={ctx} />
            <SubmitButton pendingLabel="Adding…">Add resource</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}

export async function ResourceDetailPage({
  ctx,
  searchParams,
  resourceId,
}: TenantPageProps & { resourceId: string }) {
  requirePermission(ctx, P.configure);
  if (!UUID.test(resourceId)) notFound();
  const resource = await getResource(ctx.db, resourceId);
  if (!resource || resource.tenant_id !== ctx.tenant.id) notFound();
  const [hours, upcoming] = await Promise.all([
    listResourceHours(ctx.db, resource.id),
    listReservations(ctx.db, ctx.tenant.id, {
      resourceId: resource.id,
      from: new Date().toISOString(),
      statuses: ['tentative', 'confirmed', 'checked_in'],
      limit: 20,
    }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={ctx.path('/bookings/resources')} className="hover:underline">
            Resources
          </Link>
        }
        title={
          <>
            {resource.name} {!resource.active && <Badge>Inactive</Badge>}
          </>
        }
      />
      {flash(searchParams)}
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-8">
          <Card aria-labelledby="resource-heading">
            <SectionHeading id="resource-heading">Details</SectionHeading>
            <form action={updateResourceAction} className="space-y-4">
              <TenantField slug={ctx.tenant.slug} />
              <input type="hidden" name="resourceId" value={resource.id} />
              <ResourceFields resource={resource} ctx={ctx} />
              <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
            </form>
          </Card>

          <Card aria-labelledby="upcoming-heading">
            <SectionHeading id="upcoming-heading">Coming up</SectionHeading>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">No upcoming reservations.</p>
            ) : (
              <ul className="divide-y divide-line">
                {upcoming.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                  >
                    <Link
                      href={ctx.path(`/bookings/${r.id}`)}
                      className="underline-offset-2 hover:underline"
                    >
                      <When r={r} ctx={ctx} />
                    </Link>
                    {r.customer && <span>{r.customer.name}</span>}
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-8">
          <Card aria-labelledby="hours-heading">
            <SectionHeading id="hours-heading">Opening hours</SectionHeading>
            {hours.length === 0 ? (
              <p className="mb-4 text-sm text-muted">
                Open around the clock. Add hours to limit when it can be booked.
              </p>
            ) : (
              <ul className="mb-4 space-y-2 text-sm">
                {hours.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2">
                    <span>
                      {WEEKDAYS[h.weekday]} {h.opens.slice(0, 5)}–{h.closes.slice(0, 5)}
                    </span>
                    <form action={deleteResourceHoursAction}>
                      <TenantField slug={ctx.tenant.slug} />
                      <input type="hidden" name="resourceId" value={resource.id} />
                      <input type="hidden" name="hoursId" value={h.id} />
                      <SubmitButton variant="ghost" size="sm">
                        Remove
                        <span className="sr-only">
                          {' '}
                          {WEEKDAYS[h.weekday]} {h.opens.slice(0, 5)}
                        </span>
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form action={addResourceHoursAction} className="grid grid-cols-2 gap-3">
              <TenantField slug={ctx.tenant.slug} />
              <input type="hidden" name="resourceId" value={resource.id} />
              <SelectField
                label="Day"
                name="weekday"
                options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
                defaultValue="1"
                wrapperClassName="col-span-2"
              />
              <TextField label="Opens" name="opens" type="time" required defaultValue="08:00" />
              <TextField label="Closes" name="closes" type="time" required defaultValue="17:00" />
              <div className="col-span-2">
                <SubmitButton variant="secondary" size="sm" pendingLabel="Adding…">
                  Add hours
                </SubmitButton>
              </div>
            </form>
          </Card>

          <Card aria-labelledby="danger-heading">
            <SectionHeading id="danger-heading">Delete</SectionHeading>
            <p className="mb-3 text-sm text-muted">
              Only resources that were never booked can be deleted. Otherwise, untick &ldquo;Taking
              reservations&rdquo;.
            </p>
            <form action={deleteResourceAction}>
              <TenantField slug={ctx.tenant.slug} />
              <input type="hidden" name="resourceId" value={resource.id} />
              <ConfirmSubmit message={`Delete ${resource.name}?`}>Delete resource</ConfirmSubmit>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}

// --------------------------------------------- customer page integration

/**
 * A customer's reservations, for CustomerDetailPage's `sections` prop:
 *   sections={[(c) => <CustomerReservations ctx={ctx} customerId={c.id} />]}
 */
export async function CustomerReservations({
  ctx,
  customerId,
}: {
  ctx: TenantContext;
  customerId: string;
}) {
  if (!ctx.can(P.view)) return null;
  const rows = await listReservations(ctx.db, ctx.tenant.id, {
    customerId,
    ascending: false,
    limit: 20,
  });
  return (
    <Card aria-labelledby="customer-reservations-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <SectionHeading id="customer-reservations-heading">Reservations</SectionHeading>
        {ctx.can(P.create) && (
          <Link
            href={ctx.path(`/bookings/new?customer=${customerId}`)}
            className="text-sm underline-offset-2 hover:underline"
          >
            Book for this customer
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No reservations yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <Link
                href={ctx.path(`/bookings/${r.id}`)}
                className="font-medium underline-offset-2 hover:underline"
              >
                {r.resource?.name ?? 'Reservation'}
              </Link>
              <span className="text-muted">
                <When r={r} ctx={ctx} />
              </span>
              <StatusBadge status={r.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
