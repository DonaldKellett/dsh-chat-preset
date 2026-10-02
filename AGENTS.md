# AGENTS.md

Instructions for AI agents and maintainers working **in this repository**. This
file describes how to change the project correctly; it is not user
documentation — that is [README.md](README.md).

---

## What this repository is

A DeepSeek Harness (DSH) **agent preset** named `chat`, shipped as a Cordis patch
list, plus one **skill** named `code-tutor`.

There is **no build step, no source code, and no custom plugin**:

| Artifact | Kind | Consumed by |
|---|---|---|
| [`preset/chat.patch.yml`](preset/chat.patch.yml) | Cordis entry-list YAML | DSH's Loader, via the profile's `cordis.patch.yml` |
| [`skills/code-tutor/SKILL.md`](skills/code-tutor/SKILL.md) | Markdown + YAML frontmatter | `@deepseek-ai/dsh-skill-filesystem` |
| [`scripts/*.mjs`](scripts) | Node.js maintainer/CI tooling | developers and GitHub Actions |
| [`scripts/*.sh`](scripts), [`scripts/*.ps1`](scripts) | installers / uninstallers / wrappers | end users |

Nothing is compiled and nothing is published to a package registry. If you ever
add native or compiled output, `.gitignore` already blocks it and the README's
build section must be filled in.

---

## The one invariant that matters

**The Chat preset must remain incapable of touching the filesystem or the
operating system.**

Concretely, the preset's `config.plugins` list may only ever contain rows from
this allow-list:

```
@deepseek-ai/dsh-persona
@deepseek-ai/dsh-skill-filesystem
@deepseek-ai/dsh-tool-skill
@deepseek-ai/dsh-tool-web
@deepseek-ai/dsh-compaction-basic
@deepseek-ai/dsh-compaction-tool-result-pruner
@deepseek-ai/dsh-tool-ask-user
```

and must never contain a plugin matching any of these families:

```
dsh-tool-fs            dsh-tool-fs-search     dsh-tool-bash
dsh-tool-pwsh          dsh-tool-jobs          dsh-terminal
dsh-tool-subagent      dsh-tool-workflow      dsh-workflow
dsh-tool-ralph         dsh-tool-todo          dsh-plan-mode
dsh-tool-goal          dsh-command-goal       dsh-tool-present
dsh-agent-instructions dsh-plugin-manager     dsh-skill-office
dsh-fs-local           dsh-fs-sandbox
```

The allow-list and the forbidden list are **mirrored in three places** and must
stay in sync:

1. [`preset/chat.patch.yml`](preset/chat.patch.yml) — the actual composition.
2. [`scripts/check-yaml.mjs`](scripts/check-yaml.mjs) — `ALLOWED_CHILD_PLUGINS`
   and `FORBIDDEN_CHILD_PLUGIN_PATTERNS`.
3. [`scripts/verify.mjs`](scripts/verify.mjs) — `ALLOWED_PLUGINS` and
   `FORBIDDEN_PATTERNS`.

Adding a row without updating 2 and 3 will fail CI. Adding a *safe* row means
adding it to all three, plus the README capability table.

Two related rules:

- `skill-filesystem` must keep `includeDefaultRoots: false` and exactly one
  `customSkillDirs` entry, `!!js dshHomePath('presets/chat/skills')`. This is
  what makes `code-tutor` the only skill visible in Chat.
- `persona` must keep `includeRuntimeContext: false` so no workspace, sandbox,
  approval, or delegation snapshot reaches the model.

---

## Validating a change

Run these in order. The first two need no DSH install; the third needs DSH.

```bash
pnpm install                 # once, for js-yaml
pnpm run check:yaml          # YAML dialect, preset shape, skill frontmatter
pnpm test                    # same guarantees through node --test
```

```bash
# End-to-end against a real DSH home (writes to $DSH_HOME):
./scripts/install.sh
./scripts/verify.sh
```

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

Deployment-marker smoke test — shows the composed profile with the preset row
last and confirms the Loader accepts the YAML (works even with the desktop
profile, which `dsh` refuses to boot directly):

```bash
dsh --profile <scratch> --from-default-profile web --dump-config   # once
cp "$DSH_HOME/profiles/desktop/cordis.patch.yml" "$DSH_HOME/profiles/<scratch>/"
dsh --profile <scratch> --dump-config | tail -40
```

### The authoritative check: `scripts/live-check.mjs`

[`scripts/live-check.mjs`](scripts/live-check.mjs) is the strongest test in the
repository and is **required after any edit to the preset**. It runs inside the
DSH Electron binary (only that binary can read `app.asar`) and:

1. parses `preset/chat.patch.yml` with the harness entry-list schema, including
   `!!js` tags;
2. evaluates every `!!js` expression with the Loader's own evaluator
   (`new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')`);
3. validates the declaration against `@deepseek-ai/dsh-agent-preset`'s `Config`;
4. resolves every child plugin package from `app.asar`, unwraps the ESM/CJS
   interop (`mod.default.default` for CJS), validates the row against that
   plugin's own `Config` schema, and activates it in a pristine `Context`;
5. mounts the real `skill-filesystem` provider against a stub skill registry and
   asserts that `code-tutor`, and only `code-tutor`, is discovered and loads.

```powershell
$env:ELECTRON_RUN_AS_NODE = 1
& "C:\Users\<you>\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe" `
    .\scripts\live-check.mjs
```

Set `DSH_ASAR_MODULES` to override the `app.asar/dsh/node_modules` location on a
non-default install.

If this reports a failing child row, DSH would show the preset as `broken`, so do
not commit until it is green.

---

## Gotchas learned the hard way

- **`@deepseek-ai/dsh-app-boot` does not re-export `entryListSchema`** in the
  shipped build (it exports `LOADER_EXPRESSION_SCHEMA`, `generateConfigSchema`,
  `isNativeConfigSchema`). `scripts/live-check.mjs` rebuilds the `!!js` type
  locally. The `yaml.Type` instance and the `yaml.load` call **must come from the
  same js-yaml module instance**, or the tag is rejected as unknown.
- **Cordis has two plugin shapes**: a function, or an object with `apply`. Also,
  importing a CJS package through `import()` yields
  `{ default: { default: plugin } }`. Always unwrap defensively.
- **The desktop profile cannot be booted by `dsh`** ("managed exclusively by the
  Electron application"). Use a scratch profile created with
  `--from-default-profile web` for `--dump-config` checks.
- **The managed block is the install unit.** `install.*` appends
  `preset/chat.patch.yml` verbatim between
  `# >>> dsh-chat-preset (managed block - do not edit by hand) >>>` and
  `# <<< dsh-chat-preset <<<`. Keep those marker strings byte-identical between
  `install.sh`/`install.ps1` and `uninstall.sh`/`uninstall.ps1`.
- **`Set-Content -Encoding utf8` writes a BOM under Windows PowerShell 5.1.**
  Harmless for YAML here, but do not introduce a BOM-sensitive format.
- **The GUI's Agent-presets editor writes a full `config` override** for a
  preset into the profile patch, which then shadows the managed block. Document
  it; do not try to fight it.
- **`read_image` needs both a filesystem service and an attachment store.** Chat
  has neither, which is intentional. Do not "fix" it by mounting `tool-fs`:
  `fs-local` and `fs-sandbox` confine *writes* only, so mounting `read` would
  expose the entire host filesystem.
- **Skill bodies are loaded as tool results.** Keep
  [`skills/code-tutor/SKILL.md`](skills/code-tutor/SKILL.md) under 8192
  characters, the standard `tool-result-pruner` threshold; `check-yaml.mjs`
  enforces it. Frontmatter `name` must be kebab-case and match the directory
  name.
- **The skill's own "must never" clause is load-bearing.** It is what makes the
  skill safe to extract into a harness with no agent sandboxing (for example
  OpenClaw). Never weaken, soften, or remove that section, and never make it
  conditional on which tools the agent has.

---

## Commit and CI conventions

- CI is [`.github/workflows/validate.yml`](.github/workflows/validate.yml):
  `yaml-json`, `tests`, `shellcheck`, `actionlint`. All four must pass.
- Keep `shellcheck` clean: quote expansions, avoid `ls` parsing, and prefer
  `rm -rf`/`rmdir` guards over `find -delete`.
- Prefer several focused commits over one large commit.
- Never commit `node_modules/`, lockfile churn from an unrelated package manager,
  or any build artifact. See [`.gitignore`](.gitignore).

---

## Where the DSH mechanics are documented

The repository vendors no DSH documentation. When you need to know how presets,
scopes, service planes, or the Loader work, read it out of the installed harness:

- Installed package READMEs live inside `app.asar` under
  `dsh/node_modules/@deepseek-ai/<package>/README.md`. The `cordis_inspect_*`
  tools also expose live Config schemas for every mounted plugin.
- The shipped reference preset patches are the best worked examples:
  `@deepseek-ai/dsh-web-app/presets/{standard,minimal,ptc,cordis}.patch.yml`, and
  `@deepseek-ai/dsh-agent-preset/skills/cordis-composition-reference/SKILL.md`
  for the patch dialect (`insert`, `id` overrides, `cordis:group`, `disabled`,
  `isolate`, `!!js`).
- Key facts: a preset mounts in its **own Cordis scope**; a service a preset
  *provides* must be wrapped in an `isolate` realm or the mount is rejected;
  services a preset only *consumes* (`ctx.web`, `ctx.skills`, `ctx.tools`,
  `ctx.systemPrompt`, `ctx.attachments`) live on the host plane and need no row.
