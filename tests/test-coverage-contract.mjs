import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const exists = path => fs.existsSync(new URL(path, root));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const manifest = JSON.parse(read('tests/coverage-manifest.json'));
const pkg = JSON.parse(read('package.json'));
const script = read('tessa-matrix-studio.user.js');
const strategy = read('docs/TEST-STRATEGY.md');

assert(manifest.schemaVersion === 1, 'coverage manifest schema version must be 1');
assert(Array.isArray(manifest.features) && manifest.features.length >= 10, 'coverage manifest is unexpectedly small');

const ids = new Set();
for (const feature of manifest.features) {
  assert(feature.id && !ids.has(feature.id), `duplicate or empty feature id: ${feature.id}`);
  ids.add(feature.id);
  assert(Array.isArray(feature.unit) && feature.unit.length > 0, `${feature.id}: unit coverage is missing`);
  assert(Array.isArray(feature.contract) && feature.contract.length > 0, `${feature.id}: stateful contract coverage is missing`);
  for (const path of [...feature.unit, ...feature.contract]) {
    assert(exists(path), `${feature.id}: referenced test does not exist: ${path}`);
  }
  if (feature.writeCritical) {
    assert(typeof feature.runtimeEvidence === 'string' && feature.runtimeEvidence.trim(), `${feature.id}: runtime evidence capability is missing`);
    for (const path of feature.contract) {
      assert(pkg.scripts.test.includes(`node ${path}`), `${feature.id}: contract test is not in npm test: ${path}`);
    }
  }
}

for (const required of [
  'add', 'update', 'delete', 'main-matrix-save', 'post-apply-refresh',
  'reconciliation', 'interval-diagnostics', 'native-runtime-recorder',
]) {
  assert(ids.has(required), `write-critical feature missing from manifest: ${required}`);
}

assert(script.includes('function collectNativeRuntimeSurface'), 'native runtime surface collector is missing');
assert(script.includes('function sanitizeNativeOperationRecord'), 'native operation sanitization is missing');
assert(script.includes('startNativeOperationRecorder'), 'native operation recorder start path is missing');
assert(script.includes('stopNativeOperationRecorder'), 'native operation recorder stop path is missing');
assert(script.includes('beforeMembership') && script.includes('afterMembership'), 'native recorder does not capture membership transition');
assert(script.includes('Сервер принял') && script.includes('повторно подтверждено'), 'Apply UI does not separate accepted from verified writes');
assert(!/Запись подтверждена для \$\{applied\} из \$\{requested\}/.test(script), 'legacy misleading verification copy is still present');

for (const phrase of [
  'Unit / pure logic',
  'Stateful contract',
  'Native runtime evidence',
  'External release gate',
  'self-hosted',
]) {
  assert(strategy.includes(phrase), `TEST-STRATEGY is missing required concept: ${phrase}`);
}

console.log(`Coverage contract: ${manifest.features.length} feature groups, write-critical release gates: OK`);
