# Changelog

## Unreleased

### Changed

- Adopt the shared 2h2d Oxlint policy, including the blanket ban on non-const type assertions.

### Security

- Require npm releases to match a locally built SHA-256 recorded in an SSH-signed release commit before trusted publishing can stage the package.
- Require code-owner review for release policy, protect `main` and `v*` refs, and gate npm OIDC behind a reviewed tag-only environment.
- Updated the Pi development dependency and peer range to 0.84.x, including patched transitive HTTP and glob dependencies.

## [0.0.2] - 2026-08-07

### Fixed

- Avoid repeating the extension name in Pi's startup display.

## [0.0.1] - 2026-08-07

### Added

- Replacement file routing by provider and model with atomic system prompt patching.
