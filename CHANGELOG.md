# Changelog

## [0.0.9] - 2026-10-04

### Added

- Fill in `{piPackageDir}` and `{piVersion}` placeholders in replacement targets and
  replacements with the running Pi's package directory and version. One rule can now match the
  documentation paths of any Pi installation instead of a single install path.

### Changed

- Require Pi `>=1.0.1 <1.1.0`. The extension refuses to load on older runtimes.

## [0.0.8] - 2026-10-02

### Changed

- Require Pi `>=1.0.0 <1.1.0`. The extension refuses to load on older runtimes.
  System prompt replacement behavior is unchanged. After upgrading Pi, restart it
  and recheck exact-match targets against its revised prompt text and documentation paths.

## [0.0.7] - 2026-09-30

### Changed

- Require Pi 0.99.1 or newer. The extension refuses to load on an older Pi.

## [0.0.6] - 2026-09-30

### Changed

- Support Pi 0.99.x in addition to Pi 0.87.x. Releases are validated against Pi 0.99.1.

## [0.0.5] - 2026-09-23

### Changed

- Clarify Pi runtime selection and configuration isolation in the packaged documentation.
  System prompt replacement behavior is unchanged.

## [0.0.4] - 2026-09-22

### Changed

- Support Pi 0.87.x. Upgrade Pi to 0.87.0 or later within 0.87.x before using this release.

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
