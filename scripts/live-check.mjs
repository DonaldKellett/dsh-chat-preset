#!/usr/bin/env node
/**
 * dsh-chat-preset live loader check (DeepSeek Harness internals).
 *
 * This is a maintainer tool, not part of normal user verification. It runs the
 * harness's OWN Loader YAML dialect, expression evaluator, and plugin Config
 * schemas against preset/chat.patch.yml, so it catches the failures static YAML
 * checks cannot:
 *
 *   - a `!!js` expression that does not evaluate in the row's context;
 *   - a child plugin package name that does not resolve;
 *   - a child row whose `config` fails the plugin's own schema;
 *   - a plugin that throws during activation for a reason other than a missing
 *     host service.
 *
 * It must run inside the DeepSeek Harness Electron binary, because only that
 * binary can read modules out of `app.asar`:
 *
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   & "C:\...\DeepSeek Harness.exe" "C:\...\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
 *       scripts/live-check.mjs
 *
 * Usage:
 *   <electron> [--expose-internals] scripts/live-check.mjs [--preset PATH] [--quiet]
 *
 * Exit code 0 when every row resolves, validates, and activates, 1 otherwise.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

const argv = process.argv.slice(2);
const options = { preset: join(REPO_ROOT, 'preset/chat.patch.yml'), quiet: false };
for (let i = 0; i < argv.length; i += 1) {
  const key = argv[i];
  const take = () => {
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${key} needs a value`);
    i += 1;
    return value;
  };
  if (key === '--preset') options.preset = resolve(take());
  else if (key === '--quiet') options.quiet = true;
  else if (key === '-h' || key === '--help') {
    console.log('Usage: <electron> scripts/live-check.mjs [--preset PATH] [--quiet]');
    process.exit(0);
  } else if (key.startsWith('--expose')) {
    // Launcher-internal flag, ignored here.
  } else throw new Error(`unknown argument: ${key}`);
}

// ── locate the harness modules inside app.asar ──────────────────────────────
const DSH_MODULES = process.env.DSH_ASAR_MODULES
  ?? 'C:/Users/OseasyVM/AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh/node_modules';

const harnessRequire = createRequire(pathToFileURL(join(DSH_MODULES, 'noop.js')).href);
function harnessImport(specifier) {
  const resolved = harnessRequire.resolve(specifier);
  return import(pathToFileURL(resolved).href);
}

const report = { failed: 0, passed: 0 };
function note(ok, message, detail) {
  if (ok) report.passed += 1;
  else report.failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (detail) for (const line of String(detail).split('\n')) console.log(`      ${line}`);
}

// ── harness pieces ──────────────────────────────────────────────────────────
// The harness's entry-list dialect is JSON_SCHEMA plus a `!!js` scalar tag that
// keeps a Loader expression inert until the row activates. The shipped
// `@deepseek-ai/dsh-app-boot` does not re-export the schema object, so it is
// rebuilt here against the same js-yaml instance this script parses with.
const ownYaml = await harnessImport('js-yaml');
const yaml = ownYaml.default ?? ownYaml;

const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  predicate: (data) => data instanceof Object && '__jsExpr' in data,
  represent: (data) => data.__jsExpr,
});
const entryListSchema = yaml.JSON_SCHEMA.extend(JsExpr);

const { dshHomePath } = await harnessImport('@deepseek-ai/dsh-home-paths');

/** The Loader's own expression-node test (`isJsExpr` in cordis-plugin-loader). */
const isJsExpr = (value) => value instanceof Object && '__jsExpr' in value;

/** The Loader's own expression evaluator, reproduced from cordis-plugin-loader. */
const evaluate = new Function('ctx', 'expr', `
  with (ctx) {
    return eval(expr)
  }
`);

function interpolate(ctx, value) {
  if (isJsExpr(value)) return evaluate(ctx, value.__jsExpr);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => interpolate(ctx, item));
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = interpolate(ctx, item);
  return out;
}

// The evaluation context a preset's child row sees: the Loader context with
// `dshHomePath` provided at the root by dsh-app-boot, plus `process`.
const evaluationContext = Object.assign(Object.create(null), {
  dshHomePath,
  process,
  get: (name) => (name === 'dshHomePath' ? dshHomePath : undefined),
});

// ── load and layer the preset file ──────────────────────────────────────────
console.log(`preset  : ${options.preset}`);
console.log(`modules : ${DSH_MODULES}`);
console.log('');

// The schema's `!!js` tag and the loader must come from one js-yaml instance.
const raw = readFileSync(options.preset, 'utf8');
let patch;
try {
  patch = yaml.load(raw, { schema: entryListSchema, filename: options.preset });
  note(true, 'preset patch parses with the harness entry-list schema');
} catch (error) {
  note(false, 'preset patch parses with the harness entry-list schema', error.message);
  process.exit(1);
}

const declarations = (Array.isArray(patch) ? patch : [])
  .flatMap((row) => (Array.isArray(row?.insert) ? row.insert : []))
  .filter((row) => row?.name === '@deepseek-ai/dsh-agent-preset');

if (declarations.length !== 1) {
  note(false, 'exactly one @deepseek-ai/dsh-agent-preset row', `found ${declarations.length}`);
  process.exit(1);
}
const presetRow = declarations[0];
const presetConfig = interpolate(evaluationContext, structuredClone(presetRow.config));

// ── validate the declaration against its own schema ─────────────────────────
const AgentPresetMod = await harnessImport('@deepseek-ai/dsh-agent-preset');
let validated;
try {
  validated = AgentPresetMod.default.Config(presetConfig);
  note(true, 'preset declaration passes @deepseek-ai/dsh-agent-preset Config schema', `id=${validated.id}`);
} catch (error) {
  note(false, 'preset declaration passes @deepseek-ai/dsh-agent-preset Config schema', error.message);
  process.exit(1);
}

// ── mount units: the preset's top-level rows, groups preserved ──────────────
// A group row is a mount unit because `isolate` is the only way a preset may
// publish a service, and `isolate` lives on the group. Flattening groups away
// would hide the realm decision, which is exactly the mistake this check exists
// to catch.
const mountUnits = presetRow.config.plugins.map((row, index) => ({
  id: typeof row.id === 'string' && row.id !== '' ? row.id : `row-${index + 1}`,
  row,
  children: row.group === true ? (row.config ?? []) : [row],
  isolate: row.group === true && row.isolate ? row.isolate : {},
}));

const { Context } = await harnessImport('@deepseek-ai/cordis');

/**
 * Cordis accepts both plugin shapes: a function, or an object with `apply`.
 * A package may also be ESM (`default` is the plugin) or CJS interop (`default`
 * is module.exports, whose own `default` is the plugin).
 */
const isPlugin = (value) =>
  typeof value === 'function' || (value !== null && typeof value === 'object' && typeof value.apply === 'function');

/** Pick the plugin export out of a loaded module namespace. */
const pickPlugin = (mod) => [mod, mod?.default, mod?.default?.default].find(isPlugin);

/** Service names a context published into its own realm, keyed by symbol. */
const providedServices = (ctx) => {
  const found = new Map();
  for (const key of Object.getOwnPropertySymbols(ctx.reflect.store)) {
    const impl = ctx.reflect.store[key];
    if (impl !== undefined) found.set(key, impl.name);
  }
  return found;
};

/**
 * Service names a plugin declares it provides.
 *
 * `static provide` is inherited through the prototype chain, so a subclass of a
 * service class — `dsh-compaction-basic`'s engine extends `CompactionEngine` —
 * still reports its service. Most first-party plugins instead pass the name to
 * `super(ctx, "<name>")` inside the Service base constructor, which `provide`
 * never sees; that half is caught by the activation probe below.
 */
function declaredProvides(plugin) {
  const provide = plugin.provide;
  if (provide === undefined || provide === null) return [];
  const names = typeof provide === 'string' ? [provide] : Array.isArray(provide) ? provide : Object.keys(provide);
  const ignored = new Set(['optional', 'required', 'name']);
  return [...new Set(names.map(String).filter((name) => !ignored.has(name)))];
}

/**
 * A permissive stand-in for one injected service.
 *
 * A preset row may only CONSUME host-plane services, so stubbing them is
 * faithful: it lets the plugin reach its `Service` constructor, which is the
 * only point at which the real app can observe a service leak. A callable proxy
 * satisfies both property access and use as a function.
 */
function serviceStub() {
  const target = function stub() {};
  return new Proxy(target, {
    get: (_t, prop) => {
      // Never look thenable, and satisfy primitive coercion so a plugin that
      // stringifies an injected service does not throw on this stub.
      if (prop === 'then') return undefined;
      if (prop === Symbol.toPrimitive) return () => 'service-stub';
      if (prop === Symbol.toStringTag) return 'ServiceStub';
      if (prop === 'toString' || prop === 'valueOf') return () => 'service-stub';
      return serviceStub();
    },
    apply: () => serviceStub(),
    construct: () => serviceStub(),
  });
}

/** Names of the services this context published, keyed by symbol. */
function providedServiceNames(ctx) {
  const store = ctx.reflect?._store ?? ctx.reflect?.store;
  const found = new Set();
  if (!store || typeof store !== 'object') return found;
  for (const key of Object.getOwnPropertySymbols(store)) {
    const impl = store[key];
    if (impl !== undefined && typeof impl.name === 'string') found.add(impl.name);
  }
  return found;
}

/** One resolved child row. */
async function resolveChild(row) {
  const label = `${row.id} (${row.name})`;
  let mod;
  try {
    mod = await harnessImport(row.name);
  } catch (error) {
    note(false, `${label}: module resolves`, error.message);
    return undefined;
  }
  const plugin = pickPlugin(mod);
  if (plugin === undefined) {
    note(false, `${label}: module exports a Cordis plugin`, `exports: ${Object.keys(mod ?? {}).join(', ') || typeof mod}`);
    return undefined;
  }
  note(true, `${label}: module resolves and exports a Cordis plugin`);

  const childConfig = interpolate(evaluationContext, structuredClone(row.config ?? {}));
  if (typeof plugin.Config === 'function') {
    try {
      plugin.Config(childConfig);
      note(true, `${label}: config passes the plugin's own schema`);
    } catch (error) {
      note(false, `${label}: config passes the plugin's own schema`, error.message);
      return undefined;
    }
  } else {
    note(true, `${label}: plugin declares no Config schema`);
  }
  return { row, label, plugin, config: childConfig };
}

for (const unit of mountUnits) {
  const resolved = [];
  for (const row of unit.children) {
    const child = await resolveChild(row);
    if (child !== undefined) resolved.push(child);
  }

  // ── realm check: no service may leak into the root realm ──────────────────
  // This mirrors the registry's own audit (see `leakedServices` in
  // @deepseek-ai/dsh-agent-preset-registry): a service whose implementation
  // symbol is the one the ROOT context owns was published into the root realm,
  // and the registry then rejects the whole preset with
  //   "Preset services require isolate realms: <name>."
  // `isolate` on the owning group is what turns that into a realm-private
  // symbol instead.
  const providedByChild = new Map();
  for (const child of resolved) {
    const ctx = new Context();
    const baseline = providedServiceNames(ctx);
    for (const dependency of child.plugin.inject ?? []) ctx.provide(dependency, serviceStub());

    let activated = true;
    try {
      await ctx.plugin(child.plugin, child.config);
      await ctx.fiber.await();
    } catch (error) {
      const message = String(error?.message ?? error);
      // A missing host service is expected and harmless here; anything else is
      // the row's own failure.
      const pendingService = /cannot get|not provided|waiting for|inject/i.test(message);
      activated = pendingService;
      if (!pendingService) note(false, `${child.label}: activates without error`, message);
    }
    if (activated) note(true, `${child.label}: activates to a running fiber`);

    const nowProvided = [...providedServiceNames(ctx)].filter(
      (name) => !baseline.has(name) && !(child.plugin.inject ?? []).includes(name),
    );
    providedByChild.set(child.label, nowProvided.sort());

    for (const name of nowProvided) {
      if (unit.isolate[name] !== undefined) continue;
      note(
        false,
        `${child.label}: does not publish service "${name}" into the root realm`,
        `the preset mount fails with "Preset services require isolate realms: ${name}." — wrap this row in a group with "isolate: { ${name}: true }"`,
      );
    }

    await ctx.fiber.dispose().catch(() => {});
  }

  const providers = [...providedByChild].filter(([, names]) => names.length > 0);
  if (providers.length === 0) {
    note(true, `${unit.id}: provides no service, so no isolate realm is needed`);
  }
  for (const [label, names] of providers) {
    for (const name of names) {
      note(
        unit.isolate[name] !== undefined,
        `${unit.id}: service "${name}" from ${label} is isolated for this preset revision`,
        `add "${name}" to the group's isolate map`,
      );
    }
  }
}

// ── the skill root expression resolves as intended ──────────────────────────
const allChildRows = mountUnits.flatMap((unit) => unit.children);
const skillRow = allChildRows.find((row) => row.name === '@deepseek-ai/dsh-skill-filesystem');
if (!skillRow) {
  note(false, 'skill-filesystem row present');
} else {
  const resolvedDirs = interpolate(evaluationContext, structuredClone(skillRow.config?.customSkillDirs ?? []));
  const expected = dshHomePath('presets/chat/skills');
  note(
    resolvedDirs.length === 1 && resolve(resolvedDirs[0]) === resolve(expected),
    'skill-filesystem.customSkillDirs resolves to $DSH_HOME/presets/chat/skills',
    `resolved: ${JSON.stringify(resolvedDirs)}`,
  );
  note(
    skillRow.config?.includeDefaultRoots === false,
    'skill-filesystem.includeDefaultRoots is false (no project, user, or bundled roots)',
  );

  // End-to-end skill discovery: mount the real provider with this exact config
  // against a stub skill registry and ask it what it finds. This is the check
  // that proves `code-tutor` — and only code-tutor — reaches the Chat preset.
  const resolvedConfig = interpolate(evaluationContext, structuredClone(skillRow.config ?? {}));
  const SkillFsMod = await harnessImport('@deepseek-ai/dsh-skill-filesystem');
  const skillFsPlugin = pickPlugin(SkillFsMod);

  const discoveryCtx = new Context();
  let registered;
  try {
    discoveryCtx.provide('skills', {
      registerProvider: (factory) => {
        registered = factory({ invalidate: () => {}, signal: new AbortController().signal });
        return () => {};
      },
    });
    await discoveryCtx.plugin(skillFsPlugin, resolvedConfig);
    await discoveryCtx.fiber.await();

    if (registered === undefined) {
      note(false, 'skill-filesystem registers a provider on ctx.skills');
    } else {
      const listed = await registered.list({ cwd: REPO_ROOT });
      const candidates = Array.isArray(listed) ? listed : (listed?.candidates ?? []);
      const names = [...new Set(candidates.map((candidate) => candidate.name))].sort();
      note(
        names.length === 1 && names[0] === 'code-tutor',
        'the Chat preset skill root exposes exactly one skill: code-tutor',
        `discovered: ${names.join(', ') || '(none)'}`,
      );
      const candidate = candidates.find((entry) => entry.name === 'code-tutor');
      if (candidate) {
        const loaded = await registered.get(candidate, { cwd: REPO_ROOT, signal: new AbortController().signal });
        note(
          typeof loaded?.content === 'string' && loaded.content.includes('# Code tutor'),
          'the code-tutor body loads from disk',
          `provider=${loaded?.provider} source=${loaded?.source} bytes=${loaded?.content?.length ?? 0}`,
        );
      }
    }
  } catch (error) {
    note(false, 'skill discovery against the chat-preset skill root', String(error?.message ?? error));
  } finally {
    await discoveryCtx.fiber.dispose().catch(() => {});
  }
}

console.log('');
console.log(`${report.passed}/${report.passed + report.failed} live checks passed.`);
if (report.failed > 0) process.exit(1);
console.log('Every Chat preset row resolves and activates.');
