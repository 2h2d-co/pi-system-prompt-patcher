# pi-system-prompt-patcher

Patch provider system prompts with exact, provider-aware, config-driven replacements.

The extension rewrites the `system` field in compatible provider requests immediately before Pi
sends them. It supports string prompts and arrays of text content blocks, and ignores request
payloads without a `system` field.

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
- applied to every occurrence of each target;
- selected by provider and, when configured, model;
- loaded again with the settings for every provider request, so changes do not require `/reload`;
- applied atomically—the provider payload is not mutated.

If a target is absent, the extension leaves the request unchanged, reports the missing target,
and aborts the current agent turn. Invalid or unreadable settings and replacement files are
reported and the request continues unchanged.

## Development

```bash
npm install
npm run check
npm test
```

## Try locally

```bash
pi --no-extensions -e .
```

## Release staging

1. Run `npm run release -- X.Y.Z` from a clean, synchronized `main`.
2. The command builds the exact package locally, records its SHA-256 in an SSH-signed release commit, proves a clean rebuild is reproducible, and creates a lightweight tag.
3. Inspect the result, then push atomically with `git push --atomic origin main vX.Y.Z`.
4. A read-only GitHub Actions job validates and packs the package. After approval in the tag-restricted `npm-publish` environment, a separate GitHub-owned job verifies the signature and signed digest before attesting and staging that exact archive through npm trusted publishing.
5. Approve the staged package on npmjs.com, or with `npm stage approve <stage-id>`.

Stable releases use `latest`; prereleases derive their npm dist-tag from the first prerelease identifier.
