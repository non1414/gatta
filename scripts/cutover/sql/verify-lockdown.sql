-- Read-only verification of the final (locked) state. One row per check: name | ok | detail.
-- Used by 04-apply-lockdown.sh and 05-repair-and-status.sh status.
with allowed(fn) as (
  values ('claim_seat_by_code'), ('create_split'), ('get_split'), ('join_split'), ('report_transfer'), ('retract_report')
),
-- trigger / event-trigger functions are excluded: Postgres refuses to call them directly
-- ("trigger functions can only be called as triggers"), so they are not an entry point.
fns as (
  select p.oid, p.proname::text as proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
),
anon_open as (select distinct proname from fns where has_function_privilege('anon', oid, 'execute')),
required_tables(t) as (
  values ('splits'), ('members'), ('create_requests'), ('join_requests'), ('rate_limits'), ('claim_codes'), ('manage_sessions')
)
select 'public key can execute exactly the 6 public functions' as check_name,
       (select coalesce(array_agg(proname order by proname), '{}') from anon_open)
         = (select array_agg(fn order by fn) from allowed) as ok,
       'executable by anon: ' || coalesce((select string_agg(proname, ', ' order by proname) from anon_open), '(none)') as detail
union all
select 'no function is executable by the authenticated role',
       not exists (select 1 from fns where has_function_privilege('authenticated', oid, 'execute')),
       coalesce((select string_agg(distinct proname, ', ') from fns where has_function_privilege('authenticated', oid, 'execute')), '(none)')
union all
select 'public key has no direct privilege on any table',
       not exists (
         select 1 from pg_tables t, unnest(array['anon','authenticated']) r, unnest(array['select','insert','update','delete']) priv
         where t.schemaname = 'public' and has_table_privilege(r, format('public.%I', t.tablename), priv)),
       coalesce((select string_agg(distinct t.tablename::text, ', ')
                 from pg_tables t, unnest(array['anon','authenticated']) r, unnest(array['select','insert','update','delete']) priv
                 where t.schemaname = 'public' and has_table_privilege(r, format('public.%I', t.tablename), priv)), '(none)')
union all
select 'row level security is enabled on all 7 tables',
       (select count(*) from required_tables rt join pg_class c on c.relname = rt.t
          join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' where c.relrowsecurity) = 7,
       'enabled on: ' || coalesce((select string_agg(c.relname::text, ', ' order by c.relname) from required_tables rt join pg_class c on c.relname = rt.t
          join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' where c.relrowsecurity), '(none)')
union all
select 'server role keeps full access (admin functions + manage_sessions)',
       has_function_privilege('service_role', 'public.admin_verify_manage_token(text, text)', 'execute')
         and has_function_privilege('service_role', 'public.admin_rotate_manage_token(text, text, uuid)', 'execute')
         and has_table_privilege('service_role', 'public.manage_sessions', 'select')
         and has_table_privilege('service_role', 'public.members', 'select'),
       ''
union all
select 'every pre-existing split is legacy (read-only) with total_halalas filled',
       not exists (select 1 from splits where manage_token_hash is null and total_halalas is null),
       (select count(*) from splits where manage_token_hash is null) || ' legacy splits, '
         || (select count(*) from splits where manage_token_hash is not null) || ' new-style splits'
union all
select 'legacy member statuses match the old paid/name columns',
       not exists (
         select 1 from members m join splits s on s.id = m.split_id
         where s.manage_token_hash is null and m.status <> case
           when m.paid then 'legacy_paid'
           when coalesce(trim(m.name), '') <> '' then 'joined'
           else 'empty' end),
       (select count(*) from members m join splits s on s.id = m.split_id where s.manage_token_hash is null and m.status = 'legacy_paid')
         || ' legacy_paid, '
         || (select count(*) from members m join splits s on s.id = m.split_id where s.manage_token_hash is null and m.paid) || ' paid in old column';
