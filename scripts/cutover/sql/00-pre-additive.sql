-- ============================================================================
-- Production schema alignment — runs FIRST inside 03-apply-additive.sh's single
-- transaction, before migration 2.
--
-- The migrations (and every test of them) assume the schema of migration 1:
--   splits.id / members.id / members.split_id = text,  splits.event_at = timestamptz.
-- Production was created differently (captured 2026-10-03):
--   uuid ids, event_at stored as text — 295/295 values shaped 'YYYY-MM-DDTHH:MM:SS.sssZ'.
-- Migration 2 cannot be created on that schema (text↔uuid foreign keys and comparisons,
-- text vs timestamptz return types), so the types are aligned here first.
--
-- Data is preserved exactly: a fingerprint of every row (ids as text, event instant,
-- all other columns) is taken before the change and compared after it; any difference
-- raises an error and the whole transaction rolls back. Each conversion only runs when
-- the column still has the old type, so this file is a no-op on gatta-test / local
-- databases built from migration 1, and safe to re-run.
--
-- The old site keeps working on the aligned schema: it sends uuid strings for ids and
-- UTC ISO strings for event_at, both accepted by text / timestamptz columns.
-- Not changed: splits.fee_per_person stays integer (only ever 0), members.name stays
-- nullable, the extra columns members.added_by_organizer / splits.organizer_id stay.
-- ============================================================================

-- Migration 2 reads splits.bank_name / iban (present on production; added here if missing).
alter table splits add column if not exists bank_name text;
alter table splits add column if not exists iban text;

do $$
declare
  v_event_type text;
  v_split_id_type text;
  v_member_id_type text;
  v_member_split_type text;
  v_bad int;
  v_fk record;
  fp_splits_before text; fp_members_before text;
  fp_splits_after text;  fp_members_after text;
  -- event_at is fingerprinted as its instant (epoch ms), so text '...Z' and the converted timestamptz compare equal
  q_splits constant text := $q$select md5(coalesce(string_agg(concat_ws('|', id::text, title, total::text, people::text,
      fee_per_person::text, (extract(epoch from event_at::timestamptz) * 1000)::bigint::text, created_at::text,
      coalesce(bank_name, '<null>'), coalesce(iban, '<null>')), E'\n' order by id::text), '')) from splits$q$;
  q_members constant text := $q$select md5(coalesce(string_agg(concat_ws('|', id::text, split_id::text,
      coalesce(name, '<null>'), paid::text, created_at::text), E'\n' order by id::text), '')) from members$q$;
begin
  select data_type into v_event_type from information_schema.columns
    where table_schema = 'public' and table_name = 'splits' and column_name = 'event_at';
  select data_type into v_split_id_type from information_schema.columns
    where table_schema = 'public' and table_name = 'splits' and column_name = 'id';
  select data_type into v_member_id_type from information_schema.columns
    where table_schema = 'public' and table_name = 'members' and column_name = 'id';
  select data_type into v_member_split_type from information_schema.columns
    where table_schema = 'public' and table_name = 'members' and column_name = 'split_id';

  if v_event_type = 'timestamp with time zone' and v_split_id_type = 'text'
     and v_member_id_type = 'text' and v_member_split_type = 'text' then
    raise notice 'schema already aligned — nothing to convert';
    return;
  end if;

  -- Refuse anything not exactly understood, before touching a single column.
  if v_event_type not in ('text', 'timestamp with time zone') then
    raise exception 'schema_alignment_unexpected: splits.event_at is %', v_event_type;
  end if;
  if v_split_id_type not in ('uuid', 'text') or v_member_id_type not in ('uuid', 'text')
     or v_member_split_type not in ('uuid', 'text') then
    raise exception 'schema_alignment_unexpected: id types splits.id=% members.id=% members.split_id=%',
      v_split_id_type, v_member_id_type, v_member_split_type;
  end if;
  if v_event_type = 'text' then
    select count(*) into v_bad from splits
      where event_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$';
    if v_bad > 0 then
      raise exception 'schema_alignment_unexpected: % splits.event_at values are not UTC ISO-8601 (…Z); refusing to guess a timezone', v_bad;
    end if;
  end if;

  execute q_splits into fp_splits_before;
  execute q_members into fp_members_before;

  if v_event_type = 'text' then
    alter table splits alter column event_at type timestamptz using event_at::timestamptz;
    raise notice 'splits.event_at: text → timestamptz';
  end if;

  if v_split_id_type = 'uuid' or v_member_id_type = 'uuid' or v_member_split_type = 'uuid' then
    -- every foreign key from members to splits is dropped and re-created identically (ON DELETE CASCADE kept)
    for v_fk in
      select con.conname from pg_constraint con
      where con.conrelid = 'public.members'::regclass and con.contype = 'f' and con.confrelid = 'public.splits'::regclass
    loop
      execute format('alter table public.members drop constraint %I', v_fk.conname);
    end loop;

    alter table splits alter column id drop default;
    alter table splits alter column id type text using id::text;
    alter table splits alter column id set default gen_random_uuid()::text;

    alter table members alter column id drop default;
    alter table members alter column id type text using id::text;
    alter table members alter column id set default gen_random_uuid()::text;
    alter table members alter column split_id type text using split_id::text;

    alter table members add constraint members_split_id_fkey
      foreign key (split_id) references splits(id) on delete cascade;
    raise notice 'splits.id, members.id, members.split_id: uuid → text (foreign key re-created with ON DELETE CASCADE)';
  end if;

  execute q_splits into fp_splits_after;
  execute q_members into fp_members_after;
  if fp_splits_after is distinct from fp_splits_before or fp_members_after is distinct from fp_members_before then
    raise exception 'schema_alignment_data_mismatch: row fingerprint changed — rolling back';
  end if;
  raise notice 'row fingerprints identical before and after alignment (splits %, members %)',
    left(fp_splits_after, 8), left(fp_members_after, 8);
end
$$;
