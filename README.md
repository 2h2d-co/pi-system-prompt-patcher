# pi-system-prompt-patcher

Patch provider system prompts with exact, config-driven replacements.

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
[
  {
    "target": "Exact text from the original system prompt",
    "replacement": "Replacement text"
  }
]
```

When `PI_CODING_AGENT_DIR` is set, the extension reads the configuration from that directory
instead of `~/.pi/agent`.

Replacements are:

- applied in array order;
- applied to every occurrence of each target;
- loaded again for every provider request, so configuration changes do not require `/reload`;
- applied atomically—the provider payload is not mutated.

If a target is absent, the extension leaves the request unchanged, reports the missing target,
and aborts the current agent turn. Invalid or unreadable configuration is reported and the request
continues unchanged.

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

The GitHub Actions workflow stages npm releases when a `v*` tag is pushed. The tag must match the
`package.json` version, point at a commit whose subject is `release: v<version>`, and be a
lightweight tag. Create it with `git tag v<version>`; do not use `git tag -a`, `git tag -s`,
`git tag -m`, or `cog bump --annotated`.
