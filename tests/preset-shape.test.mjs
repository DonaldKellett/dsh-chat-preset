/**
 * Node test-runner suite over the shipped configuration.
 *
 * These tests re-derive the guarantees from the files themselves rather than
 * shelling out to the validation scripts, so a bug in a script cannot hide a bug
 * in the preset.
 *
 * Run: node --test tests/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRESET_FILE = join(REPO_ROOT, 'preset', 'chat.patch.yml');
const SKILL_FILE = join(REPO_ROOT, 'skills', 'code-tutor', 'SKILL.md');

const AGENT_PRESET_PLUGIN = '@deepseek-ai/dsh-agent-preset';

const ALLOWED_CHILD_PLUGINS = [
  '@deepseek-ai/dsh-persona',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-tool-web',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-compaction-tool-result-pruner',
  '@deepseek-ai/dsh-tool-ask-user',
];

const FORBIDDEN_CHILD_PLUGIN_PATTERNS = [
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

const yaml = (await import('js-yaml')).default;

/** The harness entry-list dialect: JSON_SCHEMA plus a `!!js` expression tag. */
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  predicate: (data) => data instanceof Object && '__jsExpr' in data,
  represent: (data) => data.__jsExpr,
});
const entryListSchema = yaml.JSON_SCHEMA.extend(JsExpr);

function loadPreset() {
  return yaml.load(readFileSync(PRESET_FILE, 'utf8'), { schema: entryListSchema, filename: PRESET_FILE });
}

function presetRow() {
  const declarations = (loadPreset() ?? [])
    .flatMap((row) => (Array.isArray(row?.insert) ? row.insert : []))
    .filter((row) => row?.name === AGENT_PRESET_PLUGIN);
  assert.equal(declarations.length, 1, 'exactly one @deepseek-ai/dsh-agent-preset row is required');
  return declarations[0];
}

function childPluginNames() {
  const names = [];
  const collect = (rows) => {
    for (const row of rows ?? []) {
      if (row?.group === true) collect(row.config);
      else if (typeof row?.name === 'string') names.push(row.name);
    }
  };
  collect(presetRow().config?.plugins);
  return names;
}

// ── YAML dialect ────────────────────────────────────────────────────────────

test('the preset patch parses with !!js loader expressions preserved', () => {
  const parsed = loadPreset();
  assert.ok(Array.isArray(parsed), 'the patch must be a top-level list');

  const skillRow = parsed
    .flatMap((row) => row.insert ?? [])
    .flatMap((row) => row.config?.plugins ?? [])
    .find((row) => row?.name === '@deepseek-ai/dsh-skill-filesystem');

  assert.ok(skillRow, 'the skill-filesystem row must exist');
  const dirs = skillRow.config.customSkillDirs;
  assert.ok(Array.isArray(dirs) && dirs.length === 1, 'customSkillDirs must hold exactly one entry');
  assert.equal(
    dirs[0]?.__jsExpr,
    "dshHomePath('presets/chat/skills')",
    'the skill root must stay a portable dshHomePath loader expression',
  );
});

// ── declaration shape ───────────────────────────────────────────────────────

test('the preset declaration carries identity and ordering metadata', () => {
  const row = presetRow();
  assert.equal(row.id, 'preset-chat');
  assert.notEqual(row.disabled, true, 'the preset row must not be disabled');
  assert.equal(row.config.id, 'chat');
  assert.equal(typeof row.config.name, 'string');
  assert.ok(row.config.name.trim().length > 0);
  assert.equal(typeof row.config.description, 'string');
  assert.ok(row.config.description.trim().length > 0);
  assert.equal(typeof row.config.order, 'number');
});

// ── the isolation invariant ─────────────────────────────────────────────────

test('the preset declares exactly the allow-listed child plugins', () => {
  const names = childPluginNames();
  assert.deepEqual([...names].sort(), [...ALLOWED_CHILD_PLUGINS].sort());
});

test('the preset declares no filesystem, shell, or OS-capable plugin', () => {
  const forbidden = childPluginNames().filter((name) =>
    FORBIDDEN_CHILD_PLUGIN_PATTERNS.some((pattern) => pattern.test(name)),
  );
  assert.deepEqual(forbidden, [], `forbidden child plugins present: ${forbidden.join(', ')}`);
});

test('no child plugin resolves outside the first-party @deepseek-ai/dsh-* family', () => {
  const foreign = childPluginNames().filter((name) => !name.startsWith('@deepseek-ai/dsh-'));
  assert.deepEqual(foreign, [], `third-party child plugins present: ${foreign.join(', ')}`);
});

test('skill-filesystem scans only the chat-preset root', () => {
  const row = presetRow().config.plugins.find((child) => child?.name === '@deepseek-ai/dsh-skill-filesystem');
  assert.ok(row, 'the skill-filesystem row must exist');
  assert.equal(row.config.includeDefaultRoots, false, 'project, user, and bundled roots must all be skipped');
  assert.equal(row.config.customSkillDirs.length, 1);
});

test('the persona suppresses runtime context', () => {
  const row = presetRow().config.plugins.find((child) => child?.name === '@deepseek-ai/dsh-persona');
  assert.ok(row, 'the persona row must exist');
  assert.equal(row.config.includeRuntimeContext, false);
  assert.equal(row.config.complete, false, 'tool guidance and skill catalog rules must remain in the prompt');
});

test('web access is search plus fetch', () => {
  const row = presetRow().config.plugins.find((child) => child?.name === '@deepseek-ai/dsh-tool-web');
  assert.ok(row, 'the tool-web row must exist');
  assert.equal(row.config.search, true);
  assert.equal(row.config.fetch, true);
});

// ── the skill ───────────────────────────────────────────────────────────────

test('the skill directory name matches the frontmatter name', () => {
  assert.ok(existsSync(SKILL_FILE), `${SKILL_FILE} must exist`);
  const text = readFileSync(SKILL_FILE, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  assert.ok(match, 'SKILL.md must open with a YAML frontmatter block');
  const frontmatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
  assert.equal(frontmatter.name, 'code-tutor');
  assert.match(frontmatter.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'the name must be kebab-case');
  assert.equal(typeof frontmatter.description, 'string');
  assert.ok(frontmatter.description.trim().length > 0, 'a description is required');
});

test('the skill frontmatter uses only supported keys', () => {
  const text = readFileSync(SKILL_FILE, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  const frontmatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
  const supported = new Set(['name', 'description', 'whenToUse', 'metadata', 'disable-model-invocation', 'user-invocable']);
  const extra = Object.keys(frontmatter).filter((key) => !supported.has(key));
  assert.deepEqual(extra, [], `unsupported frontmatter keys: ${extra.join(', ')}`);
});

test('the skill stays under the 8192-char tool-result pruner threshold', () => {
  const text = readFileSync(SKILL_FILE, 'utf8');
  assert.ok(text.length < 8192, `SKILL.md is ${text.length} chars`);
});

test('the skill states the unconditional no-filesystem, no-OS boundary', () => {
  const text = readFileSync(SKILL_FILE, 'utf8');
  // The clause must be present, must be a prohibition, and must be unconditional
  // so the skill remains safe when extracted into a harness without sandboxing.
  assert.match(text, /MUST NEVER/, 'the hard boundary section must use MUST NEVER');
  assert.match(text, /[Rr]ead, write, edit, create, move, rename, copy, or delete any file/);
  assert.match(text, /interact with the operating system/);
  assert.match(text, /regardless of what tools you have been given/i, 'the boundary must not depend on the available tools');
  assert.doesNotMatch(text, /if you have (?:no|don't have) .*tools/i, 'the boundary must not be tool-conditional');
});

test('the skill forbids complete files, unexplained code, and full implementations', () => {
  const text = readFileSync(SKILL_FILE, 'utf8');
  assert.match(text, /No complete updated files up front/);
  assert.match(text, /No unexplained code/);
  assert.match(text, /No complete end-to-end implementation/);
});

// ── repository hygiene ──────────────────────────────────────────────────────

test('no build artifacts are committed', () => {
  const artifacts = [];
  const skip = new Set(['node_modules', '.git']);
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(dll|exe|so|dylib|node|pdb|obj|lib)$/i.test(entry)) artifacts.push(full);
    }
  };
  walk(REPO_ROOT);
  assert.deepEqual(artifacts, [], `compiled artifacts found: ${artifacts.join(', ')}`);
});

test('.gitignore blocks compiled output', () => {
  const ignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
  for (const pattern of ['node_modules/', '*.dll', '*.exe', '*.so', '*.dylib', '*.node']) {
    assert.ok(ignore.includes(pattern), `.gitignore must contain a "${pattern}" rule`);
  }
});
