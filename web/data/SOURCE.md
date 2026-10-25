# Cars example

`cars.json` is the unchanged 406-row input from
[ggaction/chart-datasets, vl_0261](https://github.com/ggaction/chart-datasets/tree/main/charts/vl_0261),
snapshot `0333f33f043f0f18fb1b317333bd7cef61fb39a1`.

Its parsed contents also match the original
[Vega Cars dataset](https://github.com/vega/vega-datasets/blob/main/data/cars.json)
exactly (all 406 rows and 9 columns, including nulls).
Local file SHA-256: `af9e24643751704b580c07454b197229447aa0fe6c8ffe664d63979cec33bd47`.

Original missing values and all rows are retained. Nullable columns remain
available. The native mark policy `missing: "skip"` excludes missing selected
values only from that mark's rendering; the source table stays unchanged.
Source attribution and terms remain those recorded in that repository's
`DATA_SOURCES.md` and chart metadata.

For the ten examples added on 2026-10-25, see [EXAMPLES.md](./EXAMPLES.md)
and the byte-level source and license records in [sources.json](./sources.json).
