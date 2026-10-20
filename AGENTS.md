# Project instructions

- Each recommendation must invoke one actual public ggaction function.
- When a needed capability is absent, implement it in the ggaction source dependency (`vendor/ggaction`) with public types, inspection metadata, tests and documentation. Do not invent app-only action names or monkey-patch the shared prototype.
- Keep consuming that same library source in Node and the browser. Merge upstream changes into the feature branch so updates retain implemented capabilities.
- Apply `vendor/ggaction/AGENTS.md` and its scoped instructions when changing the library.

## Version control workflow

- Commit and push completed, verified changes at meaningful checkpoints instead of accumulating finished work locally. Push library commits before committing the parent repository's updated submodule reference.
- Keep generated output, caches, logs, coverage and local dataset/chart exports out of Git. Preserve required runtime assets, trained models, dataset provenance and regression fixtures.
- Verify the pushed branch's remote commit matches the local commit. Do not force-push unless explicitly requested.
