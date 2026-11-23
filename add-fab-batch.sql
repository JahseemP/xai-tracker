-- Lets the fab tracker upload save hundreds of pieces at once (much faster). Safe to run more than once.
create or replace function public.save_yard_items(p_code text, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.check_passcode(p_code) then raise exception 'wrong passcode'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.raw_steel (id, rec_date, item_type, size, length, qty, unit, lbs_each, ref, notes, by_name, updated_at)
    values (r->>'id', (r->>'rec_date')::date, coalesce(nullif(r->>'item_type',''),'steel'),
            coalesce(r->>'size',''), coalesce(r->>'length',''),
            coalesce((r->>'qty')::integer, 0), coalesce(nullif(r->>'unit',''),'pcs'),
            nullif(r->>'lbs_each','')::numeric, coalesce(r->>'ref',''), coalesce(r->>'notes',''),
            coalesce(r->>'by_name',''), now())
    on conflict (id) do update set rec_date = excluded.rec_date, item_type = excluded.item_type, size = excluded.size,
      length = excluded.length, qty = excluded.qty, unit = excluded.unit, lbs_each = excluded.lbs_each,
      ref = excluded.ref, notes = excluded.notes, by_name = excluded.by_name, updated_at = now();
  end loop;
end $$;

create or replace function public.delete_yard_items(p_code text, p_ids text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.check_passcode(p_code) then raise exception 'wrong passcode'; end if;
  delete from public.raw_steel where id = any(p_ids);
end $$;

grant execute on function public.save_yard_items(text, jsonb), public.delete_yard_items(text, text[]) to anon, authenticated;
