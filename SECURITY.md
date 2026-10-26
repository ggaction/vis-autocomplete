# Security policy

## Report privately

For a suspected vulnerability, email Hyeon Jeon at [jeonhyun97@gmail.com](mailto:jeonhyun97@gmail.com) with the subject **VisAutocomplete security report**. If GitHub's private vulnerability reporting is enabled for this repository, that is also suitable. Please do not open a public issue containing an exploit or affected user data.

Include the release/commit, affected component, minimal reproduction using your own test account/data, impact, and any suggested mitigation. Do not include passwords, tokens, private datasets, participant records, or other people's personal information. If a secret was exposed, identify the kind and location without repeating its value.

There is no guaranteed response-time or bounty program. We will investigate reports as maintainers are able and coordinate a fix and disclosure where appropriate. A follow-up is welcome if you have not received an acknowledgment.

## Supported code

Security fixes target the latest released application and the current development branch. Older releases do not have a separate backport commitment. The legacy paper demo at oldvis.autocomplete.studio is a separate project; clearly identify it when reporting.

Native chart-library and transition issues may belong in their own repositories. Use a private contact rather than cross-posting vulnerability details publicly.

## Safe investigation

Use a local instance, synthetic data, or accounts you control. Do not access other users' records, enumerate production data, disrupt the service, send unsolicited mail, or load-test production. This policy is not authorization to test third-party infrastructure or bypass provider terms.

## Contributor responsibilities

Keep authentication and row-level ownership checks intact. Anonymous users are authenticated guests, not members with private-storage rights. Use only a Supabase publishable/anon key as browser configuration; service-role, SMTP, OAuth secrets, and deploy hooks never belong in source, screenshots, or logs. Use a separate development backend for manual testing.

See [development setup](docs/development.md), [privacy](privacy.html), and [research logging](docs/research-logging-v2.md) for the relevant boundaries. A build or mocked test does not validate production provider configuration.
