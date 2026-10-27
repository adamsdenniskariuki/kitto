-- =============================================================================
-- core 0002 Tenancy schema: tenants, permissions, roles, members, invitations.
--
--   * Every tenant-owned table carries tenant_id. Child tables reference their
--     parent with a COMPOSITE foreign key (tenant_id, parent_id) ->
--     parent (tenant_id, id). The database then guarantees a row can only
--     point at a parent in the SAME tenant, even if a client sends a forged id.
--   * Permissions are global keys like "booking.create". Modules register
--     theirs with private.register_permission() (migration 0003).
--   * Roles are per tenant. Seven system roles are copied from templates when a
--     tenant is created; tenants can add custom roles. The "owner" role
--     implicitly holds every permission, including ones added later.
-- =============================================================================

create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
                check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  currency    text not null default 'KES' check (currency ~ '^[A-Z]{3}$'),
  locale      text not null default 'en-KE' check (char_length(locale) between 2 and 20),
  timezone    text not null default 'Africa/Nairobi' check (char_length(timezone) between 1 and 64),
  theme       text not null default 'default' check (theme ~ '^[a-z0-9-]{1,32}$'),
  settings    jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.tenants is
  'One row per business using the app. Resolved from the subdomain or URL path by @kitto/core.';
comment on column public.tenants.slug is
  'URL-safe identifier: <slug>.example.com or example.com/t/<slug>.';

create trigger tenants_updated_at before update on public.tenants
  for each row execute function private.set_updated_at();

-- Global permission catalogue (not tenant-owned).
create table public.permissions (
  key          text primary key check (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  module       text not null check (module ~ '^[a-z][a-z0-9_-]*$'),
  description  text not null
);
comment on table public.permissions is
  'Every permission key known to the app. Rows are added by module migrations via private.register_permission().';

-- Role templates: the system roles every new tenant starts with.
create table private.role_templates (
  key          text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name         text not null,
  description  text not null,
  position     integer not null
);

create table private.role_template_permissions (
  role_key        text not null references private.role_templates (key) on delete cascade,
  permission_key  text not null references public.permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);

insert into private.role_templates (key, name, description, position) values
  ('owner',       'Owner',       'Full access, including billing settings and roles. Cannot be removed while they are the last owner.', 10),
  ('manager',     'Manager',     'Runs day-to-day operations and manages staff.', 20),
  ('front_desk',  'Front desk',  'Customers, bookings and taking payments.', 30),
  ('waiter',      'Waiter',      'Takes and serves orders.', 40),
  ('storekeeper', 'Storekeeper', 'Stock, suppliers and purchases.', 50),
  ('sales',       'Sales',       'Customers, quotes and sales orders.', 60),
  ('viewer',      'Viewer',      'Read-only access to everything they can see.', 70);

create table public.roles (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  key          text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  description  text not null default '' check (char_length(description) <= 300),
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, key),
  unique (tenant_id, id)
);
create trigger roles_updated_at before update on public.roles
  for each row execute function private.set_updated_at();
create trigger roles_tenant_immutable before update of tenant_id on public.roles
  for each row execute function private.prevent_tenant_change();

create table public.role_permissions (
  tenant_id       uuid not null,
  role_id         uuid not null,
  permission_key  text not null references public.permissions (key) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (role_id, permission_key),
  foreign key (tenant_id, role_id) references public.roles (tenant_id, id) on delete cascade
);
create index role_permissions_tenant_idx on public.role_permissions (tenant_id);

create table public.tenant_members (
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role_id       uuid not null,
  email         text not null,
  display_name  text not null default '' check (char_length(display_name) <= 120),
  status        text not null default 'active' check (status in ('active', 'disabled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, user_id),
  foreign key (tenant_id, role_id) references public.roles (tenant_id, id)
);
create index tenant_members_user_idx on public.tenant_members (user_id);
create index tenant_members_role_idx on public.tenant_members (tenant_id, role_id);
create trigger tenant_members_updated_at before update on public.tenant_members
  for each row execute function private.set_updated_at();
create trigger tenant_members_tenant_immutable before update of tenant_id on public.tenant_members
  for each row execute function private.prevent_tenant_change();

create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  email        text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role_id      uuid not null,
  token        uuid not null unique default gen_random_uuid(),
  invited_by   uuid references auth.users (id) on delete set null default auth.uid(),
  expires_at   timestamptz not null default (now() + interval '7 days'),
  accepted_at  timestamptz,
  created_at   timestamptz not null default now(),
  foreign key (tenant_id, role_id) references public.roles (tenant_id, id) on delete cascade
);
create unique index invitations_pending_email_idx
  on public.invitations (tenant_id, lower(email)) where accepted_at is null;
create trigger invitations_tenant_immutable before update of tenant_id on public.invitations
  for each row execute function private.prevent_tenant_change();
