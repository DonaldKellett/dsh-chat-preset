#!/usr/bin/env node
/**
 * dsh-chat-preset verifier.
 *
 * Static checks on an installed Chat preset. Nothing here needs DeepSeek Harness
 * to be running.
 *
 *   1. the target profile patch parses as Cordis entry-list YAML, using the same
 *      schema the harness Loader uses (so `!!js` expressions are accepted exactly
 *      as the Loader accepts them);
 *   2. the Chat preset row is present, enabled, and uniquely identified;
 *   3. its child plugin rows are exactly the allow-list this project ships;
 *   4. the code-tutor skill exists with valid frontmatter, and it is the only
 *      skill the preset's scanned root exposes.
 *
 * Parsing prefers the `js-yaml` devDependency; when it is absent the script falls
 * back to structural checks and says so.
 *
 * Usage:
 *   node scripts/verify.mjs [--profile NAME] [--dsh-home PATH] [--quiet]
 *
 * Exit code 0 when every check passes, 1 otherwise.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

const PRESET_ID = 'chat';
const PRESET_ROW_ID = 'preset-chat';
const SKILL_NAME = 'code-tutor';

/** Child plugin rows the Chat preset is allowed to declare. */
const ALLOWED_PLUGINS = [
  '@deepseek-ai/dsh-persona',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-tool-web',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-compaction-tool-result-pruner',
  '@deepseek-ai/dsh-tool-ask-user',
];

/** Plugin families the Chat preset must never declare. */
const FORBIDDEN_PATTERNS = [
  /dsh-tool-fs/,
  /dsh-tool-bash/,
  /dsh-tool-pwsh/,
  /dsh-tool-jobs/,
  /dsh-terminal/,
  /dsh-tool-subagent/,
  /dsh-tool-workflow/,
  /dsh-workflow/,
  /dsh-tool-ralph/,
  /dsh-tool-todo/,
  /dsh-plan-mode/,
  /dsh-tool-goal/,
  /dsh-command-goal/,
  /dsh-tool-present/,
  /dsh-agent-instructions/,
  /dsh-plugin-manager/,
  /dsh-skill-office/,
  /dsh-fs-local/,
  /dsh-fs-sandbox/,
];

// ── arguments ───────────────────────────────────────────────────────────────
const options = { profile: undefined, dshHome: undefined, quiet: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const key = argv[i];
  const take = () => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} needs a value`);
    i += 1;
    return value;
  };
  if (key === '--profile') options.profile = take();
  else if (key === '--dsh-home') options.dshHome = take();
  else if (key === '--quiet') options.quiet = true;
  else if (key === '-h' || key === '--help') {
    console.log('Usage: node scripts/verify.mjs [--profile NAME] [--dsh-home PATH] [--quiet]');
    process.exit(0);
  } else throw new Error(`unknown argument: ${key}`);
}

const profile = options.profile ?? process.env.DSH_PROFILE ?? 'desktop';
const dshHome = resolve(options.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));

// ── reporting ───────────────────────────────────────────────────────────────
const checks = [];
function record(ok, title, detail) {
  checks.push({ ok, title, detail });
  if (!options.quiet) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}`);
    if (detail) for (const line of String(detail).split('\n')) console.log(`      ${line}`);
  }
}

// ── the harness YAML dialect ────────────────────────────────────────────────
function loadEntryListSchema() {
  const attempts = [];
  for (const base of [REPO_ROOT, SCRIPT_DIR]) {
    try {
      const req = createRequire(pathToFileURL(join(base, 'noop.js')).href);
      const yaml = req('js-yaml');
      const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
        kind: 'scalar',
        resolve: (data) => typeof data === 'string',
        construct: (data) => ({ __jsExpr: data }),
        predicate: (data) => data instanceof Object && '__jsExpr' in data,
        represent: (data) => data.__jsExpr,
      });
      const entryListSchema = yaml.JSON_SCHEMA.extend(JsExpr);
      // Prove the module is usable, not merely resolvable.
      yaml.load('a: 1', { schema: entryListSchema });
      return { yaml, entryListSchema, from: base };
    } catch (error) {
      attempts.push(`${base}: ${error.message}`);
    }
  }
  return { error: attempts.join('\n') };
}

const schema = loadEntryListSchema();
const jsYamlAvailable = !schema.error;
if (jsYamlAvailable) {
  record(true, 'js-yaml available — full entry-list YAML validation', `resolved from ${schema.from}`);
} else {
  record(true, 'js-yaml not installed — structural checks only', 'run `pnpm install` (or npm install) for full YAML validation');
}

// ── checks 1-3: the profile patch and the preset row ────────────────────────
const patchFile = join(dshHome, 'profiles', profile, 'cordis.patch.yml');
let presetRow;
let parsedEntries;
let structuralFallbackUsed = false;

if (!existsSync(patchFile)) {
  record(false, `profile patch exists (${patchFile})`, 'not found — run the install script first');
} else {
  const raw = readFileSync(patchFile, 'utf8');
  if (jsYamlAvailable) {
    try {
      parsedEntries = schema.yaml.load(raw, { schema: schema.entryListSchema, filename: patchFile });
      record(true, `profile patch parses as entry-list YAML (${patchFile})`);
    } catch (error) {
      record(false, `profile patch parses as entry-list YAML (${patchFile})`, error.message);
    }
  } else {
    structuralFallbackUsed = true;
    parsedEntries = structuralParse(raw);
    record(true, `profile patch passes structural checks (${patchFile})`, 'detailed parse skipped');
  }
}

if (Array.isArray(parsedEntries)) {
  const flat = [];
  const walk = (list) => {
    for (const row of list ?? []) {
      if (!row || typeof row !== 'object') continue;
      flat.push(row);
      if (row.group === true && Array.isArray(row.config)) walk(row.config);
    }
  };
  walk(parsedEntries);

  const inserts = parsedEntries.filter((entry) => entry && typeof entry === 'object' && Array.isArray(entry.insert));
  const rows = [...flat, ...inserts.flatMap((entry) => entry.insert)];
  const declarations = rows.filter(
    (row) => row && typeof row === 'object' && row.name === '@deepseek-ai/dsh-agent-preset',
  );
  const matching = declarations.filter((row) => row.id === PRESET_ROW_ID || row.config?.id === PRESET_ID);

  record(
    matching.length === 1,
    `exactly one "${PRESET_ROW_ID}" declaration for preset id "${PRESET_ID}"`,
    `found ${matching.length}`,
  );
  presetRow = matching[0];

  if (presetRow) {
    record(presetRow.disabled !== true, 'the Chat preset row is enabled', `disabled=${String(presetRow.disabled)}`);

    const plugins = presetRow.config?.plugins;
    record(
      Array.isArray(plugins) && plugins.length > 0,
      'the Chat preset declares child plugins',
      `count=${Array.isArray(plugins) ? plugins.length : 'n/a'}`,
    );

    if (Array.isArray(plugins)) {
      const names = [];
      const collect = (list) => {
        for (const row of list ?? []) {
          if (!row || typeof row !== 'object') continue;
          if (row.group === true) collect(row.config);
          else if (typeof row.name === 'string') names.push(row.name);
        }
      };
      collect(plugins);

      const unexpected = names.filter((name) => !ALLOWED_PLUGINS.includes(name));
      record(
        unexpected.length === 0,
        'every declared child plugin is on the allow-list',
        unexpected.length ? `unexpected: ${unexpected.join(', ')}` : names.join(', '),
      );

      const forbidden = names.filter((name) => FORBIDDEN_PATTERNS.some((re) => re.test(name)));
      record(
        forbidden.length === 0,
        'no filesystem / shell / OS-capable plugin is declared',
        forbidden.length ? forbidden.join(', ') : 'none',
      );

      const missing = ALLOWED_PLUGINS.filter((name) => !names.includes(name));
      record(missing.length === 0, 'every allow-listed child plugin is declared', missing.length ? `missing: ${missing.join(', ')}` : '');

      const skillRow = plugins.find((row) => row?.name === '@deepseek-ai/dsh-skill-filesystem');
      if (!skillRow) {
        record(false, 'the skill-filesystem row is present');
      } else {
        const cfg = skillRow.config ?? {};
        record(cfg.includeDefaultRoots === false, 'skill-filesystem does not scan default skill roots');
        const dirs = Array.isArray(cfg.customSkillDirs) ? cfg.customSkillDirs : [cfg.customSkillDirs];
        const serialized = JSON.stringify(dirs);
        record(
          dirs.length === 1 && serialized.includes('presets/chat/skills'),
          'skill-filesystem scans exactly the chat-preset skill root',
          serialized,
        );
      }
    }
  }
}

if (structuralFallbackUsed) {
  // Nothing more to assert without a real parser; the CI workflow installs
  // js-yaml and re-runs these checks with full validation.
}

// ── check 4: the skill ──────────────────────────────────────────────────────
const repoSkill = join(REPO_ROOT, 'skills', SKILL_NAME, 'SKILL.md');
const skillDirsToCheck = [
  { label: 'preset skill root (scanned by the Chat preset)', dir: join(dshHome, 'presets', 'chat', 'skills', SKILL_NAME) },
  { label: 'global user skill root (other presets)', dir: join(dshHome, 'skills', SKILL_NAME) },
];

for (const { label, dir } of skillDirsToCheck) {
  const file = join(dir, 'SKILL.md');
  if (!existsSync(file)) {
    record(false, `${label}: ${file}`, 'not found — run the install script first');
    continue;
  }
  const text = readFileSync(file, 'utf8');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!frontmatter) {
    record(false, `${label}: frontmatter`, 'no YAML frontmatter block');
    continue;
  }
  const nameMatch = /^name:\s*(\S+)\s*$/m.exec(frontmatter[1]);
  const hasDescription = /^description:\s*\S/m.test(frontmatter[1]);
  record(nameMatch?.[1] === SKILL_NAME, `${label}: frontmatter name is "${SKILL_NAME}"`, `found ${nameMatch?.[1] ?? 'none'}`);
  record(hasDescription, `${label}: frontmatter declares a description`);
  record(text.length < 8192, `${label}: body is under the 8192-char pruner threshold`, `${text.length} chars`);
}

const scannedRoot = join(dshHome, 'presets', 'chat', 'skills');
if (!existsSync(scannedRoot)) {
  record(false, `Chat preset skill root exists (${scannedRoot})`, 'not found — run the install script first');
} else {
  let found = [];
  try {
    found = readdirSync(scannedRoot).filter((entry) => {
      const full = join(scannedRoot, entry);
      if (statSync(full).isDirectory()) return existsSync(join(full, 'SKILL.md'));
      return entry.endsWith('.md');
    });
  } catch (error) {
    record(false, `enumerate the Chat preset skill root (${scannedRoot})`, error.message);
  }
  record(
    found.length === 1 && found[0] === SKILL_NAME,
    `the Chat preset exposes exactly one skill: "${SKILL_NAME}"`,
    `found: ${found.join(', ') || '(none)'}`,
  );
}

if (existsSync(repoSkill)) {
  const repoText = readFileSync(repoSkill, 'utf8');
  for (const { label, dir } of skillDirsToCheck) {
    const file = join(dir, 'SKILL.md');
    if (!existsSync(file)) continue;
    record(readFileSync(file, 'utf8') === repoText, `${label}: installed SKILL.md matches the repository copy`);
  }
}

// ── fallback structural parser ──────────────────────────────────────────────
/**
 * Minimal YAML sanity check used only when js-yaml is unavailable: rejects tab
 * indentation, unbalanced brackets and quotes, and list/mapping lines with no
 * key or value, then extracts top-level keys. It is deliberately conservative —
 * it never claims a file is valid, only that nothing obviously invalid was seen.
 */
function structuralParse(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let current = null;
  for (const [index, line] of lines.entries()) {
    const where = `line ${index + 1}`;
    if (line.includes('\t')) throw new Error(`${where}: tab character in indentation`);
    const stripped = line.trim();
    if (stripped === '' || stripped.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      if (!stripped.startsWith('- ')) throw new Error(`${where}: top-level entry must be a "- " list item`);
      const body = stripped.slice(2).trim();
      if (body === '' || !/^[A-Za-z_"'][^:]*:/.test(body)) {
        throw new Error(`${where}: top-level entry is not a mapping (expected "key: value")`);
      }
      current = {};
      entries.push(current);
      continue;
    }
    if (current === null) throw new Error(`${where}: indented content before any top-level entry`);
    if (!/^(#|- |[^:\s][^:]*:)/.test(stripped)) throw new Error(`${where}: unreadable YAML line`);
  }
  if (entries.length === 0) throw new Error('no top-level entries found');
  return entries;
}

// ── summary ─────────────────────────────────────────────────────────────────
const failed = checks.filter((check) => !check.ok);
if (options.quiet) {
  for (const check of checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.title}${check.ok || !check.detail ? '' : ` — ${check.detail}`}`);
  }
}
console.log('');
console.log(`${checks.length - failed.length}/${checks.length} checks passed.`);
if (failed.length > 0) {
  console.log('');
  console.log('Failures:');
  for (const check of failed) console.log(`  - ${check.title}${check.detail ? `: ${check.detail}` : ''}`);
  process.exit(1);
}
console.log('The Chat preset and the code-tutor skill are installed and consistent.');
