# VisAutocomplete

**Build your chart, one step at a time.**

VisAutocomplete is an interactive visualization editor that recommends what to do next. Start with your data, compare chart and action previews, adjust their parameters, and apply the changes you want. Each step produces editable [ggaction](https://github.com/ggaction/ggaction) code and a history you can revisit.

[Try the app](https://vis.autocomplete.studio/) · [Contribute](CONTRIBUTING.md) · [Developer guide](docs/development.md) · [Documentation](docs/README.md) · [Report a bug](https://github.com/ggaction/vis-autocomplete/issues/new/choose)

[![VisAutocomplete: explore chart recommendations, preview changes, and build your chart step by step.](web/social/link-preview-v2.png)](https://vis.autocomplete.studio/)

## Try it in a minute

1. Open [VisAutocomplete](https://vis.autocomplete.studio/) and choose **Try without account**, or sign in to save and manage projects.
2. Upload a CSV, JSON, or Excel `.xlsx` file, or choose an example dataset. Select the columns you want to explore; you do not need to assign X, Y, and Color first.
3. Hover an option card to preview its chart. Explore the card's parameters, then click **Apply** to keep the change.
4. Keep building: change encodings, add statistics, combine charts, edit text, or revisit a step in History.

Hovering explores; **Apply commits**. Direct edits also become undoable history steps. Guest drafts stay in the browser; signing in enables private cloud projects. See the [privacy notice](https://vis.autocomplete.studio/privacy.html) for optional research collection and data handling.

## What you can build

- **Explore beyond standard charts.** Recommendations cover scatter, bar, line, area, box, violin, beeswarm, heatmap, polar, radar, parallel coordinates, and other supported chart families.
- **Compare concrete next steps.** Encoding, Transform, and Style cards expose editable parameters. Search for a specific action when you know what you want.
- **Combine views.** Layer charts, add overlays that follow existing results, facet by a field, or place charts beside one another with compatible shared scales.
- **Edit directly.** Resize charts and guides, move titles and legends, edit categorical text in place, and undo or redo your changes.
- **Keep the authoring process.** Switch between Linear and Graph History, inspect generated ggaction code, and export PNG, SVG, or PDF.
- **Choose your preview.** Transition mode animates the current view to a candidate; Preview mode keeps current and candidate views separate.

The recommender uses a checked-in chart corpus model and chart compatibility rules. It does **not** call an online LLM while you author a chart. This implementation builds on the paper below, but its ggaction-based runtime and model are not the original paper artifact.

## Start developing

Use **Git and Node.js 22**; CI's exact version is recorded in [.nvmrc](.nvmrc). The app consumes two pinned source submodules, so clone recursively:

```sh
git clone --recurse-submodules https://github.com/ggaction/vis-autocomplete.git
cd vis-autocomplete
npm ci
npm run demo:quickstart
```

The quickstart uses a tiny synthetic dataset and the checked-in recommendation model. It prints actual ggaction actions and writes two SVGs to `output/quickstart/`. It needs **no account, Supabase project, API key, or corpus download**.

For an existing checkout, initialize the dependencies with `git submodule update --init --recursive`. A GitHub ZIP download does not include their source.

To work on the browser UI, follow the [local editor setup](docs/development.md#run-the-editor). Authentication is part of the app: starting a server without Supabase configuration deliberately does not unlock the editor. The guide includes a separate development Supabase setup and credential-free browser tests using a mocked authentication transport.

Useful first checks:

```sh
npm run check:docs
npm run catalog:check
node --test test/model.test.js test/project.test.js
npm run build
```

Full regression, browser, corpus, and library checks are documented in the [developer guide](docs/development.md#choose-the-right-checks). Retraining the corpus is not part of ordinary setup.

## Contribute

You can help with a reproducible bug report, documentation, keyboard and accessibility testing, difficult chart combinations, performance measurements, or code. You do not need to understand the whole codebase to start.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for a first-PR walkthrough, review expectations, and where a change belongs. Browse [issues](https://github.com/ggaction/vis-autocomplete/issues), or describe a small task you would like to take on. English is used for public contribution documents and new documentation.

| Where | What belongs there |
| --- | --- |
| This repository | Recommendations, option cards, editor interaction, history, accounts, and research logging |
| [ggaction](https://github.com/ggaction/ggaction) | Public chart actions, rendering, inspection, types, and chart semantics |
| [@ggaction/transition](https://github.com/ggaction/transition) | Interruptible Canvas/SVG scene playback |
| [chart-datasets](https://github.com/ggaction/chart-datasets) | Upstream chart corpus and source provenance |

Each recommendation invokes one actual public ggaction function. New chart capabilities belong in the library, with types, tests, inspection metadata, and documentation—not in an app-only substitute. See the [architecture guide](docs/architecture.md).

Please use [private security reporting](SECURITY.md) for vulnerabilities. Participation follows our [Code of Conduct](CODE_OF_CONDUCT.md).

## Research and credits

This tool builds on:

- **[Visualization Autocomplete: Visualization Authoring via Stepwise Design Recommendations](https://arxiv.org/abs/2607.15608)** — Hyeon Jeon, Sungbok Shin, and Niklas Elmqvist. *Transactions on Visualization and Computer Graphics (TVCG, Proc. VIS 2026).* The [legacy version for our academic paper](https://oldvis.autocomplete.studio/) remains separate from this application.
- **[ggaction: A Grammar of Graphical Actions](https://arxiv.org/abs/2609.14353)** — Hyeon Jeon and Jinwook Seo. *arXiv.*

See [CITATION.cff](CITATION.cff) for machine-readable citation information. When reporting results, include the software release or commit and the model provenance; a current app run is not automatically a reproduction of the paper's evaluation.

| Contributor | Affiliation |
| --- | --- |
| Hyeon Jeon | Aarhus University |
| Sungbok Shin | Sogang University |
| Jinwook Seo | Seoul National University |
| Niklas Elmqvist | Aarhus University |

We welcome contributions from the wider community. Git history records code and documentation contributions; paper authorship is separate.

## License and commercial use

Original code and documentation in this repository are licensed under [Apache-2.0](LICENSE), except where another license is explicitly recorded. You may use, modify, distribute, and use this software commercially under those terms. The maintainers may also offer commercial products or hosted services. Contributions use the same license, without a separate CLA or copyright assignment.

The license does not grant trademark rights or ownership of anyone's data. The ggaction and transition submodules retain their MIT licenses. Example datasets, corpus-derived artifacts, and third-party dependencies have separate provenance and terms: read [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the [licensing guide](docs/licensing.md).
