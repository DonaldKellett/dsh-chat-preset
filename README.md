# dsh-chat-preset

A **chat-only agent preset** and a **`code-tutor` skill** for DeepSeek Harness
(DSH).

The Chat preset turns a DSH session into a plain chatbot. It can read what you
type and the images you upload, it can search and fetch the web, and it can act
as a programming instructor through one skill. It has **no filesystem tools, no
shell, no background jobs, no subagents, no plan mode, and no goals** — so it
cannot read or change your working directory, and it cannot drive the machine
DSH runs on.

- [`preset/chat.patch.yml`](preset/chat.patch.yml) — the preset declaration.
- [`skills/code-tutor/SKILL.md`](skills/code-tutor/SKILL.md) — the skill.

---

## Table of contents

- [What you get](#what-you-get)
- [Requirements](#requirements)
- [Install](#install)
- [Use the Chat preset](#use-the-chat-preset)
- [Uninstall](#uninstall)
- [What the Chat preset can and cannot do](#what-the-chat-preset-can-and-cannot-do)
- [The code-tutor skill](#the-code-tutor-skill)
- [Verify an installation](#verify-an-installation)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Continuous integration](#continuous-integration)
- [Tested environment](#tested-environment)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## What you get

### The Chat preset

One session preset named **Chat**, selectable per session like the built-in
`standard`, `ptc`, `minimal`, and `cordis` presets. Inside it, the agent:

| Capability | Status |
|---|---|
| Read your typed prompts | yes |
| See images you upload or paste | yes |
| `web_search` (DeepSeek search) | yes |
| `web_fetch` (public HTTP/HTTPS pages) | yes |
| Load the `code-tutor` skill | yes |
| Ask you a clarifying question in the UI | yes |
| Long-conversation compaction | yes |
| Read or write files (`read`, `write`, `edit`, `glob`, `grep`) | **no** |
| Run shell commands (Bash / PowerShell) | **no** |
| Background jobs and terminals | **no** |
| Subagents, workflows, delegation | **no** |
| Plan mode, goals, to-dos | **no** |
| Read `AGENTS.md` / project instructions | **no** |

The exact child-plugin list is seven rows in
[`preset/chat.patch.yml`](preset/chat.patch.yml):

```
@deepseek-ai/dsh-persona
@deepseek-ai/dsh-skill-filesystem      (scans only the Chat skill root)
@deepseek-ai/dsh-tool-skill
@deepseek-ai/dsh-tool-web              (search + fetch)
@deepseek-ai/dsh-compaction-basic                     ┐ one cordis:group
@deepseek-ai/dsh-compaction-tool-result-pruner        ┘ carrying an isolate realm
@deepseek-ai/dsh-tool-ask-user
```

The two compaction rows share one `cordis:group` row carrying
`isolate: { compaction: true, toolResultPruner: true }`. That is required rather
than cosmetic: a DSH preset may not publish a service into the root realm, and
those two rows provide the `compaction` and `toolResultPruner` services. Without
the realm DSH rejects the entire preset with
`Preset services require isolate realms: compaction, toolResultPruner.` and it
never reaches the session picker. The realm also gives each preset revision its
own compaction backend, so two live sessions on different revisions never share
one.

Nothing else is mounted. In particular the preset deliberately does **not**
mount `dsh-tool-fs`, `dsh-tool-fs-search`, `dsh-tool-bash`, `dsh-tool-pwsh`,
`dsh-tool-jobs`, `dsh-terminal`, the subagent/workflow/Ralph delegation rows,
`dsh-tool-todo`, `dsh-plan-mode`, the goal rows, `dsh-tool-present` (it
publishes files as deliverables), `dsh-agent-instructions` (it reads
`AGENTS.md` out of the working directory), the plugin manager, or any
filesystem backend.

### The code-tutor skill

A programming-instructor skill: the model becomes the instructor and you are the
student. It hands you the code change **and** its precise location, explains what
each snippet does and why it works, and for from-scratch work gives only minimal
"Hello World" scaffolding plus the next few steps. It never dumps a complete
finished file and never implements a whole project for you.

The skill also carries an explicit, unconditional instruction never to read,
write, edit, or delete files and never to touch the operating system — even when
the surrounding harness offers those tools. That makes it portable: you can lift
`skills/code-tutor/` into another harness that has weaker sandboxing and the
instructor will still refuse to do your homework.

---

## Requirements

- **DeepSeek Harness**, version **0.2.0-rc.2** (see
  [Tested environment](#tested-environment)).
- An **agent-preset-capable profile**. The preset is an
  `@deepseek-ai/dsh-agent-preset` row, which the shipped `web` bundle (used by
  both the browser surface and the desktop app) provides. The default
  **`desktop`** profile qualifies.
- A **DeepSeek credential**. The preset reuses the same `DEEPSEEK_API_KEY` (or
  managed account credential) the chat model uses; `web_search` is served by the
  DeepSeek search provider on the same credential.
- **No third-party plugins or extra packages.** Everything the preset mounts
  ships with DSH.
- For the installer and verifier scripts: **Node.js 22+** (the desktop app's
  bundled Node is found automatically on Windows and macOS), and either
  **PowerShell 5.1+** or a **POSIX shell** (`bash` on Linux/macOS, or Git Bash on
  Windows).

---

## Install

Clone the repository, then run the installer for your shell. The installer is
idempotent: running it again replaces the previous installation.

### Windows (PowerShell)

PowerShell's default execution policy blocks local scripts, so invoke it with
`-ExecutionPolicy Bypass` (the script itself needs no elevated rights):

```powershell
git clone https://github.com/DonaldKellett/dsh-chat-preset.git
cd dsh-chat-preset
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

### Linux, macOS, or Git Bash on Windows

```bash
git clone https://github.com/DonaldKellett/dsh-chat-preset.git
cd dsh-chat-preset
./scripts/install.sh
```

### What the installer does

1. Copies the skill to `"$DSH_HOME/presets/chat/skills/code-tutor/SKILL.md"`.
   This is the **only** root the Chat preset scans, which is what makes
   `code-tutor` the only skill available inside it.
2. Copies the same skill to `"$DSH_HOME/skills/code-tutor/SKILL.md"` — the
   standard user skill root — so you can also use `code-tutor` from the built-in
   `standard`, `ptc`, `minimal`, and `cordis` presets, from any workspace, and in
   other DSH surfaces. Pass `--no-global-skill` (`-NoGlobalSkill`) to skip this.
3. Appends the preset declaration to the target profile's `cordis.patch.yml`,
   wrapped in `# >>> dsh-chat-preset ... >>>` / `# <<< dsh-chat-preset <<<`
   markers. Everything you had in that file is left alone. The block is written
   as UTF-8 with no byte-order mark and your file's existing line endings are
   preserved, so the file stays exactly as it was apart from the added block —
   an install followed by an uninstall restores it byte-for-byte.

`$DSH_HOME` defaults to `~/.dsh`. Override the profile or home if you need to:

```bash
./scripts/install.sh --profile desktop --dsh-home /home/me/.dsh
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Profile desktop -DshHome C:\Users\me\.dsh
```

### Activate

**Restart DeepSeek Harness.** The preset roster is composed at boot, so a
running instance will not see the new preset. After the restart the Chat preset
appears in the preset roster (Settings → **Agent presets**) and in the preset
picker in the composer. It stays installed across application and system
restarts — nothing here is session state.

---

## Use the Chat preset

1. Start a **new session**.
2. Choose **Chat** in the preset picker (or set it as the default under
   Settings → Agent presets).
3. Talk to it. Upload images and pasted screenshots freely — the model sees them
   directly. Ask for `/code-tutor`, or just ask a programming question and the
   model will load the skill itself when the task matches.

A preset can only be chosen while a session is blank, before its first turn.

---

## Uninstall

```bash
./scripts/uninstall.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

The uninstaller removes only what this project installed:

- the managed preset block from the profile's `cordis.patch.yml` (your other
  entries and their comments are preserved);
- `"$DSH_HOME/presets/chat/skills/code-tutor"` and the now-empty `presets/chat/`
  tree it created;
- `"$DSH_HOME/skills/code-tutor"` unless you pass `--keep-global-skill`
  (`-KeepGlobalSkill`).

It never deletes the `$DSH_HOME/skills` directory itself, so other skills you
keep there survive. **Restart DeepSeek Harness afterwards** to drop the preset
from the roster.

The install/uninstall cycle is safe to repeat: a clean uninstall followed by a
fresh install reproduces exactly the same state.

---

## What the Chat preset can and cannot do

### Guarantees

- **No filesystem access.** No filesystem backend is mounted and no filesystem
  tool is registered, so `read`, `write`, `edit`, `read_image`, `glob`, and
  `grep` do not exist for the model. There is no read-anywhere escape hatch,
  because there is no filesystem service in the preset's scope at all.
- **No command execution.** No shell, terminal, background-job, or subprocess
  tool is mounted.
- **No workspace instructions.** `dsh-agent-instructions` is not mounted, so
  `AGENTS.md` and similar files are never read.
- **No runtime-context leakage.** The persona row sets
  `includeRuntimeContext: false`, so the model receives no workspace, sandbox,
  approval, or delegation snapshots.
- **Exactly one skill.** The preset's skill provider sets
  `includeDefaultRoots: false`, which skips the project roots
  (`<project>/.dsh/skills`, `<project>/.agents/skills`), the user roots
  (`$DSH_HOME/skills`, `~/.agents/skills`), and the bundled office skills. Its
  single `customSkillDirs` entry is the dedicated Chat skill root.
- **No third-party code.** Every row is a first-party `@deepseek-ai/dsh-*`
  package that ships with DSH. Nothing is fetched, built, or installed at
  runtime.

### Known limitations

- **Uploaded non-image files are not readable in Chat.** A generic file
  attachment reaches the model only as a name, size, and read-only storage path.
  Reading that path requires the `read` tool, and the shipped filesystem
  backends (`dsh-fs-local`, `dsh-fs-sandbox`) have no read-path allowlist — they
  confine writes only. Mounting `read` to support uploads would therefore let
  the agent read *any* file on the machine, which defeats the point of the
  preset. The trade-off was made deliberately in favour of isolation: the Chat
  persona tells the model to say plainly that it cannot read the file and to ask
  you to paste the text, or to use a filesystem-enabled preset for that task.
  **Images are unaffected** — they are delivered to the model natively.
- **The web is a real outbound channel.** `web_fetch` can request any public
  HTTP/HTTPS URL, so anything the model puts in a URL leaves the machine. DSH's
  HTTP fetch provider blocks non-public destinations, but it does not ask for
  confirmation before a fetch. This is how the preset ships on purpose; if you
  prefer search-only, set `fetch: false` in
  [`preset/chat.patch.yml`](preset/chat.patch.yml) and reinstall.
- **The preset is not an OS sandbox.** It removes the agent's tools; it does not
  sandbox the DSH process. DSH's own sandbox and approval settings still apply
  to the process as a whole.
- **Sandbox mode is inert here.** Because Chat mounts no file or shell tools, the
  session's permission mode has nothing to act on.
- **Editing the preset from the GUI pins it.** Settings → Agent presets can
  write a complete config override for a preset into the profile patch. If you
  edit Chat there, the GUI's copy wins over the managed block and re-running
  `install.sh` will not change the live preset until that override is removed.
  Prefer editing [`preset/chat.patch.yml`](preset/chat.patch.yml) and
  reinstalling.

---

## The code-tutor skill

Invoke it explicitly with `/code-tutor`, or let the model load it when your
request matches its description.

**The instructor will:**

1. give the code needed to fix, improve, or extend what you showed;
2. say exactly where each change goes — file, function, class, method, or line
   range — and leave the editing to you;
3. explain every snippet: what it does, why it works, why that location, and
   what to watch;
4. for from-scratch work, give only minimal "Hello World" scaffolding, explain
   every component of it, and list the next two or three steps.

**The instructor will not:**

1. paste complete updated source files up front;
2. answer with unexplained code, a bare diff, or a link;
3. build a complete, working, non-trivial project for you.

**The instructor must never** (this is stated in the skill itself, so the rule
travels with the skill into other harnesses):

1. read, write, edit, create, move, rename, copy, or delete any file or
   directory;
2. interact with the operating system — no shell commands, no processes, no
   installs, no network, no system state;
3. ask for permission to do any of the above.

Work only from what you paste into the conversation or upload as an image. When
the instructor needs to see something, it asks you to paste it.

Because the skill text carries those three rules unconditionally, the skill is
safe to install into a harness that provides *no* agent sandboxing: even with
file and shell tools available, the instruction is to refuse them.

---

## Verify an installation

[`scripts/verify.mjs`](scripts/verify.mjs) performs offline structural checks on
an installed preset. It needs no running DSH instance.

```bash
./scripts/verify.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

It checks that the profile patch parses as Cordis entry-list YAML (including
`!!js` expressions), that the Chat preset row is present, enabled, uniquely
identified, and declares **exactly** the seven allow-listed child plugins with
none of the forbidden filesystem/shell/OS-capable families, that
`skill-filesystem` still scans only the Chat skill root with
`includeDefaultRoots: false`, that the installed skill files match the
repository copies, and that the Chat skill root exposes exactly `code-tutor`.

For full YAML validation, install the dev dependency first (`pnpm install` or
`npm install`); without it the verifier falls back to structural checks and says
so. The wrapper scripts look for Node.js on `PATH` first and then in the
desktop app's bundled runtime; set `DSH_BUNDLED_NODE` to the executable path to
override that search. Pass `--quiet` (`-Quiet`) for one line per check.

---

## Repository layout

```
preset/chat.patch.yml            The Chat preset declaration (a Cordis patch list).
skills/code-tutor/SKILL.md       The code-tutor skill.
scripts/install.{sh,ps1}         Install the preset + skill into a DSH home.
scripts/uninstall.{sh,ps1}       Remove exactly what install added.
scripts/verify.{sh,ps1}          Post-install structural checks (wrappers).
scripts/verify.mjs               The verifier itself (Node.js).
scripts/check-yaml.mjs           Repo-wide YAML + preset-shape validation (CI).
scripts/live-check.mjs           Maintainer tool: loads the preset with DSH's own
                                 Loader, expression evaluator, and plugin schemas.
tests/preset-shape.test.mjs      node:test suite over the preset and the skill.
.github/workflows/validate.yml   CI: YAML/JSON syntax, tests, shellcheck, actionlint.
.github/                         CI configuration.
package.json                     Dev tooling only (js-yaml); nothing is published.
.gitattributes                   Line-ending normalization (LF, except *.ps1).
```

There is **no source code and no custom plugin**. The preset is pure
configuration consumed by DSH's Cordis Loader, and the skill is Markdown. Nothing
needs to be compiled, so there is no build step and there are no build artifacts
to commit — [`.gitignore`](.gitignore) and [`.gitattributes`](.gitattributes)
together block compiled output on every platform in case a future change
introduces a custom plugin.

---

## Development

Validate the repository without installing anything:

```bash
pnpm install                 # only needed once, for js-yaml
pnpm run check:yaml          # YAML dialect + preset shape + skill frontmatter
pnpm test                    # the same guarantees through node --test
```

Re-run the install and verify it end to end:

```bash
./scripts/install.sh && ./scripts/verify.sh
```

### Maintainer: check the preset against the live harness

[`scripts/check-yaml.mjs`](scripts/check-yaml.mjs) proves the YAML is well
formed. [`scripts/live-check.mjs`](scripts/live-check.mjs) goes further: it loads
[`preset/chat.patch.yml`](preset/chat.patch.yml) with the harness's own
entry-list schema, evaluates each `!!js` expression with the Loader's own
evaluator, imports every child plugin package from `app.asar`, validates each row
against that plugin's own `Config` schema, activates each plugin in a pristine
Cordis context, and then mounts the real `skill-filesystem` provider against a
stub skill registry to confirm that `code-tutor` — and only `code-tutor` — is
discovered.

It must run inside the DeepSeek Harness Electron binary, because only that binary
can read modules out of `app.asar`:

```powershell
$env:ELECTRON_RUN_AS_NODE = 1
& "C:\Users\<you>\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe" `
    .\scripts\live-check.mjs
```

```bash
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
    ./scripts/live-check.mjs
```

A failing child row means DSH would report the preset as `broken` in the roster
(and `dsh --profile <name> --dump-config` would show it), so run this after any
edit to the preset.

### Changing the preset

[`preset/chat.patch.yml`](preset/chat.patch.yml) is the single source of truth.
After editing it, update the mirrored allow-lists in
[`scripts/check-yaml.mjs`](scripts/check-yaml.mjs) and
[`scripts/verify.mjs`](scripts/verify.mjs) — both files name the allowed and
forbidden child plugins — then reinstall and re-verify. `live-check` is the
authoritative test that a newly added row actually works.

---

## Continuous integration

[`.github/workflows/validate.yml`](.github/workflows/validate.yml) runs on every
push and pull request, on `ubuntu-latest`:

| Job | What it does |
|---|---|
| `config-syntax` | Parses every YAML file with `js-yaml` through the harness entry-list dialect (`!!js` tags included) and every JSON file with `jq`; then asserts the Chat preset's shape — exactly the seven allow-listed child plugins, none of the forbidden filesystem/shell families, the pinned skill root, and `includeDefaultRoots: false`. Fails if validation rewrote a tracked file. |
| `tests` | Runs `node --test`, which re-runs the preset-shape, skill-frontmatter, and repository-hygiene checks as a suite. |
| `shellcheck` | Lints `scripts/*.sh` with [ShellCheck](https://github.com/koalaman/shellcheck) at `--severity=warning`, from the release tarball published by ShellCheck's own maintainer, pinned to `v0.11.0`. |
| `actionlint` | Lints the workflow files themselves with [rhysd/actionlint](https://github.com/rhysd/actionlint), run from its own maintained Docker image. |

Existing first-party or widely used tooling is used wherever it fits; plain
shell commands (`curl`, `tar`, `jq`, `node`) cover the gaps rather than pulling in
an unnecessary third-party wrapper. There is no build job, because there is
nothing to build.

---

## Tested environment

| | |
|---|---|
| **DSH version** | `0.2.0-rc.2` (host protocol version 4) |
| **DSH surface** | DeepSeek Harness desktop app (Electron), profile **`desktop`** |
| **Bundled runtime** | Node.js `24.18.1`, pnpm `11.7.0` |
| **Operating system verified on** | Windows 11 x64 |
| **Likely to work on** | macOS and Linux with the same DSH version. The preset itself is OS-independent — it contains no paths, no platform-conditional rows, and no shell commands. Only the *installer scripts* have an OS dimension, and both a POSIX (`*.sh`) and a PowerShell (`*.ps1`) variant ship. |
| **Third-party dependencies** | **None.** Every plugin row is a first-party `@deepseek-ai/dsh-*` package shipped inside DSH. |
| **Node.js (host)** | Only for `scripts/*.mjs` and CI. The desktop app's bundled Node is found automatically on Windows and macOS; otherwise install Node.js 22+. |
| **Skill-install portability** | `skills/code-tutor/` is plain Markdown with YAML frontmatter and no DSH-specific syntax, so it can also be copied into `~/.agents/skills/code-tutor/` (shared agent config) or any other skill root. |

The preset definition uses `!!js dshHomePath('presets/chat/skills')` rather than
a hard-coded path, so it follows `$DSH_HOME` (falling back to `~/.dsh`) on any
machine and any OS.

---

## Troubleshooting

**The Chat preset does not appear in the roster.**
Restart DeepSeek Harness — the roster is composed at boot. If it still does not
appear, run `./scripts/verify.sh` and check that the managed block is present in
`$DSH_HOME/profiles/desktop/cordis.patch.yml`.

**The preset appears but is marked broken.**
A child row failed to mount. Run [`scripts/live-check.mjs`](scripts/live-check.mjs)
(see [Development](#development)) to see which one and why. The most likely cause
is a DSH version whose plugin package name or config schema has changed.

**Settings shows `Preset services require isolate realms: <name>.`**
A child plugin provides a service and is not wrapped in an isolation realm, so
DSH refuses to mount the preset and it will not appear in the session picker.
This affects the shipped configuration if you edit it: keep the two compaction
rows inside the `cordis:group` row whose `isolate` map names `compaction` and
`toolResultPruner`. If you add another service-providing plugin, activate it with
`live-check.mjs` — it names the service and the exact `isolate` entry to add.
`plugin.provide` does **not** list these names, so reading the plugin metadata is
not enough.

**The preset disappeared after I changed settings in the GUI.**
Settings → Agent presets can write a full config override for a preset into the
profile patch. Remove that override (or edit Chat from that page instead) and
re-run the installer.

**The agent says it cannot read my uploaded PDF.**
That is the documented trade-off, not a bug — see
[Known limitations](#known-limitations). Ask it to work from pasted text, or use
a filesystem-enabled preset for that task.

**`web_search` returns a provider error.**
Search rides the same DeepSeek credential as chat. Check your account or
`DEEPSEEK_API_KEY`.

**PowerShell refuses to run the script.**
Use `powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1`, or run the
Bash variant from Git Bash.

---

## License

[MIT](LICENSE) © Donald Sebastian Leung
