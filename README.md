# pi-system-prompt-patcher

Patch provider system prompts with exact, provider-aware, config-driven replacements.

The extension rewrites the top-level `system` field and `role: "system"` entries in `messages`
immediately before Pi sends a compatible provider request. It supports string prompts and arrays
of text content blocks. It ignores payloads without either form of system instructions.

Requires Pi `>=0.86.0 <0.87.0`.

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

Run `mise run test:live` to test the packed extension through the shipped Pi
0.86.0 CLI with the existing Anthropic login. It verifies outgoing system
replacements, configuration changes, prompt reload, and session resume.
Tests use isolated configuration and synthetic prompts.

## Try locally

```bash
pi --no-extensions -e .
```

## Release staging

1. Run `npm run release -- X.Y.Z` from a clean, synchronized `main`.
2. The command builds the exact package locally and requires its live CLI test to pass before creating a release commit. It then records its SHA-256 in an SSH-signed release commit, proves a clean rebuild is reproducible, and creates a lightweight tag. Missing credentials or failing live tests stop the release.
3. Inspect the result, then push atomically with `git push --atomic origin main vX.Y.Z`.
4. A read-only GitHub Actions job validates and packs the package. After approval in the tag-restricted `npm-publish` environment, a separate GitHub-owned job verifies the signature and signed digest before attesting and staging that exact archive through npm trusted publishing.
5. A final job creates the immutable GitHub release for the tag from the same verified archive, its
   checksum, and the version's `CHANGELOG.md` section (`Unreleased` for prereleases).
6. Approve the staged package on npmjs.com, or with `npm stage approve <stage-id>`.

Stable releases use `latest`; prereleases derive their npm dist-tag from the first prerelease identifier.
