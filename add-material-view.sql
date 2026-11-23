-- Lets the Excel tracker's "Refresh material" button read every tracker's fab-complete pieces. Safe to run more than once.
create or replace view public.yard_feed_rows as
select substr(s.id, 10) as sk,
       s.data->>'sheet' as sheet,
       r.ord::int as ord,
       r.v->>0 as area, r.v->>1 as mark, r.v->>2 as size, r.v->>3 as len, r.v->>4 as raw,
       r.v->>5 as qty, r.v->>6 as fab_date, r.v->>8 as line
from public.app_settings s
cross join lateral jsonb_array_elements(s.data->'rows') with ordinality as r(v, ord)
where s.id like 'fab-feed-%';

grant select on public.yard_feed_rows to anon, authenticated;
