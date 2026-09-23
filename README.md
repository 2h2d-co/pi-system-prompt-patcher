# pi-system-prompt-patcher

Patch provider system prompts with exact, provider-aware, config-driven replacements.

The extension rewrites the top-level `system` field and `role: "system"` entries in `messages`
immediately before Pi sends a compatible provider request. It supports string prompts and arrays
of text content blocks. It ignores payloads without either form of system instructions.

Requires Pi `>=0.87.0 <0.88.0`.

## Install

```bash
pi install npm:pi-system-prompt-patcher
```

To try the package without adding it to your settings:

```bash
pi -e npm:pi-system-prompt-patcher
```

Pi packages run with full system access. Review the source before installation.

## Configure

Create `~/.pi/agent/pi-system-prompt-patcher.json`:

```json
{
  "providers": {
    "cult": {
      "replacementFile": "replacements/cult.json",
      "models": {
        "ritual-2": "replacements/cult-ritual-2.json"
      }
    },
    "other-provider": {
      "replacementFile": "/absolute/path/to/replacements.json"
    }
  }
}
```

When `PI_CODING_AGENT_DIR` is set, the extension reads the configuration from that directory
instead of `~/.pi/agent`.

Provider and model names are matched exactly. A model-specific file takes precedence over its
provider file. A provider can omit `replacementFile` when it only configures model-specific files.
Requests without a matching provider or model configuration are left unchanged.

Relative replacement file paths are resolved from the directory containing the settings file.
Absolute paths and paths beginning with `~` are also supported.

Each replacement file contains an array:

```json
[
  {
    "target": "Exact text from the original system prompt",
    "replacement": "Replacement text"
  }
]
```

Replacements are:

- applied in array order;
- applied to every occurrence of each target across all system instruction fragments;
- selected by provider and, when configured, model;
- loaded again with the settings for every provider request, so changes do not require `/reload`;
- applied atomically—the provider payload is not mutated.

Each target must occur in at least one system instruction fragment, not in every fragment.
Targets do not match across fragment boundaries. User and assistant messages, tool declarations,
and non-text content blocks remain unchanged. The extension does not patch OpenAI `instructions`
or developer messages.

If a target is absent from all system instructions, the extension discards every patch, reports
the missing target, and aborts the current agent turn. Invalid or unreadable settings and replacement
files are reported and the request continues unchanged.

## Development

```bash
npm install
npm run check
npm test
```

`mise run check` runs the same checks and tests. It binds `PI_PACKAGE_DIR` to the
repository's Pi dependency for the in-process SDK tests so an inherited value cannot
select another runtime's package metadata. The binding applies only to that task.

### Live validation

Run `mise run test:live` to test the packed extension through the shipped Pi CLI
with the existing Anthropic login. The minimum supported Pi version is 0.87.0, and
the test asserts that the selected CLI reports exactly that tested version. It
verifies outgoing system replacements, configuration changes, prompt reload, and
session resume:

- the assistant reply and the observed provider payload carry the configured
  replacement;
- after `SYSTEM.md` changes and an extension-triggered reload, the provider payload
  carries the new prompt revision, so a no-op reload fails; and
- after a CLI restart on the same session file, the session ID, the assistant
  history, and the recorded observations are unchanged before the next turn, so a
  fresh session fails.

Tests use isolated configuration, a temporary `HOME`, and synthetic prompts. The
global Pi configuration is not read.

By default the test packs the working directory with `npm pack`. Set
`PI_PACKAGE_ARCHIVE` to test a prepared archive instead. A relative path is resolved
from the current working directory. An empty value, a missing file, a directory,
an empty file, or malformed archive contents fail the test. It never falls back
to packing the worktree.

Set `PI_TEST_CLI_PATH` to the `dist/bundle/cli.js` of another Pi 0.87.0 installation
to test that executable. Each CLI subprocess sets `PI_PACKAGE_DIR` to the selected
executable's package directory. The Mise task also binds `PI_PACKAGE_DIR` to the
repository's Pi dependency for the token lookup and the test process. Neither
setting changes other Pi launches.

## Try locally

```bash
pi --no-extensions -e .
```

## Release staging

1. Run `npm run release -- X.Y.Z` from a clean, synchronized `main`.
2. The command refuses to start unless the branch is `main`, the worktree and index
   are clean, `HEAD` matches `origin/main`, the tag does not exist, and
   `CHANGELOG.md` has the version's section. It then updates and stages the version
   in `package.json` and `package-lock.json`, builds the exact package from the
   staged files, and runs `mise run test:live` with `PI_PACKAGE_ARCHIVE` set to that
   archive. Only after that test passes does it record the archive's SHA-256 in an
   SSH-signed release commit, prove a clean rebuild of the committed tree is
   reproducible, and create a lightweight tag. The rebuild does not repeat the live
   test. A missing prerequisite, a live test that cannot start, or a failing live
   test stops the release before the commit and tag.
3. Inspect the result, then push atomically with `git push --atomic origin main vX.Y.Z`.
4. A read-only GitHub Actions job validates and packs the package. After approval in the tag-restricted `npm-publish` environment, a separate GitHub-owned job verifies the signature and signed digest before attesting and staging that exact archive through npm trusted publishing.
5. A final job creates the immutable GitHub release for the tag from the same verified archive, its
   checksum, and the version's `CHANGELOG.md` section (`Unreleased` for prereleases).
6. Approve the staged package on npmjs.com, or with `npm stage approve <stage-id>`.

Stable releases use `latest`; prereleases derive their npm dist-tag from the first prerelease identifier.

### Recovering from a failed release

Inspect before changing anything:

```bash
git status --short
git diff -- package.json package-lock.json
git diff --cached -- package.json package-lock.json
git log --oneline -1
git tag --list 'vX.Y.Z'
```

If a prerequisite check failed, nothing changed.

If the command failed during the version update, version changes can remain in
the worktree. Once the update and `git add` succeed, those changes remain staged
after a package, live-test, or signing failure. No release commit or tag was
created by that attempt. Undo only its version edits in the worktree and index.
Preserve concurrent edits, including edits in those same files, and do not stage
whole files containing unrelated changes.
Do not use blanket `git restore`, `git reset`, or `git clean` commands. Fix the cause
and verify `git status --short` is empty before running the release command again.

If the command failed after signing (a rejected commit signature or an
irreproducible rebuild), the signed release commit exists on local `main` and no
tag exists. Do not rerun the release command, and do not push the commit: its
recorded digest has not been proven reproducible. Removing or amending that commit
rewrites local history and requires an explicit, reviewed recovery decision.

If the command failed after creating the tag, both the commit and the local tag
exist. Removing the tag or the commit likewise requires an explicit, reviewed
recovery decision. Do not rerun or push after this failure either. Never
force-push or delete remote refs.
