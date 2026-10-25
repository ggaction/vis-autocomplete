# Accounts and deployment

Cloud work lives on `codex/cloud-deployment`, isolated from ongoing work on `main`. The editor, native ggaction dependency and transition source remain unchanged by the hosting architecture. Local use works without a Supabase connection.

## Hosted setup checkpoint (2026-10-25)

- Supabase Free organization `ggaction`, project `vis-autocomplete`, reference `yuxpkvtjofeigrkmsdbc`, Frankfurt. Project URL: `https://yuxpkvtjofeigrkmsdbc.supabase.co`.
- Applied `202610250001_cloud.sql` transactionally through the SQL editor. All eight public tables have RLS; the workspace bucket is private. An unauthenticated REST read of projects is denied.
- Executed `supabase/tests/hosted_smoke.sql` against hosted Postgres: private saves, retry idempotence, stale revisions, consent withdrawal, research sanitization and cross-account isolation pass. Synthetic users and edits were rolled back. This verifies the deployed database, not OAuth or email delivery.
- Email confirmation and secure email changes are enabled. Minimum password length is 10 and secure password changes are enabled. Google OAuth is enabled, and an actual Google sign-in returned successfully to the new domain and displayed the first research-choice dialog. The dialog was dismissed without consenting during verification.
- Render's GitHub installation is restricted to `ggaction/vis-autocomplete`. The approved $7/month `0.5c-512mb` service is live in Frankfurt: [Visualization Autocomplete](https://visualization-autocomplete.onrender.com/), service `srv-dbeou4vb9u1s73af5as0`. The first deployment and `/healthz` both identify commit `cd5fae58660df11e4989ece624b3abb7aabb39e1`.
- Verified the hosted Iris chart selection/application, public Supabase configuration, response security headers and native PNG/SVG/PDF export. Private source/configuration paths are not served. After real Google sign-in, `Deployment check · Iris` saved to the account, survived reload, and reopened from My visualizations after switching to a blank workspace. Cross-device testing and a complete email/password signup-confirmation flow remain pending.
- The new canonical site is `https://vis.autocomplete.studio/`. Render confirms domain verification and certificate issuance, and the live health endpoint responds over HTTPS. The Blueprint retains that custom domain. Supabase Auth's Site URL and exact redirect use this URL; the onrender.com fallback and `http://127.0.0.1:5184/` development redirect remain allowed.
- GoDaddy now points `vis` to `visualization-autocomplete.onrender.com` and `oldvis` to `hj-n.github.io`. The previous `hj-n/visualization-autocomplete` GitHub Pages custom domain is `oldvis.autocomplete.studio`; its new HTTPS certificate is still pending. The legacy Pages redeployment (run `40166136797`) passed and HTTP returns the original app. An attempt to enable HTTPS returned `The certificate does not exist yet`; do not bypass certificate validation. Existing root/WWW and mail records were preserved.
- Separate Google Cloud project `ggaction-vis-autocomplete` (`919640993807`), without paid compute. The user created and installed the Web OAuth credentials in Supabase. The approved consent app is in production, declares only `openid`, `userinfo.email`, and `userinfo.profile`, and links to the public `/privacy.html` notice. The OAuth callback is `https://yuxpkvtjofeigrkmsdbc.supabase.co/auth/v1/callback`. Google currently displays the Supabase hostname in its sign-in screen; no custom Supabase auth domain was purchased.
- Resend Free domain `auth.autocomplete.studio` is verified in Ireland. Its three provider-supplied records are TXT `resend._domainkey.auth`, CNAME `rsend.auth` → `rsend-euw1.forge.rmta.net`, and CNAME `send.auth` → `send.forge.rmta.net`. Receiving and tracking were not enabled. The user saved a domain-restricted Sending-access API key in Supabase SMTP; SMTP remains enabled after reload, with host `smtp.resend.com` and port 465. Secrets are absent from this repository. One explicitly approved password-recovery test was accepted by Supabase and marked **Delivered** by Resend. No password was changed; the recovery link and signup-confirmation flow were not completed.
- Public `/privacy.html` and the application release `c8cde7f13006d64b48170ec6a126961d1f7b3f11` were checked over the new HTTPS domain after CI run `40166031102` passed. The notice is linked from sign-in and About, and in Google OAuth branding. The 9 cloud tests passed after the change.

The initial schema was applied manually, not through the CLI. When linking the CLI for future migrations, first mark this **already applied** version with `supabase migration repair --status applied 202610250001`, verify `supabase migration list`, then run `supabase db push --dry-run`. Do not rerun the initial migration or reset the hosted database.

## What ships

- A sign-in landing page with a short introduction, Google OAuth, email/password signup, email confirmation and password recovery. The editor, recommendation workers and datasets load only after authentication; persisted sessions are verified by Supabase before restoring a draft. Sign-out (including in another tab) returns to the landing page and unloads the editor. Missing authentication configuration fails closed.
- A workspace menu with private projects, imported datasets, rename/duplicate/delete, settings, reports and About.
- Local-first automatic saving. Each committed edit, undo/redo or direct manipulation is queued durably before sync; datasets are content-addressed and uploaded once. A project snapshot plus revision deltas preserves branches discarded by Undo and coalesced resize entries. Revisions are operational private project storage, **not research records**.
- Research collection starts only after an explicit Continue/Save preferences. The initial checkbox is checked, as requested; closing the dialog is not consent. Withdrawal immediately stops new client events, discards queued events, and the database rejects stale consent epochs, including after re-consent.
- General/feature reports and project-context reports. Project context includes code, field names and chart text. Dataset rows and private storage attachments are excluded unless the author separately checks the report's dataset-sharing box.
- A production asset build, bounded server-side PNG/PDF/SVG export, a Docker image, Render Blueprint, and CI checks before auto-deploy.

## One-time setup: new FREE Supabase project

1. Open [Supabase](https://supabase.com/dashboard/new), select a **Free organization**, create `vis-autocomplete`, and choose a nearby European region (Render is configured in Frankfurt). Store the database password in your password manager; do not put it in Git or chat. This repository does not provision a paid Supabase tier.
2. Apply `supabase/migrations/202610250001_cloud.sql` using the Supabase SQL editor. Alternatively use the CLI:

   ```sh
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   The local `config.toml` is for CLI development. It **does not configure hosted Auth** when applying SQL. Configure the following in the hosted Dashboard.
3. In Authentication, enable email/password and **Confirm email**, set minimum password length 10, and keep anonymous sign-in disabled. Enable secure password changes and secure email changes. Use reasonable signup/password recovery rate limits; do not require reauthentication on ordinary edits. The application does not implement its own password database.
4. Configure **custom SMTP** with your mail provider, verify its sender domain, and test confirmation and recovery delivery. Supabase's built-in mail transport is restricted to team addresses and is unsuitable for public signup. Do not disable confirmation to work around this restriction. [Official SMTP guidance](https://supabase.com/docs/guides/auth/auth-smtp)
5. Enable the Google provider. In Google Cloud create a Web OAuth client, add `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` as the authorized redirect URI, and enter its client ID and secret in **Supabase**, not Render or the browser. Set the Google consent screen to production when ready for public users. [Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google)
6. After Render supplies the app URL, use it as Supabase Auth's Site URL and add its exact `https://…/` redirect URL. Add `http://127.0.0.1:5184/` only for development. Avoid wildcard production redirects. Google and password recovery return to `/`.
7. Copy the **project URL** and **publishable key** from Project Settings > API. A legacy `anon` key also works. Never use `service_role` or an `sb_secret_` key. The server refuses these privileged keys as public configuration.

## Deploy on Render

[Create the Render Blueprint from this branch](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fggaction%2Fvis-autocomplete%2Ftree%2Fcodex%2Fcloud-deployment).

Choose the connected GitHub repository, `codex/cloud-deployment`, and `render.yaml`. Review the service before creating it. The Blueprint specifies one `0.5c-512mb` paid web instance in Frankfurt; the existing Render subscription does not imply compute is included. It creates **no Render database**. Enter only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` when prompted. SMTP and Google secrets stay in Supabase. HTTPS is supplied by Render.

Link the repository through the GitHub integration (not merely an unauthenticated public repository URL) so the `checksPass` auto-deploy trigger receives CI status. After this first setup, pushes to the deployment branch deploy when all checks pass. [Render deployment rules](https://render.com/docs/deploys)

Before opening registration, run a **live** smoke test: sign up with an address outside the project team; follow the confirmation link; use Google sign-in; reset the password; create a chart; reload and reopen it on another device; change consent; submit both report types. Automated transport mocks do not verify provider credentials, OAuth console setup, deliverability, or hosted RLS deployment.

## Local preview

```sh
git submodule update --init --recursive
npm ci
npm run build
PORT=5184 npm start
```

Open `http://127.0.0.1:5184/`. Without cloud variables the landing page explains that sign-in is not configured and keeps the editor unavailable. For configured local testing, copy `.env.example` to `.env` and run `node --env-file=.env scripts/server.js`. Environment files are ignored. Keep the other main-branch dev server on its existing port.

## Data boundaries and administrator access

| Store | Contents | Access / purpose |
| --- | --- | --- |
| `projects`, `project_revisions` | Current private program and full edit revisions | Owner only; saving/reopening, not research |
| `datasets`, private `workspace` bucket | Uploaded/imported datasets once per content hash | Owner only; private work storage |
| `profiles`, `consent_history` | Current choice, version, timestamp, consent epochs | Owner; verifiable permission boundary |
| `research_events` | Allowed event types, public action names, ranks/indices/counts/timing, release version | Consenting owner and explicitly appointed research admins |
| `bug_reports` | Report text and optional chart context | Author and appointed admins; dataset access only for the particular report's opt-in attachments |

Research ingestion projects an allowlist again on the server. It drops action arguments, dataset rows, column names, chart text, search text and raw error messages. Reports and private project revisions are **not joined into the research export**. Do not use database-owner/service-role privileges to bypass this boundary in research analysis.

App admin membership is set by a database owner only:

```sql
insert into public.app_admins(user_id) values ('YOUR_AUTH_USER_UUID');
```

Never derive this permission from editable user metadata. Admins do not get blanket access to private projects or datasets. Use the Supabase dashboard for initial report triage; a dedicated admin dashboard is not included.

Changing consent stops future collection; it does not erase previously consented events. A request to erase research records can be fulfilled by the database owner with `delete from public.research_events where owner_id = …`; deleting an Auth user cascades private relational records and research records. **Storage objects and browser-local copies require separate cleanup**. Project deletion retains reusable datasets in My datasets; there is no automatic destructive retention job.

## Recovery, limits and future changes

- A stale revision never overwrites another device's work. The client keeps a recovered copy and redirects subsequent queued changes to it. Unsynced edits remain in IndexedDB; closing a tab before its local write finishes cannot be guaranteed durable. Do not clear site storage while sync is pending.
- Requests cap snapshots/deltas at 8 MiB and dataset objects at 20 MiB. These are operational limits, not a guarantee that the Free quota covers every study. Monitor DB and Storage usage; research event volume and private revision history grow over time. Export/back up study data before capacity limits and before schema changes. The Free tier is not a retention or availability guarantee.
- Future DB changes use new migration files, never edit an already applied migration. Test on a separate free development project or local Supabase first, apply additive migrations, then deploy the compatible app. There is intentionally no service-role secret or unattended destructive migration hook in Render.
- To incorporate later main-branch features, merge `main` into `codex/cloud-deployment`, resolve and run the cloud/editor checks. Do not change the feature checkout in place. When updating native submodule commits, update `deployment-sources.json`; CI checks the pins. Docker uses these pins because Git metadata is excluded from its context.
- Render rollback restores application code, not database migrations. Keep schema changes backward compatible and verify `/healthz` reports the intended app commit.
- PNG/PDF/SVG export requires a bearer token verified against Supabase Auth and processes the requested chart transiently and does not log or persist chart bodies. The production server serves only `output/deploy/public`, denies framing, and uses a restrictive script policy. Native exports have a dimension cap, one-job concurrency cap and worker timeout.

## Verification commands

```sh
npm run build
npm run test:cloud
npm run test:cloud-browser
node scripts/test-cloud-auth-browser.js
```

The SQL suite runs PostgreSQL via PGlite with Auth/Storage scaffolding to exercise RLS and RPCs. Auth browser tests use a mock Supabase HTTP transport. The Docker image and real providers still require their respective environment checks; tests must not be reported as a successful public deployment.

For a hosted database check without retaining test accounts or rows, run `supabase/tests/hosted_smoke.sql` as postgres in the SQL editor. It uses the real hosted `auth.uid()` and authenticated role, asserts invariants, and rolls its entire transaction back.
