# UK Fuel Map

A zoomable map of UK fuel stations with prices from the GOV.UK Fuel Finder CSV,
coloured by whether each site is on your UK Fuels list.

- **Map:** https://harries2000-prog.github.io/uk-fuel-map/
- **Admin (upload new data):** https://harries2000-prog.github.io/uk-fuel-map/admin.html

## Updating prices

1. On the Fuel Finder page, click **Download the CSV file**
   (https://www.developer.fuel-finder.service.gov.uk/fuel-finder/access-latest-fuelprices).
2. Open the Admin page, choose the downloaded `UpdatedFuelPrice-….csv` and press **Publish**.
3. The map shows the new prices about a minute later.

## UK Fuels list

Upload it on the Admin page too. It needs a heading row; recognised columns:

| Column | Needed? | Notes |
|---|---|---|
| `Postcode` | yes | matched to the Fuel Finder station's postcode |
| `Site name` | optional | helps when two stations share a postcode |
| `Surcharge` | optional | shown in the station popup as written |
| `HGV` | optional | `No` → red; anything else → green |
| `node_id` | optional | exact Fuel Finder station ID (shown in each popup) |

## Files

- `docs/index.html` – the map
- `docs/admin.html` – upload page
- `docs/convert.js` – turns the Fuel Finder CSV into `docs/data/stations.json`
- `docs/ukfuels.csv` – your UK Fuels list

Data: GOV.UK Fuel Finder (Open Government Licence v3.0). Map © OpenStreetMap contributors.
