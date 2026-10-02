#!/usr/bin/env node
/**
 * dsh-chat-preset YAML validator.
 *
 * Parses every YAML file this repository ships with the same dialect DeepSeek
 * Harness uses for its Cordis entry lists, including the `!!js` loader-expression
 * tag, and then asserts the shape the Chat preset must have.
 *
 * Requires the devDependency `js-yaml` (see README: `pnpm install`).
 *
 * Usage:
 *   node scripts/check-yaml.mjs [--quiet]
 *
 * Exit code 0 when every file parses and the preset shape holds, 1 otherwise.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const QUIET = process.argv.includes('--quiet');

let yaml;
try {
  yaml = (await import('js-yaml')).default;
} catch (error) {
  console.error('error: js-yaml is required. Run: pnpm install (or npm install)');
  console.error(String(error.message));
  process.exit(2);
}

/** The harness entry-list dialect: JSON_SCHEMA plus a `!!js` expression tag. */
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  predicate: (data) => data instanceof Object && '__jsExpr' in data,
  represent: (data) => data.__jsExpr,
});
const entryListSchema = yaml.JSON_SCHEMA.extend(JsExpr);

/** Every YAML file in the repository, excluding dependency and VCS trees. */
function listYamlFiles(root) {
  const skip = new Set(['node_modules', '.git', '.github']);
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.ya?ml$/i.test(entry)) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

const problems = [];
const note = (message) => {
  problems.push(message);
  console.error(`FAIL  ${message}`);
};
const pass = (message) => {
  if (!QUIET) console.log(`PASS  ${message}`);
};

// ── 1. every YAML file parses ───────────────────────────────────────────────
const files = listYamlFiles(REPO_ROOT);
if (files.length === 0) note('no YAML files found to validate');

const parsed = new Map();
for (const file of files) {
  const rel = relative(REPO_ROOT, file).replaceAll('\\', '/');
  try {
    parsed.set(rel, yaml.load(readFileSync(file, 'utf8'), { schema: entryListSchema, filename: file }));
    pass(`${rel} parses as entry-list YAML`);
  } catch (error) {
    note(`${rel} failed to parse: ${error.message}`);
  }
}

// ── 2. the preset file has the required shape ───────────────────────────────
const PRESET_FILE = 'preset/chat.patch.yml';
const preset = parsed.get(PRESET_FILE);

const EXPECTED_ID = 'chat';
const EXPECTED_PRESET_ROW_ID = 'preset-chat';
const EXPECTED_AGENT_PRESET_PLUGIN = '@deepseek-ai/dsh-agent-preset';
const EXPECTED_SKILL_ROOT_EXPR = "dshHomePath('presets/chat/skills')";

/** Child rows the Chat preset is allowed to declare, in order. */
const ALLOWED_CHILD_PLUGINS = [
  '@deepseek-ai/dsh-persona',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-tool-web',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-compaction-tool-result-pruner',
  '@deepseek-ai/dsh-tool-ask-user',
];

/** Plugin families that must never appear in the Chat preset. */
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

if (!preset) {
  note(`${PRESET_FILE} did not parse, so its shape cannot be checked`);
} else {
  if (!Array.isArray(preset)) {
    note(`${PRESET_FILE} must be a top-level list of patch rows`);
  } else {
    const inserts = preset.filter((row) => row && typeof row === 'object' && Array.isArray(row.insert));
    const rows = inserts.flatMap((row) => row.insert);
    const declarations = rows.filter(
      (row) => row && typeof row === 'object' && row.name === EXPECTED_AGENT_PRESET_PLUGIN,
    );

    if (declarations.length !== 1) {
      note(`${PRESET_FILE} must declare exactly one "${EXPECTED_AGENT_PRESET_PLUGIN}" row (found ${declarations.length})`);
    } else {
      const row = declarations[0];
      pass(`${PRESET_FILE} declares exactly one ${EXPECTED_AGENT_PRESET_PLUGIN} row`);

      if (row.id !== EXPECTED_PRESET_ROW_ID) note(`preset row id must be "${EXPECTED_PRESET_ROW_ID}", found "${row.id}"`);
      if (row.disabled === true) note('preset row must not be disabled');
      if (row.config?.id !== EXPECTED_ID) note(`config.id must be "${EXPECTED_ID}", found "${row.config?.id}"`);
      if (typeof row.config?.name !== 'string' || row.config.name.trim() === '') note('config.name must be a non-empty string');
      if (typeof row.config?.description !== 'string' || row.config.description.trim() === '') note('config.description must be a non-empty string');
      if (typeof row.config?.order !== 'number') note('config.order should be a number so the roster sorts predictably');

      const children = row.config?.plugins;
      if (!Array.isArray(children) || children.length === 0) {
        note('config.plugins must be a non-empty list');
      } else {
        const names = [];
        const collect = (list) => {
          for (const child of list) {
            if (!child || typeof child !== 'object') continue;
            if (child.group === true) collect(child.config ?? []);
            else if (typeof child.name === 'string') names.push(child.name);
          }
        };
        collect(children);

        const unexpected = names.filter((n) => !ALLOWED_CHILD_PLUGINS.includes(n));
        if (unexpected.length > 0) note(`undeclared child plugin(s): ${unexpected.join(', ')}`);
        const missing = ALLOWED_CHILD_PLUGINS.filter((n) => !names.includes(n));
        if (missing.length > 0) note(`missing required child plugin(s): ${missing.join(', ')}`);
        const forbidden = names.filter((n) => FORBIDDEN_CHILD_PLUGIN_PATTERNS.some((re) => re.test(n)));
        if (forbidden.length > 0) note(`forbidden child plugin(s) present: ${forbidden.join(', ')}`);
        if (unexpected.length === 0 && missing.length === 0 && forbidden.length === 0) {
          pass(`${PRESET_FILE} declares exactly the ${ALLOWED_CHILD_PLUGINS.length} allow-listed child plugins`);
        }
      }

      // The skill root must stay pinned to the chat-preset directory, as a
      // loader expression, so `code-tutor` remains the only visible skill.
      const skillRow = (row.config?.plugins ?? []).find(
        (child) => child?.name === '@deepseek-ai/dsh-skill-filesystem',
      );
      if (!skillRow) {
        note('the skill-filesystem row is missing');
      } else {
        const cfg = skillRow.config ?? {};
        if (cfg.includeDefaultRoots !== false) {
          note('skill-filesystem.includeDefaultRoots must be false so only the chat-preset skill root is scanned');
        }
        const dirs = cfg.customSkillDirs;
        const entries = Array.isArray(dirs) ? dirs : [dirs];
        const ok = entries.length === 1 && entries[0]?.__jsExpr === EXPECTED_SKILL_ROOT_EXPR;
        if (!ok) {
          note(`skill-filesystem.customSkillDirs must be exactly [!!js ${EXPECTED_SKILL_ROOT_EXPR}]`);
        } else {
          pass('skill-filesystem scans exactly the chat-preset skill root');
        }
      }

      const personaRow = (row.config?.plugins ?? []).find((child) => child?.name === '@deepseek-ai/dsh-persona');
      if (!personaRow) {
        note('the persona row is missing');
      } else if (personaRow.config?.includeRuntimeContext !== false) {
        note('persona.includeRuntimeContext must be false so no workspace/sandbox runtime context leaks in');
      } else {
        pass('persona suppresses runtime context and shadows the deployment persona');
      }
    }
  }
}

// ── 3. the skill frontmatter ────────────────────────────────────────────────
const SKILL_FILE = 'skills/code-tutor/SKILL.md';
const skillPath = join(REPO_ROOT, SKILL_FILE);
if (!existsSync(skillPath)) {
  note(`${SKILL_FILE} is missing`);
} else {
  const text = readFileSync(skillPath, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) {
    note(`${SKILL_FILE} has no YAML frontmatter block`);
  } else {
    let frontmatter;
    try {
      frontmatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
      pass(`${SKILL_FILE} frontmatter parses as YAML`);
    } catch (error) {
      note(`${SKILL_FILE} frontmatter failed to parse: ${error.message}`);
    }
    if (frontmatter) {
      const extra = Object.keys(frontmatter).filter(
        (key) => !['name', 'description', 'whenToUse', 'metadata', 'disable-model-invocation', 'user-invocable'].includes(key),
      );
      if (extra.length > 0) note(`${SKILL_FILE} frontmatter has unsupported key(s): ${extra.join(', ')}`);
      if (frontmatter.name !== 'code-tutor') note(`${SKILL_FILE} frontmatter name must be "code-tutor"`);
      if (typeof frontmatter.description !== 'string' || frontmatter.description.trim() === '') {
        note(`${SKILL_FILE} frontmatter needs a non-empty description`);
      }
      if (frontmatter.name === 'code-tutor' && typeof frontmatter.description === 'string' && extra.length === 0) {
        pass(`${SKILL_FILE} frontmatter is valid for the filesystem skill provider`);
      }
      if (text.length >= 8192) {
        note(`${SKILL_FILE} is ${text.length} chars; the standard tool-result pruner trims at 8192`);
      } else {
        pass(`${SKILL_FILE} is ${text.length} chars (under the 8192-char pruner threshold)`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error('');
  console.error(`${problems.length} problem(s) found.`);
  process.exit(1);
}
if (!QUIET) console.log('');
console.log(`${files.length} YAML file(s) validated; the Chat preset shape and code-tutor skill are valid.`);
