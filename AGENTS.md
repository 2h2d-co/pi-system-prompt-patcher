# Agent Instructions

- This project is a Pi package with a TypeScript extension entrypoint.
- Pi extensions run with full system permissions; keep side effects explicit and documented.
- Run `mise run check` before committing meaningful code changes.
- Use Conventional Commits and maintain `CHANGELOG.md` in Keep a Changelog style; add entries for `feat:` and `fix:` changes under `Unreleased`.
- Keep changelog entries under `Unreleased` for prereleases and move them into a release section only for stable releases.
- Never bind `PI_PACKAGE_DIR` for tests. Pi resolves its own package directory; `npm test` and `npm run test:live` remove an inherited value instead.
- Anthropic live tests keep normal tool, capability, extension, and resource loading enabled. Isolate test state without disabling the prompt patcher or using resource-disable flags.
- The release script must run `npm run test:live` against its exact candidate archive before signing. A missing prerequisite or a failed live test blocks the commit and tag. The post-commit reproducibility rebuild does not repeat the live test. Cover release orchestration offline in `test/release.test.ts` with mocked child processes; never run the real release script in tests.
- Use `npm run release -- <version>` to build the release locally, record its SHA-256 in an SSH-signed `release: v<version>` commit, prove a clean rebuild is reproducible, and create the matching lightweight tag.
- Push release commits and tags atomically; do not create annotated or signed tag objects.
- The tag workflow creates the immutable GitHub release from the verified archive and the version's changelog section. Never create GitHub releases by hand.
- Live tests report every error they meet as a test diagnostic, even when they pass: extension error and warning notices, extension errors, and failed responses. Use `test/error-log.ts`. Summarize failed responses by stop reason, HTTP status, and error category; never print provider error text or credentials.
