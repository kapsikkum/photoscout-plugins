#!/usr/bin/env node
/**
 * Check registry.json against registry.schema.json and the cross-field rules.
 *
 *   node scripts/validate.mjs [path/to/registry.json]
 *
 * Defaults to registry.json at the repository root. Writes nothing.
 * Exit status: 0 valid (warnings may print), 1 invalid, 2 bad usage.
 */
import path from 'node:path';
import { DEFAULT_REGISTRY, printProblems, summarize, validateRegistryFile } from './registry-lib.mjs';

const USAGE = 'usage: node scripts/validate.mjs [path/to/registry.json]';

function main(argv) {
  if (argv.length > 1 || argv.some((a) => a.startsWith('-'))) {
    console.error(USAGE);
    return 2;
  }
  const file = path.resolve(argv[0] ?? DEFAULT_REGISTRY);
  const label = path.relative(process.cwd(), file) || file;
  const problems = validateRegistryFile(file);
  printProblems(label, problems);
  if (problems.errors.length) {
    console.log(`invalid: ${problems.errors.length} error(s), ${problems.warnings.length} warning(s)`);
    return 1;
  }
  console.log(`ok ${label}: ${summarize(problems.data)}, ${problems.warnings.length} warning(s)`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
