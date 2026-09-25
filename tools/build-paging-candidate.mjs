import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCandidate } from './build-candidate.mjs';

// Compatibility entry point for paging-focused tests and old automation. The paging
// runtime is canonical in src/core.user.js, so it must use the same deterministic UAT
// profile as every other exact candidate instead of replaying historical transforms.
export function buildPagingCandidate(target) {
  return buildCandidate({ profile: 'uat', out: target }).target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.resolve(process.argv[2] || 'dist/tessa-matrix-studio.uat.user.js');
  buildPagingCandidate(target);
  console.log(`Built ${target}`);
}
