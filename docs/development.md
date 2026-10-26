# Developer guide

This guide is the current setup reference. It separates local code work from cloud-provider setup and production deployment.

## Prerequisites

- Git, with access to this repository and its public submodules.
- Node.js 22; [.nvmrc](../.nvmrc) matches the version used in CI. Use that version when reproducing CI failures.
- npm, included with Node.js.
- Chromium for browser tests. Python 3.12 is needed only for the Python browser scripts; Node-only tests do not require Python.
- Docker and the Supabase CLI only if you choose local Supabase or container checks.

```sh
git clone --recurse-submodules https://github.com/ggaction/vis-autocomplete.git
cd vis-autocomplete
# If you use nvm:
nvm install
nvm use
npm ci
npm run demo:quickstart
```

The models and example datasets required by the app are checked in. Do not run `npm run update` or retrain the corpus just to get started: those are maintainer operations that intentionally change source pins or model artifacts.

## Run the editor

The editor requires a verified member or anonymous guest session. **Try without account** uses Supabase anonymous authentication; it is not an authentication bypass. Without configuration, the app shows a session/setup message and leaves the editor unavailable.

### Option A: your own development Supabase project

1. Create a separate Supabase development project. Do not use the production project or request its credentials.
2. Apply **all** SQL files in [supabase/migrations](../supabase/migrations), in filename order, to the fresh project. Use the SQL editor, or the Supabase CLI linked to your own project. Read migrations before applying them. Never reset or replay these instructions against a shared/production database.
3. Enable anonymous sign-ins for **Try without account**. For email/Google flows, configure those providers separately. Provider secrets remain in Supabase, not this repository.
4. Set the Auth Site URL and redirect allowlist to the exact local origin you use, such as `http://127.0.0.1:5184/`.
5. Copy [.env.example](../.env.example) to `.env`, then set your project's URL and **publishable** key. A legacy `anon` key is also accepted. Do not use `service_role` or `sb_secret_`.
6. Start the development server, explicitly loading the environment file:

   ```sh
   node --env-file=.env scripts/dev-server.js
   ```

Open `http://127.0.0.1:5184/` when using the example's `PORT=5184`. The server watches and rebuilds browser bundles; refresh to load changes. Plain `npm run dev` uses the process environment and defaults to port 5173; it does not load `.env` automatically.

### Option B: local Supabase

With Docker running and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) installed, run `supabase start` from the repository root. Use `supabase status` to find the local API URL, public key, and local mail viewer. The checked-in [config](../supabase/config.toml) enables anonymous sign-in and uses `http://localhost:5184` as its app origin. Use that same hostname in the browser or update your local redirect configuration deliberately.

Copy the local public configuration into `.env` and start the editor as above. The local project applies migrations in `supabase/migrations`; verify their status before testing. `supabase db reset` destroys local development data and should only be used deliberately on your disposable local instance. This guide does not ask you to link to production.

### Production-like local build

```sh
npm run build
node --env-file=.env scripts/server.js
```

The production server serves only `output/deploy/public`, applies security headers, and verifies tokens for export. It does not watch source files. Build output is ignored by Git. See [cloud deployment](cloud-deployment.md) for provider and hosting details; those operational notes include historical checkpoints, not credentials to reuse.

## Choose the right checks

| Change | Useful checks |
| --- | --- |
| README, contribution docs, links, metadata | `npm run check:docs` |
| Ranking/model logic | `node --test test/model.test.js`; affected engine tests |
| Saved project/history behavior | `node --test test/project.test.js test/project-regression.test.js`; affected browser scenario |
| Public action/catalog integration | `npm run catalog:check`; relevant action tests; native library tests |
| UI or worker source | `npm run build`; affected browser scenario |
| Auth, persistence, research collection | `npm run test:cloud`; mocked auth/guest/research browser scenarios |
| Cross-cutting change | `npm run build` followed by `npm test` and relevant browser checks |

Run commands from the repository root. `catalog:check` also refreshes the generated action inventory/report; inspect the diff and include those outputs only in an intentional catalog/library update. Some server tests read built assets, so build first before the complete suite or cloud suite.

```sh
npm run build
npm test
```

The test runner bounds concurrency and isolates expensive exhaustive recommendation cases. On a constrained machine, reduce concurrency without dropping cases:

```sh
TEST_CONCURRENCY=1 npm test
```

CI distributes the same suite across four shards. `node scripts/test-suite.js --list` prints the scheduled jobs. An individual test can be run with `node --test test/<name>.test.js`; use a real filename from `test/`.

### Browser tests without cloud credentials

Install Chromium and run the standalone mocked checks:

```sh
npx playwright install chromium
npm run build
npm run test:cloud-browser
node scripts/test-cloud-auth-browser.js
```

These scripts start an ephemeral local production server and intercept authentication traffic with synthetic accounts. No real Supabase project, email, production user, or research record is needed. They validate transport and UI behavior, not real OAuth or email delivery. On Linux, `npx playwright install --with-deps chromium` also installs system libraries and may require administrator privileges.

For Python browser coverage:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r test/browser/requirements.txt
python -m playwright install chromium
```

In another terminal, start a built local server with **test-only** configuration:

```sh
PORT=5184 SUPABASE_URL=https://cloud-test.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_test npm start
```

Then run the self-contained scenarios that intercept that transport:

```sh
python test/browser/guest-access.py --url http://127.0.0.1:5184
python test/browser/research-logging.py --url http://127.0.0.1:5184
python test/browser/history-graph-app.py --url http://127.0.0.1:5184
```

That fake configuration is **not** an interactive login service. Do not point ordinary browsers at it expecting authentication to work. Other historical browser scripts differ in arguments and setup; inspect their header before running them. Screenshots and logs belong in ignored `output/`.

## Working on library source

The app consumes `vendor/ggaction` and `vendor/transition` through local file dependencies. Both Node tools and browser bundles must use the same revisions. See [the cross-repository contribution flow](../CONTRIBUTING.md#changes-spanning-a-library-and-the-app).

Useful library checks:

```sh
npm --prefix vendor/ggaction ci
npm --prefix vendor/ggaction run test:unit
npm --prefix vendor/transition ci
npm --prefix vendor/transition test
```

Follow each repository's own instructions for API/type/docs changes. The production build checks submodule commits against [deployment-sources.json](../deployment-sources.json). Do not bypass that check; update a pin only when the corresponding source change is ready for integration.

## Corpus and model work

The current model provenance is in [data/corpus-report.json](../data/corpus-report.json), and hashes/generation are in [data/model-manifest.json](../data/model-manifest.json). The input corpus is [ggaction/chart-datasets](https://github.com/ggaction/chart-datasets). Its data and chart specifications retain upstream terms.

- `npm run corpus:update` fetches the current upstream corpus and retrains checked-in outputs. It is an intentional model update, not a setup step.
- `npm run corpus:train` trains from `.cache/chart-datasets`, or the directory given by `CHART_CORPUS_DIR`.
- `npm run validate:corpus`, `npm run validate:initial`, and the exhaustive recommendation audits require the corresponding full corpus and can be expensive.
- `npm run demo` is the larger historical demo and reads the corpus cache. Use `npm run demo:quickstart` when you only want a self-contained introduction.

When reproducing a model result, use the corpus commit and library commit recorded by that result, not an arbitrary current checkout. Keep the report, models, parameter evidence, and manifest in one consistent generation. Raw corpus caches and exports remain untracked.

## Common setup problems

| Symptom | What to check |
| --- | --- |
| `ggaction` cannot be resolved | Initialize recursive submodules, then run `npm ci` from the root. |
| Session says sign-in is not configured | Explicitly load `.env`; use your own development project or a documented mocked test. |
| **Try without account** fails | Anonymous Auth must be enabled and all guest/research migrations applied to that project. |
| Browser executable is missing | Install Chromium for the Node or Python Playwright environment running the test. |
| Port is already in use | Choose another `PORT` and match Auth redirects; do not stop someone else's server. |
| Build rejects a source revision | Check `git submodule status` and `deployment-sources.json`; integrate the intended library commit. |
| Test runs exhaust memory | Use `TEST_CONCURRENCY=1`; avoid parallel exhaustive corpus audits. |

For architecture and file ownership, continue to [architecture.md](architecture.md). For deployment, use the separate [release guide](releases.md); routine development never requires a release tag.
