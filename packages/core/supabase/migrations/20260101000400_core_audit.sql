-- =============================================================================
-- core 0004 Audit log: who changed what, when, with before/after snapshots.
--
--   * One generic trigger function serves every table. Enable it with
--       select private.enable_audit('public.my_table');
--     (optional 2nd/3rd args: tenant column, primary-key column).
--   * Rows are written by a SECURITY DEFINER trigger, so clients can read
--     (with audit.view) but never insert, edit or delete history.
--   * UPDATEs that change nothing but updated_at are skipped; only the
--     changed columns are listed in `changed`.
--   * No foreign key to tenants: history must survive the rows it describes,
--     and a cascading tenant delete would otherwise fail mid-way.
-- =============================================================================

create table public.audit_log (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null,
  table_name   text not null,
  record_id    text not null,
  action       text not null check (action in ('insert', 'update', 'delete')),
  actor_id     uuid,
  actor_email  text,
  changed      text[] not null default '{}',
  old_data     jsonb,
  new_data     jsonb,
  created_at   timestamptz not null default now()
);
create index audit_log_tenant_created_idx on public.audit_log (tenant_id, created_at desc);
create index audit_log_record_idx on public.audit_log (tenant_id, table_name, record_id);

comment on table public.audit_log is
  'Append-only change history written by private.audit_trigger(). Readable with the audit.view permission.';

create function private.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_col text := coalesce(tg_argv[0], 'tenant_id');
  v_id_col     text := coalesce(tg_argv[1], 'id');
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[] := '{}';
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}')
      into v_changed
    from jsonb_each(v_new) n
    where n.key <> 'updated_at'
      and n.value is distinct from v_old -> n.key;
    if cardinality(v_changed) = 0 then
      return null;
    end if;
  end if;

  insert into public.audit_log
    (tenant_id, table_name, record_id, action, actor_id, actor_email, changed, old_data, new_data)
  values (
    (v_row ->> v_tenant_col)::uuid,
    tg_table_name,
    coalesce(v_row ->> v_id_col, ''),
    lower(tg_op),
    nullif(v_claims ->> 'sub', '')::uuid,
    v_claims ->> 'email',
    v_changed,
    v_old,
    v_new
  );
  return null;
end;
$$;

-- Attach the audit trigger to a table (idempotent).
create function private.enable_audit(
  p_table regclass,
  p_tenant_column text default 'tenant_id',
  p_id_column text default 'id'
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_name text := (select c.relname from pg_catalog.pg_class c where c.oid = p_table);
begin
  execute format('drop trigger if exists %I on %s', 'audit_' || v_name, p_table);
  execute format(
    'create trigger %I after insert or update or delete on %s '
    'for each row execute function private.audit_trigger(%L, %L)',
    'audit_' || v_name, p_table, p_tenant_column, p_id_column
  );
end;
$$;

revoke all on function private.enable_audit(regclass, text, text) from public, anon, authenticated;

select private.enable_audit('public.tenants', 'id', 'id');
select private.enable_audit('public.roles');
select private.enable_audit('public.role_permissions', 'tenant_id', 'role_id');
select private.enable_audit('public.tenant_members', 'tenant_id', 'user_id');
select private.enable_audit('public.invitations');
