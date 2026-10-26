# Guest access

The landing page offers **Try without account**. Clicking it creates a verified
Supabase anonymous Auth session, without email, password or a registration form.
Simply visiting the landing page creates no guest user. The normal session
verification, token refresh and startup screen also apply to returning guests.

Guests get the same chart editor, previews, history and export controls. The
header shows **Sign up** and **Sign in**. Workspace explains **Sign in to save
and manage your projects.** It also provides a fresh visualization, Settings,
reports and About. Selecting an example or uploading a dataset does not ask a
guest to name a cloud project.

## Storage and account transition

- The current guest draft, including its dataset and history, stays in the
  browser's existing identity-scoped IndexedDB store. Reload restores it.
- Guest autosave does not pack or upload datasets, snapshots or thumbnails and
  cannot enqueue a private-project write. Database policies independently deny
  private project/dataset/storage access. A trigger also guards the privileged
  `save_project` RPC, which otherwise bypasses RLS.
- Consent uses the existing versioned choice and withdrawal flow. After consent,
  allowlisted interaction events are queued and sent through
  `record_interactions` under the verified guest ID. The server stamps
  `research_events.is_guest`; raw rows, text and action arguments are excluded.
- Guest project-context reports are sanitized locally and do not upload the
  underlying dataset. Attaching a dataset requires sign-in. Native chart export
  still sends the chart transiently to the authenticated rendering endpoint.
- An explicit sign-in attempt flushes the local guest draft and stages a short
  lived, tab-scoped transfer marker containing only its owner ID and timestamp.
  After authentication, that draft becomes a new private project; existing
  account projects remain in Workspace. Failed login and **Back to your
  visualization** preserve the guest editor. Other tabs do not inherit the
  transfer marker. The guest's consent does not become a new account's consent.

## Before releasing this feature

Ordinary pushes do not deploy. Apply the following only as part of the next
authorized release's infrastructure preparation:

1. Apply `supabase/migrations/202610260001_guest_access.sql` transactionally,
   after the existing `202610250001_cloud.sql`. Do not rerun or replace the
   initial migration. The addition preserves existing account records and RLS.
2. In Supabase Authentication → Sign In / Providers, enable **Allow anonymous
   sign-ins**. Keep manual identity linking off: this app uses normal Google or
   email sign-in and explicitly transfers the local draft. Retain an anonymous
   signup rate limit (local configuration uses 30 per IP per hour). No privileged
   Supabase key is added to the app or Render.
3. Release the user-designated version with the existing tag workflow, then
   verify one real guest session, opt-in event insertion, absence of workspace
   uploads, reload, opt-out and guest-to-account transition.

Hosted migration/Auth configuration and a live provider check are separate from
local code tests. No hosted setting or production deployment is changed by this
implementation checkpoint. Anonymous Auth records and consented events are
retained; there is no automatic destructive cleanup job.

The permission distinction follows Supabase's
[anonymous sign-in documentation](https://supabase.com/docs/guides/auth/auth-anonymous):
guests use the `authenticated` role, so session presence alone cannot grant
workspace storage. `has_registered_account()` checks Auth's authoritative
`is_anonymous` column rather than editable user metadata.

## Regression checks

`test/cloud-security.test.js` runs both migrations in PostgreSQL via PGlite and
checks member isolation, guest write rejection, private storage rejection,
sanitized server events, consent epochs and admin event access.
`test/cloud-client.test.js` checks that guest saves create no upload jobs and
that events still reach the server. `test/guest-transfer.test.js` checks explicit,
expiring transfer markers. `test/browser/guest-access.py` uses a real Supabase
client with a fake HTTP transport to exercise the editor and account transition.
It never creates real accounts or writes to production.

CI runs the browser case against the production build. To run it locally,
install `test/browser/requirements.txt` in a Python environment, install its
Chromium browser with `python -m playwright install chromium`, then run:

```sh
npm run build
PORT=5205 SUPABASE_URL=https://cloud-test.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_test npm start
# In another terminal, using that Python environment:
python test/browser/guest-access.py --url http://127.0.0.1:5205
```

The URL and publishable key above are fake transport fixtures, never real
credentials. The existing account-browser regression also runs with this change.
