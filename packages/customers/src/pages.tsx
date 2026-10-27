import 'server-only';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { flashMessages } from '@kitto/core';
import { param, requirePermission, type TenantPageProps } from '@kitto/auth/server';
import {
  Badge,
  Card,
  Checkbox,
  DataTable,
  DateTime,
  EmptyState,
  Flash,
  PageHeader,
  SectionHeading,
  TenantField,
  TextField,
  TextareaField,
  buttonClass,
} from '@kitto/ui';
import { ConfirmSubmit, SubmitButton } from '@kitto/ui/client';
import {
  addCustomerNoteAction,
  archiveCustomerAction,
  createCustomerAction,
  deleteCustomerAction,
  deleteCustomerNoteAction,
  updateCustomerAction,
} from './actions';
import { getCustomer, listCustomerNotes, listCustomers, type Customer } from './data';
import { CUSTOMER_PERMISSIONS as P } from './permissions';
import { CUSTOMER_ERRORS, CUSTOMER_NOTICES } from './shared';

const PAGE_SIZE = 50;

function flash(searchParams: TenantPageProps['searchParams']) {
  return <Flash {...flashMessages(searchParams, CUSTOMER_NOTICES, CUSTOMER_ERRORS)} />;
}

/** Name, phone, email, tags and notes: shared by the new and edit forms. */
function CustomerFields({ customer, disabled }: { customer?: Customer; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <TextField
        label="Name"
        name="name"
        required
        maxLength={120}
        autoComplete="off"
        defaultValue={customer?.name}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          hint="e.g. 0712 345 678"
          defaultValue={customer?.phone ?? ''}
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="off"
          maxLength={254}
          defaultValue={customer?.email ?? ''}
        />
      </div>
      <TextField
        label="Tags"
        name="tags"
        autoComplete="off"
        hint="Separate with commas, e.g. vip, corporate"
        defaultValue={customer?.tags.join(', ')}
      />
      <TextareaField
        label="Notes"
        name="notes"
        rows={3}
        maxLength={2000}
        defaultValue={customer?.notes}
      />
    </fieldset>
  );
}

// ------------------------------------------------------------------- list

export async function CustomersPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.view);
  const q = param(searchParams, 'q');
  const tag = param(searchParams, 'tag');
  const includeArchived = param(searchParams, 'archived') === '1';
  const page = Math.max(Number.parseInt(param(searchParams, 'page') || '1', 10) || 1, 1);
  const { rows, count } = await listCustomers(ctx.db, ctx.tenant.id, {
    q,
    tag,
    includeArchived,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const pages = Math.max(Math.ceil(count / PAGE_SIZE), 1);
  const pageHref = (n: number) => {
    const qs = new URLSearchParams({
      ...(q && { q }),
      ...(tag && { tag }),
      ...(includeArchived && { archived: '1' }),
      page: String(n),
    });
    return ctx.path(`/customers?${qs}`);
  };

  return (
    <>
      <PageHeader
        title="Customers"
        description="Guests, buyers and everyone else you do business with."
        actions={
          ctx.can(P.create) && (
            <Link href={ctx.path('/customers/new')} className={buttonClass()}>
              New customer
            </Link>
          )
        }
      />
      {flash(searchParams)}

      <form
        role="search"
        className="mb-6 flex flex-wrap items-end gap-3"
        action={ctx.path('/customers')}
      >
        <TextField
          label="Search customers"
          hideLabel
          name="q"
          type="search"
          placeholder="Name, phone or email"
          defaultValue={q}
          wrapperClassName="min-w-0 flex-1 basis-56"
        />
        {tag && <input type="hidden" name="tag" value={tag} />}
        <Checkbox
          label="Include archived"
          name="archived"
          value="1"
          defaultChecked={includeArchived}
        />
        <button type="submit" className={buttonClass('secondary')}>
          Search
        </button>
      </form>
      {tag && (
        <p className="mb-4 text-sm">
          Tagged <Badge tone="brand">{tag}</Badge>{' '}
          <Link href={ctx.path('/customers')} className="underline">
            Clear
          </Link>
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState title={q || tag ? 'No matching customers' : 'No customers yet'}>
          {q || tag
            ? 'Try another search.'
            : 'Customers you add, or who book with you, appear here.'}
        </EmptyState>
      ) : (
        <DataTable
          caption={`Customers (${count})`}
          hideCaption
          rows={rows}
          rowKey={(c) => c.id}
          columns={[
            {
              key: 'name',
              header: 'Name',
              rowHeader: true,
              cell: (c) => (
                <>
                  <Link
                    href={ctx.path(`/customers/${c.id}`)}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {c.name}
                  </Link>
                  {c.archived_at && (
                    <>
                      {' '}
                      <Badge>Archived</Badge>
                    </>
                  )}
                </>
              ),
            },
            { key: 'phone', header: 'Phone', cell: (c) => c.phone },
            { key: 'email', header: 'Email', hideOnMobile: true, cell: (c) => c.email },
            {
              key: 'tags',
              header: 'Tags',
              hideOnMobile: true,
              cell: (c) => (
                <span className="flex flex-wrap gap-1">
                  {c.tags.map((t) => (
                    <Link key={t} href={ctx.path(`/customers?tag=${encodeURIComponent(t)}`)}>
                      <Badge tone="brand">{t}</Badge>
                    </Link>
                  ))}
                </span>
              ),
            },
          ]}
        />
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className={buttonClass('secondary', 'sm')}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className={buttonClass('secondary', 'sm')}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}

// -------------------------------------------------------------------- new

export function NewCustomerPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.create);
  return (
    <>
      <PageHeader eyebrow="Customers" title="New customer" />
      {flash(searchParams)}
      <Card className="max-w-2xl">
        <form action={createCustomerAction} className="space-y-6">
          <TenantField slug={ctx.tenant.slug} />
          <CustomerFields />
          <div className="flex flex-wrap gap-3">
            <SubmitButton pendingLabel="Saving…">Add customer</SubmitButton>
            <Link href={ctx.path('/customers')} className={buttonClass('ghost')}>
              Cancel
            </Link>
          </div>
        </form>
      </Card>
    </>
  );
}

// ----------------------------------------------------------------- detail

export interface CustomerDetailPageProps extends TenantPageProps {
  customerId: string;
  /**
   * Extra sections from other modules (reservations, orders, invoices), so
   * customers doesn't depend on them. Each gets the loaded customer.
   */
  sections?: ((customer: Customer) => ReactNode)[];
}

export async function CustomerDetailPage({
  ctx,
  searchParams,
  customerId,
  sections = [],
}: CustomerDetailPageProps) {
  requirePermission(ctx, P.view);
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) notFound();
  const customer = await getCustomer(ctx.db, customerId);
  if (!customer || customer.tenant_id !== ctx.tenant.id) notFound();
  const notes = await listCustomerNotes(ctx.db, customer.id);
  const canEdit = ctx.can(P.edit);
  const archived = Boolean(customer.archived_at);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={ctx.path('/customers')} className="hover:underline">
            Customers
          </Link>
        }
        title={
          <>
            {customer.name} {archived && <Badge>Archived</Badge>}
          </>
        }
        description={[customer.phone, customer.email].filter(Boolean).join(' · ') || undefined}
      />
      {flash(searchParams)}

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-8">
          <Card aria-labelledby="details-heading">
            <SectionHeading id="details-heading">Details</SectionHeading>
            <form action={updateCustomerAction} className="space-y-6">
              <TenantField slug={ctx.tenant.slug} />
              <input type="hidden" name="customerId" value={customer.id} />
              <CustomerFields customer={customer} disabled={!canEdit} />
              {canEdit && <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>}
            </form>
          </Card>

          {sections.map((render, i) => (
            <div key={i}>{render(customer)}</div>
          ))}
        </div>

        <div className="space-y-8">
          <Card aria-labelledby="notes-heading">
            <SectionHeading id="notes-heading">Notes</SectionHeading>
            {canEdit && (
              <form action={addCustomerNoteAction} className="mb-6 space-y-3">
                <TenantField slug={ctx.tenant.slug} />
                <input type="hidden" name="customerId" value={customer.id} />
                <TextareaField
                  label="Add a note"
                  name="body"
                  id="note-body"
                  rows={3}
                  maxLength={2000}
                  required
                />
                <SubmitButton variant="secondary" size="sm" pendingLabel="Adding…">
                  Add note
                </SubmitButton>
              </form>
            )}
            {notes.length === 0 ? (
              <p className="text-sm text-muted">No notes yet.</p>
            ) : (
              <ol className="space-y-4">
                {notes.map((n) => (
                  <li key={n.id} className="border-l-2 border-line pl-3">
                    <p className="text-sm whitespace-pre-line">{n.body}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>
                        {n.author_email ?? 'Someone'} ·{' '}
                        <DateTime value={n.created_at} tenant={ctx.tenant} />
                      </span>
                      {canEdit && (n.author_id === ctx.user.id || ctx.can(P.delete)) && (
                        <form action={deleteCustomerNoteAction}>
                          <TenantField slug={ctx.tenant.slug} />
                          <input type="hidden" name="customerId" value={customer.id} />
                          <input type="hidden" name="noteId" value={n.id} />
                          <ConfirmSubmit message="Delete this note?" variant="ghost">
                            Delete<span className="sr-only"> note</span>
                          </ConfirmSubmit>
                        </form>
                      )}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {(canEdit || ctx.can(P.delete)) && (
            <Card aria-labelledby="manage-heading">
              <SectionHeading id="manage-heading">Manage</SectionHeading>
              <div className="flex flex-wrap gap-3">
                {canEdit && (
                  <form action={archiveCustomerAction}>
                    <TenantField slug={ctx.tenant.slug} />
                    <input type="hidden" name="customerId" value={customer.id} />
                    <input type="hidden" name="archive" value={archived ? 'false' : 'true'} />
                    <SubmitButton variant="secondary" size="sm">
                      {archived ? 'Restore customer' : 'Archive customer'}
                    </SubmitButton>
                  </form>
                )}
                {ctx.can(P.delete) && (
                  <form action={deleteCustomerAction}>
                    <TenantField slug={ctx.tenant.slug} />
                    <input type="hidden" name="customerId" value={customer.id} />
                    <ConfirmSubmit
                      message={`Delete ${customer.name} for good? Customers with history can only be archived.`}
                    >
                      Delete customer
                    </ConfirmSubmit>
                  </form>
                )}
              </div>
              <p className="mt-3 text-xs text-muted">
                Added <DateTime value={customer.created_at} tenant={ctx.tenant} dateOnly />.
              </p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
