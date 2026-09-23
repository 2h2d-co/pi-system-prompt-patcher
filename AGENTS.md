# Agent Instructions

- This project is a Pi package with a TypeScript extension entrypoint.
- Pi extensions run with full system permissions; keep side effects explicit and documented.
- Run `npm run check` and `npm test` before committing meaningful code changes.
- Use Conventional Commits and maintain `CHANGELOG.md` in Keep a Changelog style; add entries for `feat:` and `fix:` changes under `Unreleased`.
- Keep changelog entries under `Unreleased` for prereleases and move them into a release section only for stable releases.
- Bind `PI_PACKAGE_DIR` per entry point: CLI subprocesses to the selected executable's package directory, and the `check` and `test:live` Mise tasks to the repository's Pi dependency. Never set it in the Mise `[env]` section, which would change unrelated Pi launches.
- The release script must run `mise run test:live` against its exact candidate archive before signing. A missing prerequisite or a failed live test blocks the commit and tag. The post-commit reproducibility rebuild does not repeat the live test. Cover release orchestration offline in `test/release.test.ts` with mocked child processes; never run the real release script in tests.
- Use `npm run release -- <version>` to build the release locally, record its SHA-256 in an SSH-signed `release: v<version>` commit, prove a clean rebuild is reproducible, and create the matching lightweight tag.
- Push release commits and tags atomically; do not create annotated or signed tag objects.
- The tag workflow creates the immutable GitHub release from the verified archive and the version's changelog section. Never create GitHub releases by hand.
