# Maintaining contribution readiness

## Repository access

At the 2026-10-26 preparation checkpoint, `ggaction/vis-autocomplete` is private; `ggaction/ggaction`, `ggaction/transition`, and `ggaction/chart-datasets` are public. Invited collaborators can contribute now. Uninvited external contributors cannot clone or open issues in a private repository. This documentation change does not change visibility or deploy the service.

Before making this repository public, the owner should review the complete Git history, source and dataset rights, production identifiers and operational notes, and the intended public issue surface. Remove or rotate any exposed secrets rather than assuming `.gitignore` cleans history. Third-party dataset and corpus rights need their own review; see [notices](../THIRD_PARTY_NOTICES.md). Do not describe the full data/model distribution as cleared solely because the original code has a license.

## GitHub setup

The repository includes issue forms, a PR template, CODEOWNERS, a Code of Conduct, a security policy, citation metadata, and a credential-free documentation check. These files do not configure every GitHub setting automatically.

When opening contributions, review the following settings deliberately:

- Enable Issues and, if useful, Discussions. Check the issue chooser from a non-maintainer account.
- Enable private vulnerability reporting if available; the security email route works independently.
- Add `good first issue`, `help wanted`, `bug`, `performance`, `documentation`, and `accessibility` labels as needed. Do not advertise a queue of first issues before curating it.
- Configure review/status requirements for `main` to match the active CI jobs. CODEOWNERS routes review but is not branch protection by itself. Keep emergency and maintainer integration policies explicit.
- Require approval for workflows from outside contributors. Never run untrusted PR code in `pull_request_target` with secrets or a write token. Ordinary PR checks need neither deploy hooks nor production credentials.
- Keep Render auto-deploy and Blueprint auto-sync disabled. Do not publish a package or create a version tag as part of contribution setup.

Changes to repository visibility, access rules, hosting settings, or package publication are separate owner decisions; this checklist is not evidence they have been applied.

## Reviewing a contribution

1. Confirm the problem and a minimal reproduction or motivating use case.
2. Route native chart changes to ggaction and playback changes to transition. Ask for a concrete contract before a new public API or persisted-schema change.
3. Review data provenance, copyright/license compatibility, privacy effects, and whether the contributor is authorized to submit the material. No CLA or copyright assignment is required for Apache-2.0 contributions.
4. Run or inspect appropriate tests, including affected composition and history paths. Performance claims should include comparable workloads and preservation of functionality.
5. Confirm library commits are reachable from configured submodule remotes, source pins agree, and a clean checkout can build.
6. Merge only the intended scope, credit contributions, and communicate any release timing separately.

For an unclear third-party license or employer/institutional ownership claim, resolve the rights question before accepting the material. A checkbox does not replace that review.

## Keep onboarding working

Run `npm run check:docs`, `npm run demo:quickstart`, and `npm run build` from a clean recursive checkout periodically. The quickstart must not require a corpus cache or cloud credentials. Check mocked browser tests after startup/auth changes. Do not make first-time contributors retrain models to run ordinary tests.

Keep `.nvmrc`, CI, and Docker Node versions aligned when intentionally upgrading. Update public instructions whenever scripts, auth prerequisites, submodules, or release behavior change. Existing historical engineering notes are context; they should not override the current developer guide.
