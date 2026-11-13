# UK Fuel Map

A zoomable map of every UK fuel station, with current prices from the GOV.UK Fuel Finder API,
coloured by whether the site is on your UK Fuels list.

- **Green** – on your UK Fuels list
- **Amber** – not on your UK Fuels list
- **Red** – on your list but marked as not taking HGVs
- **Grey** – temporarily closed (hidden by default)

## How it updates

A GitHub Action (`.github/workflows/update-map.yml`) runs twice a day (about 05:17 and 13:17 UTC),
whenever anything is pushed to `main`, or on demand from **Actions → Update fuel map → Run workflow**.
It downloads all stations and prices and republishes the map on GitHub Pages.
If the API fails, the job stops and the previous map stays live.

## Fuel Finder keys

Add these under **Settings → Secrets and variables → Actions → New repository secret**:

- `FF_CLIENT_ID`
- `FF_CLIENT_SECRET`

## Updating the UK Fuels list

Replace `docs/ukfuels.csv` (on GitHub: open the `docs` folder → **Add file → Upload files** → drop in a file
called `ukfuels.csv` → **Commit changes**). The map rebuilds within a few minutes.

The file needs a heading row. Recognised columns (any order, extra columns are ignored):

| Column | Needed? | Notes |
|---|---|---|
| `Postcode` | yes | used to match the site to a Fuel Finder station |
| `Site name` | optional | helps when two stations share a postcode |
| `Surcharge` | optional | shown in the station popup as written |
| `HGV` | optional | `No` / `N` → red. Anything else → green |
| `node_id` | optional | exact Fuel Finder ID (shown in each popup) to fix stubborn matches |

You can also load a list straight into the page with **Load a different list** – that copy is only
remembered in the browser you loaded it in.

Data: GOV.UK Fuel Finder, Open Government Licence v3.0. Map © OpenStreetMap contributors.
UK outline: Natural Earth (public domain).
