# Native ggaction source dependency

The demo now uses `file:vendor/ggaction`. Scatter/bar missing-policy forwarding
lives in the library source, declarations and generated descriptors. There is no
postinstall mutation of `node_modules`. The source branch also implements the
public `editAxes` aggregate, its tests, contracts, and documentation.

Run `npm run update` to merge upstream changes while retaining local features.
The updater requires a clean library checkout and stops on merge/test failures.
