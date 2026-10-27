import 'server-only';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  groupByModule,
  listAudit,
  listMembers,
  listPendingInvitations,
  listPermissions,
  listRoles,
  OWNER_ROLE,
} from '@kitto/core';
import type { TenantContext } from '@kitto/auth/server';
import {
  Alert,
  Badge,
  Card,
  Checkbox,
  DataTable,
  DateTime,
  EmptyState,
  PageHeader,
  SectionHeading,
  SelectField,
  TextField,
  TextareaField,
  THEMES,
  THEME_KEYS,
  buttonClass,
} from '@kitto/ui';
import { ConfirmSubmit, SubmitButton } from '@kitto/ui/client';
import {
  changeMemberRoleAction,
  createRoleAction,
  deleteRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
  saveRolePermissionsAction,
  saveSettingsAction,
  setMemberStatusAction,
} from './actions';
import { ADMIN_PERMISSIONS, ADMIN_SECTIONS, flash } from './shared';

export type SearchParams = Record<string, string | string[] | undefined>;

export interface AdminPageProps {
  ctx: TenantContext;
  searchParams?: SearchParams;
}

function Flash({ searchParams }: { searchParams: SearchParams | undefined }) {
  const { notice, error } = flash(searchParams ?? {});
  if (!notice && !error) return null;
  return (
    <div className="mb-6">
      {error ? <Alert tone="danger">{error}</Alert> : <Alert tone="success">{notice}</Alert>}
    </div>
  );
}

function TenantField({ ctx }: { ctx: TenantContext }) {
  return <input type="hidden" name="tenant" value={ctx.tenant.slug} />;
}

function requireAny(ctx: TenantContext, perms: readonly string[]) {
  if (!perms.some((p) => ctx.can(p))) notFound();
}

// ------------------------------------------------------------------- home

export function AdminHome({ ctx }: AdminPageProps) {
  requireAny(ctx, ADMIN_PERMISSIONS);
  const sections = ADMIN_SECTIONS.filter((s) => ctx.can(s.permission));
  return (
    <>
      <PageHeader
        eyebrow={ctx.tenant.name}
        title="Admin"
        description="Manage who can use this workspace and how it is set up."
      />
      <ul className="grid gap-4 sm:grid-cols-2">
        {sections.map((s) => (
          <li key={s.path}>
            <Link href={ctx.path(s.path)} className="card block h-full hover:border-brand">
              <span className="font-semibold">{s.label}</span>
              <span className="mt-1 block text-sm text-muted">{s.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

// ------------------------------------------------------------------ staff

export async function StaffPage({ ctx, searchParams }: AdminPageProps) {
  requireAny(ctx, ['members.manage']);
  const [members, roles, invitations] = await Promise.all([
    listMembers(ctx.db, ctx.tenant.id),
    listRoles(ctx.db, ctx.tenant.id),
    listPendingInvitations(ctx.db, ctx.tenant.id),
  ]);
  const isOwner = ctx.role.key === OWNER_ROLE;
  // Non-owners may only hand out roles whose permissions they hold (enforced in SQL too).
  const assignable = roles.filter((r) =>
    r.key === OWNER_ROLE ? isOwner : r.role_permissions.every((rp) => ctx.can(rp.permission_key)),
  );
  const roleOptions = assignable.map((r) => ({ value: r.id, label: r.name }));
  const defaultRole = assignable.find((r) => r.key === 'viewer') ?? assignable[0];

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Staff"
        description="People who can sign in to this workspace, and their roles."
      />
      <Flash searchParams={searchParams} />

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="members-heading" className="min-w-0">
          <SectionHeading id="members-heading">Members</SectionHeading>
          <DataTable
            caption="Members"
            hideCaption
            rows={members}
            rowKey={(m) => m.user_id}
            columns={[
              {
                key: 'who',
                header: 'Member',
                rowHeader: true,
                cell: (m) => (
                  <>
                    <span className="block">{m.display_name || m.email}</span>
                    {m.display_name && (
                      <span className="block text-xs font-normal text-muted">{m.email}</span>
                    )}
                    {m.user_id === ctx.user.id && <Badge tone="brand">You</Badge>}
                  </>
                ),
              },
              {
                key: 'role',
                header: 'Role',
                cell: (m) => {
                  const canChange = m.role?.key !== OWNER_ROLE || isOwner;
                  if (!canChange) return m.role?.name;
                  return (
                    <form action={changeMemberRoleAction} className="flex items-end gap-2">
                      <TenantField ctx={ctx} />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <SelectField
                        id={`role-${m.user_id}`}
                        label={`Role for ${m.email}`}
                        hideLabel
                        name="roleId"
                        defaultValue={m.role_id}
                        options={
                          roleOptions.some((o) => o.value === m.role_id)
                            ? roleOptions
                            : [
                                {
                                  value: m.role_id,
                                  label: m.role?.name ?? 'Current role',
                                  disabled: true,
                                },
                                ...roleOptions,
                              ]
                        }
                        className="min-h-9 w-40 py-1 text-sm"
                      />
                      <SubmitButton variant="secondary" size="sm">
                        Save
                      </SubmitButton>
                    </form>
                  );
                },
              },
              {
                key: 'status',
                header: 'Status',
                hideOnMobile: true,
                cell: (m) => (
                  <Badge tone={m.status === 'active' ? 'success' : 'warning'}>
                    {m.status === 'active' ? 'Active' : 'Disabled'}
                  </Badge>
                ),
              },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                align: 'right',
                cell: (m) => (
                  <div className="flex justify-end gap-2">
                    <form action={setMemberStatusAction}>
                      <TenantField ctx={ctx} />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <input
                        type="hidden"
                        name="status"
                        value={m.status === 'active' ? 'disabled' : 'active'}
                      />
                      <SubmitButton variant="ghost" size="sm">
                        {m.status === 'active' ? 'Disable' : 'Enable'}
                        <span className="sr-only"> {m.email}</span>
                      </SubmitButton>
                    </form>
                    <form action={removeMemberAction}>
                      <TenantField ctx={ctx} />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <ConfirmSubmit message={`Remove ${m.email} from ${ctx.tenant.name}?`}>
                        Remove<span className="sr-only"> {m.email}</span>
                      </ConfirmSubmit>
                    </form>
                  </div>
                ),
              },
            ]}
          />

          <h3 className="mt-8 mb-3 font-semibold">Pending invitations</h3>
          {invitations.length === 0 ? (
            <EmptyState title="No pending invitations" />
          ) : (
            <DataTable
              caption="Pending invitations"
              hideCaption
              rows={invitations}
              rowKey={(i) => i.id}
              columns={[
                { key: 'email', header: 'Email', rowHeader: true, cell: (i) => i.email },
                { key: 'role', header: 'Role', cell: (i) => i.role?.name },
                {
                  key: 'expires',
                  header: 'Expires',
                  hideOnMobile: true,
                  cell: (i) => <DateTime value={i.expires_at} tenant={ctx.tenant} dateOnly />,
                },
                {
                  key: 'revoke',
                  header: <span className="sr-only">Actions</span>,
                  align: 'right',
                  cell: (i) => (
                    <form action={revokeInvitationAction}>
                      <TenantField ctx={ctx} />
                      <input type="hidden" name="invitationId" value={i.id} />
                      <SubmitButton variant="ghost" size="sm">
                        Revoke<span className="sr-only"> invitation for {i.email}</span>
                      </SubmitButton>
                    </form>
                  ),
                },
              ]}
            />
          )}
        </section>

        <Card aria-labelledby="invite-heading" className="h-fit">
          <SectionHeading id="invite-heading">Invite someone</SectionHeading>
          <form action={inviteMemberAction} className="space-y-4">
            <TenantField ctx={ctx} />
            <TextField label="Email" name="email" type="email" autoComplete="off" required />
            <SelectField
              label="Role"
              name="roleId"
              options={roleOptions}
              defaultValue={defaultRole?.id}
              required
            />
            <SubmitButton className="w-full" pendingLabel="Sending…">
              Send invitation
            </SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ roles

export async function RolesPage({ ctx, searchParams }: AdminPageProps) {
  requireAny(ctx, ['roles.manage']);
  const [roles, permissions] = await Promise.all([
    listRoles(ctx.db, ctx.tenant.id),
    listPermissions(ctx.db),
  ]);
  const selectedId = typeof searchParams?.role === 'string' ? searchParams.role : undefined;
  const selected = roles.find((r) => r.id === selectedId);
  const grouped = groupByModule(permissions);

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Roles"
        description="Each role is a set of permissions. Owners always have every permission."
      />
      <Flash searchParams={searchParams} />

      <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-6">
          <nav aria-label="Roles">
            <ul className="space-y-1">
              {roles.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`${ctx.path('/admin/roles')}?role=${r.id}`}
                    aria-current={r.id === selected?.id ? 'page' : undefined}
                    className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 hover:bg-surface-2 aria-[current=page]:bg-brand-soft"
                  >
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs text-muted">
                      {r.key === OWNER_ROLE ? 'all' : r.role_permissions.length} permissions
                      {r.is_system ? '' : ' · custom'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <Card aria-labelledby="new-role-heading">
            <SectionHeading id="new-role-heading">New custom role</SectionHeading>
            <form action={createRoleAction} className="space-y-4">
              <TenantField ctx={ctx} />
              <TextField label="Name" name="name" required placeholder="Night auditor" />
              <TextField
                label="Key"
                name="key"
                required
                placeholder="night_auditor"
                hint="Lowercase letters, numbers and underscores."
                autoCapitalize="none"
                spellCheck={false}
              />
              <TextareaField label="Description" name="description" />
              <SubmitButton className="w-full">Create role</SubmitButton>
            </form>
          </Card>
        </div>

        <section aria-labelledby="role-editor-heading" className="min-w-0">
          {!selected ? (
            <EmptyState title="Choose a role">
              Pick a role on the left to see and edit its permissions.
            </EmptyState>
          ) : (
            <Card>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="role-editor-heading" className="text-lg font-semibold">
                    {selected.name} {selected.is_system && <Badge>System</Badge>}
                  </h2>
                  {selected.description && (
                    <p className="text-sm text-muted">{selected.description}</p>
                  )}
                </div>
                {!selected.is_system && (
                  <form action={deleteRoleAction}>
                    <TenantField ctx={ctx} />
                    <input type="hidden" name="roleId" value={selected.id} />
                    <ConfirmSubmit message={`Delete the ${selected.name} role?`}>
                      Delete role
                    </ConfirmSubmit>
                  </form>
                )}
              </div>
              {selected.key === OWNER_ROLE ? (
                <Alert>
                  The owner role always has every permission, so it can never be locked out.
                </Alert>
              ) : (
                <form action={saveRolePermissionsAction} className="space-y-6">
                  <TenantField ctx={ctx} />
                  <input type="hidden" name="roleId" value={selected.id} />
                  {[...grouped.entries()].map(([module, perms]) => (
                    <fieldset key={module} className="space-y-3">
                      <legend className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">
                        {module}
                      </legend>
                      {perms.map((p) => {
                        const has = selected.role_permissions.some(
                          (rp) => rp.permission_key === p.key,
                        );
                        return (
                          <Checkbox
                            key={p.key}
                            name="permission"
                            value={p.key}
                            defaultChecked={has}
                            // You can only grant what you hold; keep already-granted ones submitted.
                            disabled={!ctx.can(p.key) && !has}
                            label={<code className="text-sm">{p.key}</code>}
                            description={p.description}
                          />
                        );
                      })}
                    </fieldset>
                  ))}
                  <SubmitButton>Save permissions</SubmitButton>
                </form>
              )}
            </Card>
          )}
        </section>
      </div>
    </>
  );
}

// --------------------------------------------------------------- settings

const CURRENCIES = ['KES', 'UGX', 'TZS', 'RWF', 'USD', 'EUR', 'GBP', 'ZAR', 'NGN'];
const LOCALES = ['en-KE', 'sw-KE', 'en-UG', 'en-TZ', 'en-US', 'en-GB', 'fr-FR'];

export function SettingsPage({ ctx, searchParams }: AdminPageProps) {
  requireAny(ctx, ['tenant.manage']);
  const t = ctx.tenant;
  const opts = (values: string[], current: string) =>
    (values.includes(current) ? values : [current, ...values]).map((v) => ({ value: v, label: v }));
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [t.timezone];

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="How this workspace looks and how it formats money and dates."
      />
      <Flash searchParams={searchParams} />
      <Card className="max-w-xl">
        <form action={saveSettingsAction} className="space-y-4">
          <TenantField ctx={ctx} />
          <TextField label="Business name" name="name" defaultValue={t.name} required />
          <SelectField
            label="Currency"
            name="currency"
            defaultValue={t.currency}
            options={opts(CURRENCIES, t.currency)}
            hint="Used for prices, invoices and reports."
          />
          <SelectField
            label="Locale"
            name="locale"
            defaultValue={t.locale}
            options={opts(LOCALES, t.locale)}
            hint="Controls number and date formatting."
          />
          <SelectField
            label="Time zone"
            name="timezone"
            defaultValue={t.timezone}
            options={opts(zones, t.timezone)}
          />
          <SelectField
            label="Theme"
            name="theme"
            defaultValue={t.theme}
            options={THEME_KEYS.map((k) => ({ value: k, label: THEMES[k].name }))}
            hint="Every theme has a light and a dark version."
          />
          <SubmitButton>Save settings</SubmitButton>
        </form>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ audit

export const CORE_AUDITED_TABLES = [
  'tenants',
  'tenant_members',
  'roles',
  'role_permissions',
  'invitations',
];

function show(v: unknown): string {
  if (v === null || v === undefined) return '—';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export async function AuditPage({
  ctx,
  searchParams,
  tables = CORE_AUDITED_TABLES,
}: AdminPageProps & { tables?: readonly string[] }) {
  requireAny(ctx, ['audit.view']);
  const table =
    typeof searchParams?.table === 'string' && tables.includes(searchParams.table)
      ? searchParams.table
      : undefined;
  const before =
    typeof searchParams?.before === 'string' ? Number.parseInt(searchParams.before, 10) : undefined;
  const PAGE = 50;
  const entries = await listAudit(ctx.db, ctx.tenant.id, {
    limit: PAGE,
    ...(table ? { table } : {}),
    ...(before && Number.isFinite(before) ? { before } : {}),
  });
  const last = entries.at(-1);
  const base = ctx.path('/admin/audit');
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(table ? { table } : {}), ...extra });
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Audit log"
        description="Every change to audited records: who made it, when, and what changed."
      />
      <form method="get" action={base} className="mb-6 flex flex-wrap items-end gap-3">
        <SelectField
          label="Table"
          name="table"
          defaultValue={table ?? ''}
          placeholder="All tables"
          options={tables.map((t) => ({ value: t, label: t }))}
          wrapperClassName="w-56"
        />
        <button type="submit" className={buttonClass('secondary')}>
          Filter
        </button>
      </form>

      {entries.length === 0 ? (
        <EmptyState title="No changes recorded yet" />
      ) : (
        <ol className="space-y-3">
          {entries.map((e) => {
            const oldData = (e.old_data ?? {}) as Record<string, unknown>;
            const newData = (e.new_data ?? {}) as Record<string, unknown>;
            const fields =
              e.action === 'update'
                ? e.changed
                : Object.keys(e.action === 'delete' ? oldData : newData);
            return (
              <li key={e.id} className="card !p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <Badge
                    tone={
                      e.action === 'delete' ? 'danger' : e.action === 'insert' ? 'success' : 'brand'
                    }
                  >
                    {e.action}
                  </Badge>
                  <code>{e.table_name}</code>
                  <span className="text-muted">by {e.actor_email ?? 'system'}</span>
                  <span className="text-muted">
                    <DateTime value={e.created_at} tenant={ctx.tenant} />
                  </span>
                </div>
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-muted">
                    {fields.length} field{fields.length === 1 ? '' : 's'} · record{' '}
                    <code>{e.record_id}</code>
                  </summary>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <caption className="sr-only">Changes in audit entry {e.id}</caption>
                      <thead>
                        <tr>
                          <th scope="col" className="py-1 pr-4 text-muted">
                            Field
                          </th>
                          {e.action !== 'insert' && (
                            <th scope="col" className="py-1 pr-4 text-muted">
                              Before
                            </th>
                          )}
                          {e.action !== 'delete' && (
                            <th scope="col" className="py-1 text-muted">
                              After
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((f) => (
                          <tr key={f} className="border-t border-line align-top">
                            <th scope="row" className="py-1 pr-4 font-mono font-normal">
                              {f}
                            </th>
                            {e.action !== 'insert' && (
                              <td className="py-1 pr-4 break-all">{show(oldData[f])}</td>
                            )}
                            {e.action !== 'delete' && (
                              <td className="py-1 break-all">{show(newData[f])}</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      )}

      <nav aria-label="Audit pages" className="mt-6 flex gap-3">
        {before && (
          <Link href={qs({})} className={buttonClass('secondary', 'sm')}>
            Newest
          </Link>
        )}
        {entries.length === PAGE && last && (
          <Link href={qs({ before: String(last.id) })} className={buttonClass('secondary', 'sm')}>
            Older
          </Link>
        )}
      </nav>
    </>
  );
}
