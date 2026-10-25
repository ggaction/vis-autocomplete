# Batched releases

Ordinary commits and branch pushes run checks **without deployment**. Render's service Auto-Deploy is **Off** and the Blueprint's Auto Sync is **No**. Keep both disabled: a Blueprint sync or manual dashboard deployment can bypass the release workflow.

Only the user decides the release version and timing. Do not create tags during routine development. The release trigger is a stable version tag named `vMAJOR.MINOR.PATCH` on a commit in `main`. The private app's package.json version is not an npm publication version and does not trigger a release.

## One-time connection

In GitHub repository Settings → Secrets and variables → Actions, store **RENDER_DEPLOY_HOOK_URL** using this service's private Deploy Hook from Render Settings. This grants Actions permission to deploy this service only. Do not use a workspace-wide API key. Never put the hook in Git, chat, output files or logs, or open it in a browser (GET triggers deployment).

The workflow fails closed if this secret is missing. Storing the secret does not deploy anything. No release tag is created by setup.

## When the user requests a version

1. Merge and verify the intended changes on main. Set `package.json` and `package-lock.json` to the requested version (without `v`); About reads this same version. Push its commits normally.
2. Only after the user names the version, create an annotated tag at the reviewed commit and push **that single tag**. For example, with the user-provided name in `RELEASE_TAG`:

   ```sh
   git tag -a "$RELEASE_TAG" -m "Release $RELEASE_TAG" REVIEWED_COMMIT
   git push origin "refs/tags/$RELEASE_TAG"
   ```

3. GitHub Actions verifies tag/checkout/branch ancestry and the package version, builds, audits production dependencies, runs the full regression suite and cloud browser tests, then builds and starts the production Docker image.
4. The release job rechecks the tag and sends Render the **tagged commit SHA**, never the latest branch commit. It waits for `/healthz` to report that exact healthy SHA before publishing GitHub release notes and `release-manifest.json` with dependency pins.
5. Inspect the workflow result and live app. A failed/timeout deployment does not publish a GitHub release. Render retains its previous successful deployment if the new build fails.

Production release jobs are serialized. Push one release tag at a time and wait for it to finish; GitHub concurrency groups retain only one pending run. Never force-move a released tag. A workflow retry skips a published release, or skips re-deployment if the exact commit is already healthy. If a deploy-hook request had an unknown outcome, inspect Render before retrying. To roll back, explicitly choose the desired commit/version and verify compatibility with the database.

`npm test` runs every test file with four concurrent processes and a 512 MB heap per process. Exhaustive facet and encoding-suppression checks have separate processes to release their temporary chart programs between capabilities. Keep these bounds: an unbounded heap can spend minutes in weak-reference table maintenance. Production CI and Docker both use Node 22.23.4.

Tags do **not** automatically apply database migrations or Blueprint configuration changes. Review and apply backward-compatible infrastructure/schema changes separately before releasing a version that needs them. This avoids granting deployment code database-owner access. Changes to runtime assets are included by the normal Docker build.

Native favicon source: `web/icons/favicon.svg`. Regenerate the committed PNG fallbacks with `node scripts/build-icons.js`; these are required runtime assets, not audit output.

References: [Render deploy hooks](https://render.com/docs/deploy-hooks), [Render automatic deployments](https://render.com/docs/deploys).
