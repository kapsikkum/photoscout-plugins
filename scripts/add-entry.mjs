#!/usr/bin/env node
/**
 * Insert or update one plugin version in registry.json, then re-validate it.
 *
 *   node scripts/add-entry.mjs --id <id> --name <name> --category <cat> \
 *     --version <semver> --zip <https url> --sha256 <64 hex> \
 *     [--description <text>] [--author <text>] [--homepage <url>] \
 *     [--minCore <range>] [--size <bytes>] [--registry <file>] [--dry-run] [--force]
 *
 * - A new id appends a plugin. An existing id keeps its entry; name and category
 *   are replaced, and description, author and homepage are replaced when given.
 * - A new version is appended. A version already listed with the same sha256 is
 *   updated in place. One with a different sha256 is refused unless --force is
 *   given, because installs of that version would then disagree with the registry.
 * - `latest` becomes the highest stable version (the highest of any kind when
 *   none is stable). Versions are kept in ascending order.
 * - The result is validated before anything is written. The file is then written,
 *   read back and validated again. If that fails, the original text is restored.
 *
 * Exit status: 0 written (or dry run passed), 1 refused or invalid, 2 bad usage.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_REGISTRY,
  checkRegistry,
  compareSemver,
  parseSemver,
  pickLatest,
  printProblems,
  summarize,
  validateRegistryFile,
} from './registry-lib.mjs';

const USAGE = `usage: node scripts/add-entry.mjs --id <id> --name <name> --category <cat>
                       --version <semver> --zip <https url> --sha256 <64 hex>
                       [--description <text>] [--author <text>] [--homepage <url>]
                       [--minCore <range>] [--size <bytes>] [--registry <file>]
                       [--dry-run] [--force]`;

const REQUIRED = ['id', 'name', 'category', 'version', 'zip', 'sha256'];
const VALUED = new Set([...REQUIRED, 'description', 'author', 'homepage', 'minCore', 'size', 'registry']);
const FLAGGED = new Set(['dry-run', 'force']);

class UsageError extends Error {}
class RefusedError extends Error {}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new UsageError(`unexpected argument "${arg}"`);
    const key = arg.slice(2);
    if (FLAGGED.has(key)) {
      opts[key] = true;
      continue;
    }
    if (!VALUED.has(key)) throw new UsageError(`unknown option --${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`--${key} needs a value`);
    opts[key] = value;
    i++;
  }
  for (const key of REQUIRED) if (opts[key] === undefined) throw new UsageError(`--${key} is required`);
  if (!parseSemver(opts.version)) throw new UsageError('--version must be a plain semver version, such as 1.2.3');
  if (!/^[0-9a-fA-F]{64}$/.test(opts.sha256)) throw new UsageError('--sha256 must be 64 hex characters');
  if (opts.size !== undefined && !/^\d+$/.test(opts.size)) throw new UsageError('--size must be a whole number of bytes');
  return opts;
}

/** The plugin-level fields that were given on the command line. */
function pluginFields(opts) {
  const out = {};
  for (const key of ['description', 'author', 'homepage']) if (opts[key] !== undefined) out[key] = opts[key];
  return out;
}

/** The registry with this release in it, and a short account of what changed. */
function upsert(registry, opts) {
  const next = structuredClone(registry);
  const release = { version: opts.version, zip: opts.zip, sha256: opts.sha256.toLowerCase() };
  if (opts.minCore !== undefined) release.minCore = opts.minCore;
  if (opts.size !== undefined) release.size = Number(opts.size);

  let plugin = next.plugins.find((p) => p.id === opts.id);
  let what;
  if (!plugin) {
    plugin = { id: opts.id, name: opts.name, ...pluginFields(opts), category: opts.category, latest: opts.version, versions: [] };
    next.plugins.push(plugin);
    what = `added plugin ${opts.id}`;
  } else {
    plugin.name = opts.name;
    plugin.category = opts.category;
    Object.assign(plugin, pluginFields(opts));
    what = `updated plugin ${opts.id}`;
  }

  const at = plugin.versions.findIndex((v) => v.version === release.version);
  if (at === -1) {
    plugin.versions.push(release);
    what += `, added ${release.version}`;
  } else {
    const before = plugin.versions[at].sha256.toLowerCase();
    if (before !== release.sha256 && !opts.force) {
      throw new RefusedError(
        `${opts.id} ${release.version} is already in the registry with sha256 ${before}. ` +
          'A different checksum would disagree with installs of that version. Bump the version, ' +
          'or pass --force if the change is intended.',
      );
    }
    plugin.versions[at] = release;
    what += `, replaced ${release.version}`;
  }

  plugin.versions.sort((a, b) => compareSemver(parseSemver(a.version), parseSemver(b.version)));
  plugin.latest = pickLatest(plugin.versions.map((v) => v.version));
  return { next, what, latest: plugin.latest };
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`error: ${err.message}\n${USAGE}`);
    return 2;
  }

  const file = path.resolve(opts.registry ?? DEFAULT_REGISTRY);
  const label = path.relative(process.cwd(), file) || file;

  let original;
  try {
    original = fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`error: cannot read ${label}: ${err.message}`);
    return 1;
  }
  let registry;
  try {
    registry = JSON.parse(original);
  } catch (err) {
    console.error(`error: ${label} is not valid JSON: ${err.message}`);
    return 1;
  }
  const before = checkRegistry(registry);
  if (before.errors.length) {
    printProblems(label, before);
    console.error(`error: ${label} is invalid before the change. Fix it first (node scripts/validate.mjs).`);
    return 1;
  }

  let result;
  try {
    result = upsert(registry, opts);
  } catch (err) {
    if (!(err instanceof RefusedError)) throw err;
    console.error(`error: ${err.message}`);
    return 1;
  }

  const candidate = result.next;
  const problems = checkRegistry(candidate);
  if (problems.errors.length) {
    printProblems(label, problems);
    console.error('error: the change is invalid, so nothing was written');
    return 1;
  }
  const text = `${JSON.stringify(candidate, null, 2)}\n`;

  if (opts['dry-run']) {
    process.stdout.write(text);
    printProblems(label, problems);
    console.log(`dry run: ${result.what} (latest ${result.latest}). Nothing written.`);
    return 0;
  }

  fs.writeFileSync(file, text);
  const check = validateRegistryFile(file);
  if (check.errors.length) {
    fs.writeFileSync(file, original);
    printProblems(label, check);
    console.error(`error: the written file failed validation, so the original ${label} was restored`);
    return 1;
  }
  printProblems(label, check);
  console.log(`${result.what} (latest ${result.latest}) in ${label}`);
  console.log(`ok ${label}: ${summarize(check.data)}, ${check.warnings.length} warning(s)`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
