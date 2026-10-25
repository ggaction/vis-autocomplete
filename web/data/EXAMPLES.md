# Bundled example datasets

The **Try example dataset** menu has 19 entries: the original nine examples plus
ten added on **2026-10-25**. Data is fetched from this application's own static
assets only when an example is selected. Selecting an example does not contact
its upstream data provider. The ten additions total 537,648 bytes (about 525 KiB)
before compression. No rows were sampled away to make thumbnails.

[`sources.json`](./sources.json) records each added file's source URL, source
revision or archive member, retrieval date, byte-level SHA-256, row count, field
names, terms, and transformations. The data files are runtime assets, not audit
exports. Existing datasets retain their prior corpus attribution; see
[`SOURCE.md`](./SOURCE.md) for Cars.

| Menu name / file | Rows × columns | Useful characteristics | Source and terms |
| --- | ---: | --- | --- |
| Fashion-MNIST t-SNE / `fashion_mnist_tsne.csv` | 498 × 4 | Signed 2-D embedding; 10 garment categories; scatter, density, faceting, and discrete palettes | Exact [legacy example](http://oldvis.autocomplete.studio/data/fashion_mnist_tsne.csv); upstream [Fashion-MNIST](https://github.com/zalandoresearch/fashion-mnist) is MIT. See derivation note below. |
| Palmer penguins / `penguins.json` | 344 × 7 | Four physical measurements, species, island and sex; original missing values | [Palmer penguins via Vega](https://vega.github.io/vega-datasets/datasets/penguins/), CC0-1.0 |
| Wine chemistry / `wine.json` | 178 × 14 | 13 measurements with different ranges and three cultivars; parallel coordinates, radar, correlation | [UCI Wine](https://archive.ics.uci.edu/dataset/109/wine), CC BY 4.0 |
| Glass identification / `glass.json` | 214 × 11 | Nine measurements, six observed class codes, zeros and uneven class sizes | [UCI Glass Identification](https://archive.ics.uci.edu/dataset/42/glass+identification), CC BY 4.0 |
| Daily bike sharing / `bike-sharing.csv` | 731 × 16 | Daily dates, seasonal categories, binary flags, normalized weather measures and rental counts | [UCI Bike Sharing](https://archive.ics.uci.edu/dataset/275/bike+sharing+dataset), CC BY 4.0 |
| US employment / `us-employment.csv` | 120 × 24 | Wide monthly series and positive/negative employment changes | [BLS via Vega](https://vega.github.io/vega-datasets/datasets/us_employment/), U.S. government data (`other-pd`) |
| Unemployment by industry / `unemployment.json` | 1,708 × 6 | 14 time series, dates, count and rate; stacked/normalized areas and many facets | [BLS/CPS via Vega](https://vega.github.io/vega-datasets/datasets/unemployment_across_industries/), U.S. government data (`other-pd`) |
| US budget forecasts / `budgets.json` | 230 × 3 | Observed and forecast years, positive/negative balances, unequal series lengths | [OMB via Vega](https://vega.github.io/vega-datasets/datasets/budgets/), U.S. government data (`other-pd`) |
| US household income / `income.json` | 520 × 6 | Region → state grouping, ten ordered income brackets, percentages and totals | [Census ACS via Vega](https://vega.github.io/vega-datasets/datasets/income/), Census API terms (`other-open`) |
| Global temperature / `global-temp.csv` | 144 × 2 | Annual temperature anomalies with negative and positive values | [NASA GISS via Vega](https://vega.github.io/vega-datasets/datasets/global_temp/), U.S. government data (`other-pd`) |

## Attribution and terms

- **Wine:** Aeberhard, S. & Forina, M. (1992). *Wine* [Dataset]. UCI Machine
  Learning Repository. <https://doi.org/10.24432/C5PC7J>.
- **Glass:** German, B. (1987). *Glass Identification* [Dataset]. UCI Machine
  Learning Repository. <https://doi.org/10.24432/C5WW2P>.
- **Bike sharing:** Fanaee-T, H. (2013). *Bike Sharing* [Dataset]. UCI Machine
  Learning Repository. <https://doi.org/10.24432/C5W894>.
- These three UCI datasets are distributed under
  [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
  The JSON conversion described below is the only modification to Wine and
  Glass; the Bike Sharing daily file is unchanged.
- **Penguins:** collected by Dr. Kristen Gorman and Palmer Station Antarctica
  LTER; distributed through Allison Horst's
  [palmerpenguins](https://github.com/allisonhorst/palmerpenguins) under
  [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- **Fashion-MNIST:** Han Xiao, Kashif Rasul and Roland Vollgraf (2017), Zalando
  Research. The original MIT notice is retained in
  [`fashion-mnist-LICENSE.txt`](./fashion-mnist-LICENSE.txt). The legacy CSV is a
  precomputed t-SNE derivation; that repository does not declare a separate
  license for its embedding and does not document the sample selection or
  t-SNE settings. We retain the exact user-requested legacy asset, not a new
  embedding or a claim that these 498 rows are the complete Fashion-MNIST set.
- **BLS examples:** retrieved from the pinned Vega snapshot on 2026-10-25.
  BLS.gov cannot vouch for the data or analyses derived from these data after
  they have been retrieved from BLS.gov. See
  [BLS terms](https://www.bls.gov/developers/termsOfService.htm).
- **Income:** derived from the U.S. Census Bureau American Community Survey
  3-Year Data (2013). This product uses the Census Bureau Data API but is not
  endorsed or certified by the Census Bureau. See
  [Census API terms](https://www.census.gov/data/developers/about/terms-of-service.html).
- Vega's package code license is **not** assumed to cover every dataset. Terms
  in the table are per-dataset entries from Vega's pinned metadata, reproduced
  in `sources.json` with links to the upstream providers.

## Reproducibility and schema

The six Vega files are byte-for-byte copies of
[`vega/vega-datasets` revision `8daa64c11a2986e8ca7c75d48831bad647173b35`](https://github.com/vega/vega-datasets/tree/8daa64c11a2986e8ca7c75d48831bad647173b35/data).
Only the local filename of `unemployment-across-industries.json` is shortened to
`unemployment.json`; its contents are unchanged.

`fashion_mnist_tsne.csv` is byte-for-byte identical to the public legacy file,
including CRLF line endings and its lack of a terminal newline. The bytes also
match `vis_autocomplete/data/fashion_mnist_tsne.csv` at revision
`d1bfafc380ab7258d1040278e469fc3a49354db4` in the authenticated legacy Git
repository (`https://github.com/hj-n/visualization-autocomplete`), whose remote
revision was verified. Its raw GitHub URL is not public. At retrieval, the
legacy HTTPS endpoint reported a certificate hostname mismatch, so the public
HTTP response was compared with the independently obtained Git snapshot; TLS
verification was not disabled.

Wine and Glass are complete UCI `.data` members, converted from headerless CSV
into JSON objects. Fields follow the UCI variable order (including class/ID);
numeric strings become JSON numbers. `OD280_OD315` is the local readable name
for UCI's OD280/OD315 of diluted wines. Row order and every numeric value are
preserved. `sources.json` records both source-member and converted-file hashes.
Bike Sharing is the exact `day.csv` member, excluding the separate hourly table.

The importer retains raw source values. The menu supplies semantic field-type
hints so integer category codes are not treated as continuous measurements:
Fashion `label`; Wine/Glass `class`; Glass `Id_number`; Income `id`; Bike Sharing
`instant`, `season`, `yr`, `holiday`, and `workingday`. Bike Sharing `mnth`,
`weekday`, and `weathersit`, plus Unemployment `month`, are ordinal. Income
brackets have an explicit low-to-high order, ending in `200000+`. Original
category codes and measurement units are retained. Ordinary ISO dates are
inferred as temporal; numeric years remain quantitative. Schema review can
change these interpretations.

Regression checks in `test/example-datasets.test.js` verify lazy loading and
retry, the ten source checksums and row counts, Fashion's ten classes, missing
penguin measurements, signed values, temporal inference, and category ordering.
