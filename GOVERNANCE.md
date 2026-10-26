# Project governance

VisAutocomplete is a research-led software project. Hyeon Jeon currently coordinates maintenance, review, and releases. The research contributors and affiliations are listed in the [README](README.md); research credit does not automatically imply repository administration or review responsibility.

## Decisions and review

Small, focused fixes and documentation improvements can be proposed directly. Discuss new user workflows, substantial dependencies, recommendation-policy changes, public library APIs, persisted formats, and data-collection changes in an issue or draft PR first. A concrete proposal should include the user task, expected behavior, alternatives considered, and validation plan.

Maintainers decide whether a change fits the project and is ready to merge. Decisions should be explained in the relevant issue or PR. Approval does not transfer responsibility for testing or source provenance away from the contributor. New recurring contributors can discuss review/maintenance responsibilities with the maintainer; there is no automatic promotion threshold.

## Release authority

Normal commits and merges do not deploy. Only an explicitly authorized version tag on `main` initiates an application release. The ggaction and transition libraries have separate repositories and release decisions. A dependency change in this app does not authorize a package publication.

## Credit and commercial development

Contributors retain copyright. Accepted contributions use the license described in [CONTRIBUTING.md](CONTRIBUTING.md), with attribution retained as required. The project may support future commercial products or hosted services; Apache-2.0 grants the same commercial-use rights to other recipients. No contribution implies payment, employment, equity, or paper authorship.

For conduct concerns, use the [Code of Conduct](CODE_OF_CONDUCT.md). For a security issue, use the [security policy](SECURITY.md).
