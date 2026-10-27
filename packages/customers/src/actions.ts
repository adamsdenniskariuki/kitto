'use server';

import { z } from 'zod';
import { formString, runTenantAction } from '@kitto/auth/server';
import {
  addCustomerNote,
  createCustomer,
  deleteCustomer,
  deleteCustomerNote,
  setCustomerArchived,
  updateCustomer,
} from './data';
import { CUSTOMER_PERMISSIONS as P } from './permissions';
import { customerFormSchema, customerNoteSchema } from './schemas';
import { customerErrorCode, customerFormError } from './shared';

const customerFields = (fd: FormData) => ({
  name: formString(fd, 'name'),
  phone: formString(fd, 'phone'),
  email: formString(fd, 'email'),
  tags: formString(fd, 'tags'),
  notes: formString(fd, 'notes'),
});

const idOf = (fd: FormData, key = 'customerId') => z.uuid().parse(formString(fd, key));

export async function createCustomerAction(formData: FormData): Promise<void> {
  await runTenantAction(
    formData,
    P.create,
    '/customers/new',
    async (ctx) => {
      const parsed = customerFormSchema.safeParse(customerFields(formData));
      if (!parsed.success) return { error: customerFormError(parsed.error) };
      const customer = await createCustomer(ctx.db, ctx.tenant.id, parsed.data);
      return { notice: 'created', path: `/customers/${customer.id}` };
    },
    customerErrorCode,
  );
}

export async function updateCustomerAction(formData: FormData): Promise<void> {
  const id = idOf(formData);
  await runTenantAction(
    formData,
    P.edit,
    `/customers/${id}`,
    async (ctx) => {
      const parsed = customerFormSchema.safeParse(customerFields(formData));
      if (!parsed.success) return { error: customerFormError(parsed.error) };
      await updateCustomer(ctx.db, id, parsed.data);
      return { notice: 'saved' };
    },
    customerErrorCode,
  );
}

export async function archiveCustomerAction(formData: FormData): Promise<void> {
  const id = idOf(formData);
  const archive = formString(formData, 'archive') !== 'false';
  await runTenantAction(formData, P.edit, `/customers/${id}`, async (ctx) => {
    await setCustomerArchived(ctx.db, id, archive);
    return { notice: archive ? 'archived' : 'restored' };
  });
}

export async function deleteCustomerAction(formData: FormData): Promise<void> {
  const id = idOf(formData);
  await runTenantAction(formData, P.delete, `/customers/${id}`, async (ctx) => {
    await deleteCustomer(ctx.db, id);
    return { notice: 'deleted', path: '/customers' };
  });
}

export async function addCustomerNoteAction(formData: FormData): Promise<void> {
  const id = idOf(formData);
  await runTenantAction(formData, P.edit, `/customers/${id}`, async (ctx) => {
    const parsed = customerNoteSchema.safeParse({ body: formString(formData, 'body') });
    if (!parsed.success) return { error: customerFormError(parsed.error) };
    await addCustomerNote(ctx.db, ctx.tenant.id, id, parsed.data.body);
    return { notice: 'note_added' };
  });
}

export async function deleteCustomerNoteAction(formData: FormData): Promise<void> {
  const id = idOf(formData);
  const noteId = idOf(formData, 'noteId');
  await runTenantAction(formData, P.edit, `/customers/${id}`, async (ctx) => {
    await deleteCustomerNote(ctx.db, noteId);
    return { notice: 'note_deleted' };
  });
}
