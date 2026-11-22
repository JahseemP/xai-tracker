-- Adds bolts (and units like boxes/kegs) to the Yard Inventory page.
-- Safe to run more than once. Existing raw steel stays as raw steel.
alter table public.raw_steel add column if not exists item_type text not null default 'steel';
alter table public.raw_steel add column if not exists unit text not null default 'pcs';

create or replace function public.save_yard_item(p_code text, p_row jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.check_passcode(p_code) then raise exception 'wrong passcode'; end if;
  insert into public.raw_steel (id, rec_date, item_type, size, length, qty, unit, lbs_each, ref, notes, updated_at)
  values (p_row->>'id', (p_row->>'rec_date')::date, coalesce(nullif(p_row->>'item_type',''),'steel'),
          coalesce(p_row->>'size',''), coalesce(p_row->>'length',''),
          coalesce((p_row->>'qty')::integer, 0), coalesce(nullif(p_row->>'unit',''),'pcs'),
          nullif(p_row->>'lbs_each','')::numeric, coalesce(p_row->>'ref',''), coalesce(p_row->>'notes',''), now())
  on conflict (id) do update set rec_date = excluded.rec_date, item_type = excluded.item_type, size = excluded.size,
    length = excluded.length, qty = excluded.qty, unit = excluded.unit, lbs_each = excluded.lbs_each,
    ref = excluded.ref, notes = excluded.notes, updated_at = now();
end $$;

grant execute on function public.save_yard_item(text, jsonb) to anon, authenticated;
