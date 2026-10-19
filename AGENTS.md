# Project instructions

- Each recommendation must invoke one actual public ggaction function.
- When a needed capability is absent, implement it in the ggaction source dependency (`vendor/ggaction`) with public types, inspection metadata, tests and documentation. Do not invent app-only action names or monkey-patch the shared prototype.
- Keep consuming that same library source in Node and the browser. Merge upstream changes into the feature branch so updates retain implemented capabilities.
- Apply `vendor/ggaction/AGENTS.md` and its scoped instructions when changing the library.
