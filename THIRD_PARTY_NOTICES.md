# Third-party material and provenance

The root [Apache-2.0 license](LICENSE) covers original VisAutocomplete material. It does not replace any license or notice attached to a dependency, dataset, chart, font, or other third-party work. This inventory is a guide to those boundaries, not a blanket clearance of every upstream dataset.

## Source dependencies

| Component | License | Canonical notice |
| --- | --- | --- |
| ggaction | MIT | [vendor/ggaction/LICENSE](vendor/ggaction/LICENSE) |
| @ggaction/transition | MIT | [vendor/transition/LICENSE](vendor/transition/LICENSE) |
| @napi-rs/canvas | MIT package metadata; native components have their own notices | Installed package and [upstream repository](https://github.com/Brooooooklyn/canvas) |
| @supabase/supabase-js | MIT | Installed package and [upstream repository](https://github.com/supabase/supabase-js) |
| Acorn | MIT | Installed package and [upstream repository](https://github.com/acornjs/acorn) |
| SheetJS Community Edition (`xlsx`) | Apache-2.0 | Installed `xlsx/LICENSE` and [upstream source](https://git.sheetjs.com/sheetjs/sheetjs) |

[package-lock.json](package-lock.json) records installed dependency versions, including transitive packages. Inspect their shipped LICENSE/NOTICE files when distributing a bundle or container; the direct-dependency table is not an exhaustive transitive-license report. Build tools may emit accompanying `.LEGAL.txt` files: retain them with the bundles. Operating-system packages and fonts in the Docker image have their own notices.

## Example datasets

- [web/data/SOURCE.md](web/data/SOURCE.md) records the original Cars source and snapshot.
- [web/data/sources.json](web/data/sources.json) records sources, checksums, transformations, and available per-dataset terms.
- [web/data/EXAMPLES.md](web/data/EXAMPLES.md) explains the ten additional examples and their provenance.
- [Fashion-MNIST's upstream MIT notice](web/data/fashion-mnist-LICENSE.txt) is retained. The legacy t-SNE derivative has no separate license declaration in its source record; do not treat the upstream image-data license as proof that every derivative right is resolved.

The older Cars/Tips/Iris/Weather/Stocks/Gapminder/Barley/Electricity records rely on upstream chart-corpus attribution rather than a complete local license record. This document does not newly license them. Follow each original provider's terms and resolve missing rights information before a redistribution that requires it.

## Corpus, models, and fixtures

The upstream [chart-datasets repository](https://github.com/ggaction/chart-datasets) licenses its viewer/tooling under MIT while preserving separate terms for third-party chart specifications, data, and rendered derivatives. Its [DATA_SOURCES.md](https://github.com/ggaction/chart-datasets/blob/main/DATA_SOURCES.md) explicitly does not assert a corpus-wide license for those materials.

Checked-in `data/` artifacts are trained/extracted from that corpus. Their provenance and exact revisions are in [corpus-report.json](data/corpus-report.json), [initial-corpus-report.json](data/initial-corpus-report.json), and [model-manifest.json](data/model-manifest.json). Corpus-derived content and examples are excluded from any blanket relicensing claim. The app's training code being Apache-2.0 does not by itself settle rights in all training inputs or derived artifacts.

The same upstream boundaries apply to [test corpus fixtures](test/fixtures/corpus/README.md). Do not copy arbitrary web datasets into tests without source and license records.

## Reuse and attribution

Preserve existing copyright and license notices. When adding material, record its origin, exact terms, transformations, and checksum. When removing a dependency, only remove its notices after confirming no shipped code/assets still contain it. See the [licensing guide](docs/licensing.md) for the distinction between original code, contributions, and commercial distribution.
