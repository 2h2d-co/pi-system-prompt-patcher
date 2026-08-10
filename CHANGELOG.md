# Changelog

## Unreleased

### Security

- Require npm releases to match a locally built SHA-256 recorded in an SSH-signed release commit before trusted publishing can stage the package.
- Require code-owner review for release policy, protect `main` and `v*` refs, and gate npm OIDC behind a reviewed tag-only environment.

## [0.0.2] - 2026-08-07

### Fixed

- Avoid repeating the extension name in Pi's startup display.

## [0.0.1] - 2026-08-07

### Added

- Replacement file routing by provider and model with atomic system prompt patching.
