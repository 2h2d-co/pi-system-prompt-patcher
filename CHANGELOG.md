# Changelog

## Unreleased

## [0.0.3] - 2026-09-20

### Fixed

- Patch Pi 0.86's mid-conversation system instructions as well as the leading system prompt.
- Match each replacement across all system instruction fragments while preserving ordered, atomic replacement and leaving conversation text and tool metadata unchanged.

### Changed

- Require Pi 0.86.x and update the development dependency and lockfile to Pi 0.86.0.
- Adopt the shared 2h2d Oxlint policy, including the blanket ban on non-const type assertions.

### Security

- Require npm releases to match a locally built SHA-256 recorded in an SSH-signed release commit before trusted publishing can stage the package.
- Require code-owner review for release policy, protect `main` and `v*` refs, and gate npm OIDC behind a reviewed tag-only environment.
- Update transitive HTTP and glob dependencies to patched versions.

## [0.0.2] - 2026-08-07

### Fixed

- Avoid repeating the extension name in Pi's startup display.

## [0.0.1] - 2026-08-07

### Added

- Replacement file routing by provider and model with atomic system prompt patching.
