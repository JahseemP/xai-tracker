# XAI SPAM Shipment Tracker

A shipment and manifest tracker for job LA-26-3335 / P1641. It runs as a plain web page (GitHub Pages), and the manifests are stored in Supabase.

## For the team
- Open the site link. No account needed.
- **+ New manifest**: fill in the bill of lading form and click **Send to tracker**.
- **Import PDF**: drop in typed manifest PDFs to pull out the manifest number, date, destination and pieces, then review and add them. Scanned pages have to be typed in.
- Click a manifest to see its pieces or mark it **Received** / **Issue**.
- **Find a piece** shows every manifest a piece shipped on.
- **Export to Excel** downloads everything.
- Saving changes asks for the team passcode once per device.

## Files
- `index.html`: the whole app
- `config.js`: Supabase project URL and anon (public) key
- `pdf.min.js`, `pdf.worker.min.js`: PDF reader (pdf.js, Apache 2.0)

The database setup script (tables, passcode check and starting data) is not stored in this repository, because it contains the team passcode.

## Changing the passcode
In Supabase, open the SQL Editor and run:

```sql
update public.app_secret set passcode = 'new-code' where id = 1;
```

## Raw Steel Yard page

`yard.html` is a separate page (switch with the Shipments / Raw Steel Yard buttons at the top).
It keeps its own data in the `raw_steel` table and does not read or change the manifests.
Run `raw-steel-setup.sql` once in the Supabase SQL Editor to create the table.
Bolts (and units like boxes or kegs) need `add-bolts.sql` run once as well.
The "Received by / Shipped by" column needs `add-received-by.sql` run once (it also includes the bolts columns).

## Fab tracker upload

`fab-tracker-template.xlsx` is the fab tracker. On the Yard Inventory page, **⇪ Upload fab tracker** reads it:
every row whose Status is Fab complete (or Painted / Shipped) subtracts its Qty from that steel Size, once per piece mark
(line id `fab-<piece mark>`), so re-uploading is safe. A piece switched back to an earlier status is added back.
The upload also reads the project trackers (DRY_Cooler: Piece Mark / Main Material / Qty with QC-Galv-Ship stages;
SPAM: DH / Piece mark / Size with a Fab complete date and Raw source). Only SOLC-sourced pieces in sizes the yard
stocks, fab complete on/after the start date (saved in app_settings `fab-import`), are counted.
Run `add-fab-batch.sql` once so big uploads save in batches.
Drops: each fab piece is cut from the shortest bar or drop of that size that fits (or the tracker's Raw Stock Length);
what's left (minus a 1/8" kerf) goes back to the yard as a drop if it's 5 ft or longer, otherwise it's scrap.

## Excel "Update app" button

`fab-tracker.xlsm` (JP Fab Tracker) has an **Update app** macro button. It sends every fab-complete row
(Fab complete on/after 11/22/26) as one JSON "feed" to `app_settings` id `fab-feed-<sheet>` via the
`save_setting` RPC (team passcode, saved in a very-hidden AppSettings sheet). The Yard Inventory page works out
FAB / DROP lines from all feeds on every load, so sending again simply replaces the previous send.
Uploading a tracker file in the app saves the same kind of feed.
