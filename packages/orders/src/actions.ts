'use server';

import { z } from 'zod';
import { formString, runTenantAction } from '@kitto/auth/server';
import { toMinorUnits } from '@kitto/core';
import {
  addOrderLine,
  createOrder,
  listOrderLines,
  removeOrderLine,
  setOrderStatus,
  updateOrder,
} from './data';
import { ORDER_PERMISSIONS as P } from './permissions';
import { cancelOrderSchema, orderFormSchema, orderLineFormSchema } from './schemas';
import { lineErrorCode, orderErrorCode } from './shared';
import { isOrderStatus, ORDER_STATUS_PERMISSIONS } from './status';

const idOf = (fd: FormData, key: string) => z.uuid().parse(formString(fd, key));

const orderFields = (fd: FormData) => ({
  channel: formString(fd, 'channel'),
  customerId: formString(fd, 'customerId'),
  reservationId: formString(fd, 'reservationId'),
  locationId: formString(fd, 'locationId'),
  notes: formString(fd, 'notes'),
});

export async function createOrderAction(formData: FormData): Promise<void> {
  await runTenantAction(
    formData,
    P.create,
    '/orders/new',
    async (ctx) => {
      const parsed = orderFormSchema.safeParse(orderFields(formData));
      if (!parsed.success) return { error: 'invalid_order' };
      const order = await createOrder(ctx.db, ctx.tenant.id, parsed.data);
      return { notice: 'order_created', path: `/orders/${order.id}` };
    },
    orderErrorCode,
  );
}

export async function updateOrderAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'orderId');
  await runTenantAction(
    formData,
    P.create,
    `/orders/${id}`,
    async (ctx) => {
      const parsed = orderFormSchema.safeParse(orderFields(formData));
      if (!parsed.success) return { error: 'invalid_order' };
      await updateOrder(ctx.db, id, parsed.data);
      return { notice: 'order_saved' };
    },
    orderErrorCode,
  );
}

export async function addOrderLineAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'orderId');
  await runTenantAction(
    formData,
    P.create,
    `/orders/${id}`,
    async (ctx) => {
      const parsed = orderLineFormSchema.safeParse({
        itemId: formString(formData, 'itemId'),
        description: formString(formData, 'description'),
        quantity: formString(formData, 'quantity'),
        unitPrice: formString(formData, 'unitPrice'),
        note: formString(formData, 'note'),
      });
      if (!parsed.success) return { error: lineErrorCode(parsed.error) };
      const { unitPrice, ...line } = parsed.data;
      const lines = await listOrderLines(ctx.db, id);
      await addOrderLine(
        ctx.db,
        ctx.tenant.id,
        id,
        {
          ...line,
          unitPriceMinor: unitPrice === null ? null : toMinorUnits(unitPrice, ctx.tenant.currency),
        },
        lines.reduce((max, l) => Math.max(max, l.position + 1), 0),
      );
      return { notice: 'line_added' };
    },
    orderErrorCode,
  );
}

export async function removeOrderLineAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'orderId');
  const lineId = idOf(formData, 'lineId');
  await runTenantAction(
    formData,
    P.create,
    `/orders/${id}`,
    async (ctx) => {
      await removeOrderLine(ctx.db, lineId);
      return { notice: 'line_removed' };
    },
    orderErrorCode,
  );
}

/** Send, fulfil, pay or cancel. The permission depends on the step. */
export async function setOrderStatusAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'orderId');
  const status = z
    .string()
    .refine((s) => isOrderStatus(s) && s !== 'open')
    .parse(formString(formData, 'status'));
  if (!isOrderStatus(status)) throw new Error('unreachable');
  await runTenantAction(
    formData,
    ORDER_STATUS_PERMISSIONS[status],
    `/orders/${id}`,
    async (ctx) => {
      const reason =
        status === 'cancelled'
          ? cancelOrderSchema.parse({ reason: formString(formData, 'reason') }).reason
          : undefined;
      await setOrderStatus(ctx.db, id, status, reason);
      return { notice: status };
    },
    orderErrorCode,
  );
}
