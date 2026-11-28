-- Fab Tracker page: one row per piece. Run once in Supabase (SQL Editor -> New query -> paste -> Run).
create table if not exists public.fab_pieces (
  id text primary key,
  project text not null,
  sort double precision not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fab_pieces_project on public.fab_pieces (project, sort);

alter table public.fab_pieces enable row level security;
drop policy if exists "read fab pieces" on public.fab_pieces;
create policy "read fab pieces" on public.fab_pieces for select using (true);
grant select on public.fab_pieces to anon, authenticated;

-- Saves many pieces at once. Each row: {id, project, sort, patch:{field: value, ...}} - only the changed fields
-- are merged in, so two people editing different cells of the same piece don't overwrite each other.
create or replace function public.save_fab_pieces(p_code text, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.check_passcode(p_code) then raise exception 'wrong passcode'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.fab_pieces (id, project, sort, data, updated_at)
    values (r->>'id', coalesce(r->>'project', ''), coalesce((r->>'sort')::double precision, 0), coalesce(r->'patch', '{}'::jsonb), now())
    on conflict (id) do update set
      project = coalesce(r->>'project', fab_pieces.project),
      sort = coalesce((r->>'sort')::double precision, fab_pieces.sort),
      data = fab_pieces.data || coalesce(r->'patch', '{}'::jsonb),
      updated_at = now();
  end loop;
end $$;

create or replace function public.delete_fab_pieces(p_code text, p_ids text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.check_passcode(p_code) then raise exception 'wrong passcode'; end if;
  delete from public.fab_pieces where id = any(p_ids);
end $$;

grant execute on function public.save_fab_pieces(text, jsonb), public.delete_fab_pieces(text, text[]) to anon, authenticated;
