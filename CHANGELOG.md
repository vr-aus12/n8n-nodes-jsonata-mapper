# Changelog

## 1.0.3

### Changed

- Removed deprecated `lodash.get` and `lodash.set` dependencies.
- Added internal path helpers for dot notation and bracket notation paths such as `items[0].sku`.
- Kept JSONata and AJV dependencies because they are core to the mapper and schema validation features.


## 1.0.2

### Fixed

- Fixed n8n package loading failures caused by badly escaped JSON parameter defaults.
- Replaced manually escaped JSON defaults with `JSON.stringify(...)` generated constants.
- Added `test:json-defaults` to verify all `type: "json"` node parameter defaults are valid JSON before publishing.
- Improved Gemini endpoint handling for AI-assisted mapping.
- Normalized Gemini base URL and model name handling to reduce 404 errors caused by malformed endpoints.
- Keeps `n8n-node release` support with `pnpm`, `release-it`, and n8n-node lint scripts.

