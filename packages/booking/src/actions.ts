'use server';

import { z } from 'zod';
import { formString, runTenantAction } from '@kitto/auth/server';
import { toMinorUnits } from '@kitto/core';
import {
  addResourceHours,
  createRecurringReservations,
  createReservation,
  createResource,
  deleteResource,
  deleteResourceHours,
  setReservationStatus,
  updateReservationDetails,
  updateResource,
} from './data';
import { BOOKING_PERMISSIONS as P } from './permissions';
import {
  localMinutesBetween,
  openingHoursSchema,
  reservationFormSchema,
  resourceFormSchema,
} from './schemas';
import { bookingErrorCode, hoursErrorCode, reservationFormError } from './shared';
import { isReservationStatus } from './status';

const idOf = (fd: FormData, key: string) => z.uuid().parse(formString(fd, key));

const resourceFields = (fd: FormData) => ({
  kind: formString(fd, 'kind'),
  name: formString(fd, 'name'),
  description: formString(fd, 'description'),
  capacity: formString(fd, 'capacity'),
  rate: formString(fd, 'rate'),
  rateUnit: formString(fd, 'rateUnit'),
  active: fd.get('active') === 'on',
});

export async function createResourceAction(formData: FormData): Promise<void> {
  await runTenantAction(
    formData,
    P.configure,
    '/bookings/resources',
    async (ctx) => {
      const parsed = resourceFormSchema.safeParse(resourceFields(formData));
      if (!parsed.success) return { error: 'invalid_resource' };
      const { rate, ...rest } = parsed.data;
      const resource = await createResource(ctx.db, ctx.tenant.id, {
        ...rest,
        rateMinor: toMinorUnits(rate, ctx.tenant.currency),
      });
      return { notice: 'resource_created', path: `/bookings/resources/${resource.id}` };
    },
    bookingErrorCode,
  );
}

export async function updateResourceAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'resourceId');
  await runTenantAction(
    formData,
    P.configure,
    `/bookings/resources/${id}`,
    async (ctx) => {
      const parsed = resourceFormSchema.safeParse(resourceFields(formData));
      if (!parsed.success) return { error: 'invalid_resource' };
      const { rate, ...rest } = parsed.data;
      await updateResource(ctx.db, id, {
        ...rest,
        rateMinor: toMinorUnits(rate, ctx.tenant.currency),
      });
      return { notice: 'resource_saved' };
    },
    bookingErrorCode,
  );
}

export async function deleteResourceAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'resourceId');
  await runTenantAction(
    formData,
    P.configure,
    `/bookings/resources/${id}`,
    async (ctx) => {
      await deleteResource(ctx.db, id);
      return { notice: 'resource_deleted', path: '/bookings/resources' };
    },
    bookingErrorCode,
  );
}

export async function addResourceHoursAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'resourceId');
  await runTenantAction(
    formData,
    P.configure,
    `/bookings/resources/${id}`,
    async (ctx) => {
      const parsed = openingHoursSchema.safeParse({
        weekday: formString(formData, 'weekday'),
        opens: formString(formData, 'opens'),
        closes: formString(formData, 'closes'),
      });
      if (!parsed.success) return { error: 'invalid_hours' };
      await addResourceHours(ctx.db, ctx.tenant.id, id, parsed.data);
      return { notice: 'hours_added' };
    },
    hoursErrorCode,
  );
}

export async function deleteResourceHoursAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'resourceId');
  const hoursId = idOf(formData, 'hoursId');
  await runTenantAction(formData, P.configure, `/bookings/resources/${id}`, async (ctx) => {
    await deleteResourceHours(ctx.db, hoursId);
    return { notice: 'hours_removed' };
  });
}

export async function createReservationAction(formData: FormData): Promise<void> {
  const resourceId = formString(formData, 'resourceId');
  const start = formString(formData, 'start');
  // On failure, come back to the form for the same resource and day.
  const back = {
    ...(resourceId ? { resource: resourceId } : {}),
    ...(/^\d{4}-\d{2}-\d{2}/.test(start) ? { day: start.slice(0, 10) } : {}),
  };
  await runTenantAction(formData, P.create, '/bookings/new', async (ctx) => {
    const parsed = reservationFormSchema.safeParse({
      resourceId,
      start,
      end: formString(formData, 'end'),
      customerId: formString(formData, 'customerId'),
      guests: formString(formData, 'guests') || '1',
      title: formString(formData, 'title'),
      notes: formString(formData, 'notes'),
      status: formString(formData, 'status') || 'confirmed',
      repeat: formString(formData, 'repeat'),
      occurrences: formString(formData, 'occurrences'),
    });
    if (!parsed.success) return { error: reservationFormError(parsed.error), params: back };
    const r = parsed.data;
    try {
      if (r.repeat) {
        const series = await createRecurringReservations(ctx.db, {
          resourceId: r.resourceId,
          start: r.start,
          durationMinutes: localMinutesBetween(r.start, r.end),
          every: r.repeat === 'daily' ? '1 day' : '1 week',
          occurrences: r.occurrences,
          customerId: r.customerId,
          guests: r.guests,
          title: r.title,
          notes: r.notes,
        });
        return { notice: 'series_created', path: `/bookings/${series[0]!.id}` };
      }
      const created = await createReservation(ctx.db, r);
      return { notice: 'created', path: `/bookings/${created.id}` };
    } catch (e) {
      return { error: bookingErrorCode(e), params: back };
    }
  });
}

export async function updateReservationAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'reservationId');
  await runTenantAction(
    formData,
    P.manage,
    `/bookings/${id}`,
    async (ctx) => {
      const parsed = z
        .object({
          title: z.string().trim().max(200),
          notes: z.string().trim().max(2000),
          guests: z.coerce.number().int().min(1).max(10000),
          customerId: z.union([z.literal('').transform(() => null), z.uuid()]),
        })
        .safeParse({
          title: formString(formData, 'title'),
          notes: formString(formData, 'notes'),
          guests: formString(formData, 'guests') || '1',
          customerId: formString(formData, 'customerId'),
        });
      if (!parsed.success) return { error: 'invalid' };
      await updateReservationDetails(ctx.db, id, parsed.data);
      return { notice: 'saved' };
    },
    bookingErrorCode,
  );
}

export async function setReservationStatusAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'reservationId');
  const status = formString(formData, 'status');
  await runTenantAction(
    formData,
    P.manage,
    `/bookings/${id}`,
    async (ctx) => {
      if (!isReservationStatus(status)) return { error: 'bad_transition' };
      await setReservationStatus(ctx.db, id, status);
      return { notice: 'status_changed' };
    },
    bookingErrorCode,
  );
}
