/**
 * Checks shared by validate.mjs and add-entry.mjs. Node built-ins only.
 *
 * checkSchema runs registry.schema.json through a small JSON Schema reader. It
 * implements only the keywords that schema uses and throws on any other, so the
 * schema cannot quietly say more than this checker enforces.
 *
 * crossCheck holds the rules a schema cannot express. The server's own contract
 * is parseRegistry in server/src/plugins/remote.ts of the photoscout repo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_REGISTRY = path.join(ROOT, 'registry.json');
const SCHEMA_FILE = path.join(ROOT, 'registry.schema.json');

/** remote.ts refuses a registry file larger than this. */
export const MAX_REGISTRY_BYTES = 1024 * 1024;

const KEYWORDS = new Set([
  '$schema', '$id', '$comment', '$defs', 'title', 'description', 'default', 'examples',
  '$ref', 'type', 'const', 'enum', 'required', 'properties', 'additionalProperties', 'items',
  'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum',
]);

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const pointerTo = (base, key) => `${base}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function matchesType(type, v) {
  switch (type) {
    case 'object': return kindOf(v) === 'object';
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return Number.isSafeInteger(v);
    default: throw new Error(`registry.schema.json uses unknown type "${type}"`);
  }
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`registry.schema.json: only local $ref is supported, got ${ref}`);
  let node = root;
  for (const part of ref.slice(2).split('/')) node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  if (node === undefined) throw new Error(`registry.schema.json: unresolved $ref ${ref}`);
  return node;
}

function checkNode(schema, value, at, root, errors) {
  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key)) throw new Error(`registry.schema.json uses "${key}", which scripts/registry-lib.mjs does not implement`);
  }
  if (schema.$ref !== undefined) return checkNode(resolveRef(root, schema.$ref), value, at, root, errors);
  const fail = (message) => errors.push({ at, message });

  if (schema.type !== undefined && !matchesType(schema.type, value)) {
    return fail(`expected ${schema.type}, got ${kindOf(value)}`);
  }
  if (has(schema, 'const') && !same(schema.const, value)) fail(`must be ${JSON.stringify(schema.const)}`);
  if (schema.enum !== undefined && !schema.enum.some((e) => same(e, value))) fail(`must be one of ${schema.enum.join(', ')}`);

  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) fail(`must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && length > schema.maxLength) fail(`must be at most ${schema.maxLength} characters (is ${length})`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
      fail(`invalid format: ${schema.description ?? schema.pattern}`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`allows at most ${schema.maxItems} item(s)`);
    if (schema.items !== undefined) value.forEach((item, i) => checkNode(schema.items, item, pointerTo(at, i), root, errors));
  }
  if (kindOf(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (!has(value, key)) fail(`missing required field "${key}"`);
    }
    const props = schema.properties ?? {};
    for (const key of Object.keys(value)) {
      const childAt = pointerTo(at, key);
      if (has(props, key)) checkNode(props[key], value[key], childAt, root, errors);
      else if (schema.additionalProperties === false) errors.push({ at: childAt, message: 'is not a known field' });
      else if (kindOf(schema.additionalProperties) === 'object') checkNode(schema.additionalProperties, value[key], childAt, root, errors);
    }
  }
}

/** Schema errors for a parsed registry. Empty when the shape is right. */
export function checkSchema(value) {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  const errors = [];
  checkNode(schema, value, '', schema, errors);
  return errors;
}

// --- semver -------------------------------------------------------------------------

const CORE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseSemver(text) {
  const m = CORE.exec(text);
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

export function compareSemver(a, b) {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  const n = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < n; i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      if (x !== y) return Number(x) < Number(y) ? -1 : 1;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** The highest stable version; the highest of any kind when none is stable. */
export function pickLatest(versions) {
  const parsed = versions.map((text) => ({ text, sv: parseSemver(text) })).filter((x) => x.sv);
  const stable = parsed.filter((x) => x.sv.pre.length === 0);
  const pool = stable.length ? stable : parsed;
  if (!pool.length) return undefined;
  return pool.reduce((best, x) => (compareSemver(x.sv, best.sv) > 0 ? x : best)).text;
}

// A close approximation of semver.validRange for the forms people write (>=1.2.0,
// ^1, ~2.3, 1.x, 1.2.3 - 2.0.0, ||). The server's semver library is authoritative.
const OP = '(?:<=|>=|<|>|=|~>|~|\\^)?';
const PARTIAL = 'v?(?:\\d+|[xX*])(?:\\.(?:\\d+|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?';
const COMPARATOR = new RegExp(`^${OP}${PARTIAL}$`);
const HYPHEN = new RegExp(`^${PARTIAL}\\s+-\\s+${PARTIAL}$`);

export function isSemverRange(text) {
  return text.split('||').every((part) => {
    const set = part.trim().replace(/(<=|>=|<|>|=|~>|~|\^)\s+/g, '$1');
    if (set === '') return false;
    if (HYPHEN.test(set)) return true;
    return set.split(/\s+/).every((token) => COMPARATOR.test(token));
  });
}

// --- cross-field rules --------------------------------------------------------------

/** Rules a schema cannot state. Only meaningful on a registry that passed checkSchema. */
export function crossCheck(registry) {
  const errors = [];
  const warnings = [];
  const seen = new Map();

  registry.plugins.forEach((plugin, i) => {
    const base = `/plugins/${i}`;
    const fail = (at, message) => errors.push({ at, message });
    const warn = (at, message) => warnings.push({ at, message });

    if (seen.has(plugin.id)) fail(`${base}/id`, `"${plugin.id}" is listed twice (first at /plugins/${seen.get(plugin.id)})`);
    else seen.set(plugin.id, i);

    const versions = plugin.versions.map((r) => r.version);
    versions.forEach((v, j) => {
      if (versions.indexOf(v) !== j) fail(`${base}/versions/${j}/version`, `${v} is listed twice in ${plugin.id}`);
    });
    if (!versions.includes(plugin.latest)) {
      fail(`${base}/latest`, `"${plugin.latest}" is not one of the versions (${versions.join(', ')})`);
    } else {
      const best = pickLatest(versions);
      if (best !== plugin.latest) warn(`${base}/latest`, `latest is ${plugin.latest}, but the highest stable version is ${best}`);
    }

    plugin.versions.forEach((release, j) => {
      const at = `${base}/versions/${j}`;
      let url = null;
      try {
        url = new URL(release.zip);
      } catch {
        fail(`${at}/zip`, 'is not a valid URL');
      }
      if (url) {
        if (url.protocol !== 'https:') fail(`${at}/zip`, 'must be an https URL');
        if (url.username || url.password) fail(`${at}/zip`, 'must not contain credentials');
      }
      if (release.minCore !== undefined && !isSemverRange(release.minCore)) {
        fail(`${at}/minCore`, `"${release.minCore}" is not a semver range`);
      }
      if (/^(.)\1{63}$/.test(release.sha256)) {
        warn(`${at}/sha256`, 'is one character repeated, so it is a placeholder. Put the real sha256 of the released zip here.');
      }
    });
  });
  return { errors, warnings };
}

/** Schema first; the cross-field rules only run once the shape is right. */
export function checkRegistry(data) {
  const errors = checkSchema(data);
  if (errors.length) return { errors, warnings: [] };
  return crossCheck(data);
}

/** Read, size-check, parse and check a registry file. `data` is set only when there are no errors. */
export function validateRegistryFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { errors: [{ at: '', message: `cannot read the file: ${err.message}` }], warnings: [] };
  }
  if (Buffer.byteLength(text) > MAX_REGISTRY_BYTES) {
    return { errors: [{ at: '', message: 'the file is larger than 1 MiB, the limit the server applies' }], warnings: [] };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { errors: [{ at: '', message: `not valid JSON: ${err.message}` }], warnings: [] };
  }
  const problems = checkRegistry(data);
  return problems.errors.length ? problems : { ...problems, data };
}

export function summarize(registry) {
  const versions = registry.plugins.reduce((n, p) => n + p.versions.length, 0);
  return `${registry.plugins.length} plugin(s), ${versions} version(s)`;
}

export function printProblems(label, { errors = [], warnings = [] }) {
  for (const w of warnings) console.log(`warning ${label} ${w.at || '/'}: ${w.message}`);
  for (const e of errors) console.log(`error ${label} ${e.at || '/'}: ${e.message}`);
}
