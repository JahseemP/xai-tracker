-- Raw Steel Yard: its own table, separate from the manifests.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists public.raw_steel (
  id text primary key,
  rec_date date not null,
  size text not null,
  length text not null default '',
  qty integer not null default 0,
  lbs_each numeric,
  ref text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.raw_steel enable row level security;
drop policy if exists "read raw steel" on public.raw_steel;
create policy "read raw steel" on public.raw_steel for select using (true);
grant select on public.raw_steel to anon, authenticated;

create or replace function public.save_raw_steel(p_code text, p_row jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.check_passcode(p_code) then raise exception 'wrong passcode'; end if;
  insert into public.raw_steel (id, rec_date, size, length, qty, lbs_each, ref, notes, updated_at)
  values (p_row->>'id', (p_row->>'rec_date')::date, coalesce(p_row->>'size',''), coalesce(p_row->>'length',''),
          coalesce((p_row->>'qty')::integer, 0), nullif(p_row->>'lbs_each','')::numeric,
          coalesce(p_row->>'ref',''), coalesce(p_row->>'notes',''), now())
  on conflict (id) do update set rec_date = excluded.rec_date, size = excluded.size, length = excluded.length,
    qty = excluded.qty, lbs_each = excluded.lbs_each, ref = excluded.ref, notes = excluded.notes, updated_at = now();
end $$;

create or replace function public.delete_raw_steel(p_code text, p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.check_passcode(p_code) then raise exception 'wrong passcode'; end if;
  delete from public.raw_steel where id = p_id;
end $$;

grant execute on function public.save_raw_steel(text, jsonb), public.delete_raw_steel(text, text) to anon, authenticated;

-- Starting data: the raw beams received at the Walls yard on 10/28 (manifests 0041-0043).
-- Delete these lines before running if you'd rather start empty.
insert into public.raw_steel (id, rec_date, size, length, qty, lbs_each, ref) values
  ('seed-1028-1', '2026-10-28', 'W21x48', '40''', 18, 1920, 'MAN-LA-26-3335-0041'),
  ('seed-1028-2', '2026-10-28', 'W21x48', '60''', 12, 2880, 'MAN-LA-26-3335-0042'),
  ('seed-1028-3', '2026-10-28', 'W21x48', '50''', 4, 2400, 'MAN-LA-26-3335-0043'),
  ('seed-1028-4', '2026-10-28', 'W21x48', '60''', 6, 2880, 'MAN-LA-26-3335-0043')
on conflict (id) do nothing;
