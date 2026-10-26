# Contributing to VisAutocomplete

Thank you for helping make visualization authoring more approachable. Bug reports, examples, documentation, accessibility reviews, and code are all valuable. Small, focused contributions are welcome.

## Find a place to start

- **Found a bug?** Open a [bug report](https://github.com/ggaction/vis-autocomplete/issues/new?template=bug_report.yml) with a minimal reproduction. A public example dataset and a few actions are often enough.
- **Something feels slow?** Include the chart size, history length, browser, view mode, and the interaction that stalls. Separate cold startup from repeated use.
- **Have an idea?** Describe the authoring task and expected result in a [feature proposal](https://github.com/ggaction/vis-autocomplete/issues/new?template=feature_request.yml). Discuss large changes before implementing them.
- **Improving documentation or data examples?** Use the [documentation/data form](https://github.com/ggaction/vis-autocomplete/issues/new?template=documentation.yml), or send a small PR directly.
- **Need a first task?** Look for `good first issue` or `help wanted` when available, or ask in an issue. Maintainers can help identify a bounded change; these labels are not a prerequisite.

Report vulnerabilities privately through [SECURITY.md](SECURITY.md). Do not put access tokens, private datasets, participant information, or production logs in issues or screenshots.

## Your first pull request

1. Fork the repository, then clone your fork with `--recurse-submodules`. During the private preparation period, access requires a maintainer invitation.
2. Follow [development setup](docs/development.md). Start with `npm run demo:quickstart` or a focused test; neither needs cloud credentials.
3. Create a descriptive branch, such as `fix/legend-layout` or `docs/keyboard-guide`.
4. Make one coherent change. Match nearby code conventions; avoid unrelated formatting, dependency updates, or generated files.
5. Run the checks relevant to your change. Explain what you verified and what you could not test. Include before/after screenshots or a short recording for visible behavior.
6. Open a PR against `main`, link the issue if there is one, and complete the PR template. Draft PRs are welcome when you need design feedback.

A useful PR explains the problem, resulting behavior, and evidence. No particular commit-message format or signed-commit setup is required. If using AI tools, review and understand their output, verify the result, and disclose material assistance in the PR. You remain responsible for the contribution and its provenance.

## Choose the right repository

| Change | Start here |
| --- | --- |
| Candidate generation, grouping, search, defaults, or ranking | `src/` |
| Cards, previews, history, direct manipulation, or imports | `web/` |
| Account state, consent, persistence, or reporting | `web/cloud/`, `web/research/`, `supabase/` |
| A new public chart action or incorrect native chart rendering | `vendor/ggaction` / [ggaction](https://github.com/ggaction/ggaction) |
| Scene interpolation, interruption, clipping, or playback resources | `vendor/transition` / [transition](https://github.com/ggaction/transition) |
| Dataset provenance or source chart additions | [chart-datasets](https://github.com/ggaction/chart-datasets) |

Read [AGENTS.md](AGENTS.md), the [architecture guide](docs/architecture.md), and any scoped instructions for files you change. In `vendor/ggaction`, follow its own instructions. For an unresolved public API or persisted-schema design, propose the exact contract and obtain maintainer agreement before implementation.

The app and Node tools must consume the same library source. Do not replace a pinned submodule with an npm version to make a local error disappear, invent an app-only chart action, or monkey-patch `ChartProgram`.

### Changes spanning a library and the app

1. Branch in the library checkout; submodules normally start at a detached commit.
2. Implement and test the library change in that repository, with public types, inspection metadata, and documentation when applicable.
3. Submit the library PR first and link it from the app PR. External contributors can push to their own forks; maintainers integrate the approved library commit into the canonical remote.
4. Only update the app's submodule pointer to a commit available from its configured remote. Update `deployment-sources.json` to the same commit, then validate the app build and affected workflows.

Do not point `main` at a library commit that reviewers or CI cannot fetch. Updating `.gitmodules` to a personal fork is not the integration mechanism.

## Validation expectations

Use the [check matrix](docs/development.md#choose-the-right-checks) instead of running every audit for a typo fix.

- **Behavior fixes:** add a regression that fails for the original bug and checks observable output, state, or resource ownership. Do not only assert that the implementation calls itself.
- **Interaction changes:** verify hover versus Apply, cancellation, Undo/Redo, restored history, and both Preview/Transition modes where affected. Include facet, layer, or adjacent-chart cases when those share the edited path.
- **Performance changes:** compare the same dataset, chart, and action sequence before and after; record machine/browser, cold and warm behavior, long-session behavior, and memory/resource counts. Never silently discard data or options to improve a benchmark.
- **Account or logging changes:** use synthetic users and transport mocks or a separate development Supabase project. Check ownership, consent withdrawal, and guest/member boundaries. Append migrations rather than rewriting already applied migrations.
- **Corpus/model changes:** retain upstream attribution, update generation/hash metadata together, and document the corpus and library revisions. Do not regenerate trained files in unrelated PRs.

CI runs tests, build, browser, and container checks. A green result does not prove that hosted OAuth, email, migrations, or production behavior are correct. Contributors do not need production access.

## Data and privacy

Use synthetic or appropriately licensed public data in examples and fixtures. For each added dataset, provide its source URL, license/terms, retrieval revision or date, modifications, and checksum. See [data provenance](web/data/EXAMPLES.md) and [third-party notices](THIRD_PARTY_NOTICES.md). A publicly downloadable file is not automatically licensed for redistribution.

Research event changes require deliberate review of the client schema, server ingestion, SQL permissions, consent copy, and [privacy notice](privacy.html). Never copy real research events or saved user projects into fixtures. Keep exported charts, screenshots from tests, logs, caches, and performance traces under ignored `output/` unless a maintainer explicitly curates an asset for documentation.

## Review and release

Hyeon Jeon currently coordinates review and integration; see [governance](GOVERNANCE.md). Reviewers may ask for a smaller scope or a reproducible example. Explain disagreements with concrete behavior or evidence. English is the working language for contribution documents and new docs; do not let imperfect English prevent a useful report.

A merge does not deploy. Production releases are batched, and only a maintainer-authorized `vMAJOR.MINOR.PATCH` tag on `main` starts the release workflow. Do not create release tags, publish packages, change hosting settings, or use a deploy hook as part of an ordinary PR. See [releases](docs/releases.md).

## Contribution license

By intentionally submitting a contribution for inclusion, you offer it under the repository's [Apache License 2.0](LICENSE), unless a different existing file license applies or you clearly state otherwise before review. This follows Apache-2.0 section 5. You retain copyright; there is no separate CLA or copyright assignment.

Only submit material you have the right to contribute, including any needed employer or institution permission. Identify third-party material and preserve its notices. Maintainers and other recipients may use accepted Apache-2.0 contributions in commercial products under that license. If you cannot grant these terms, raise the issue before contributing; do not assume a PR checkbox can grant someone else's rights.

The separate ggaction and transition repositories retain their own contribution and licensing rules. Participation in all project spaces follows the [Code of Conduct](CODE_OF_CONDUCT.md).
