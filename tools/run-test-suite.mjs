import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const suite = JSON.parse(fs.readFileSync(new URL('../tests/suite.json', import.meta.url), 'utf8'));
if (suite.schemaVersion !== 1 || !Array.isArray(suite.tests) || suite.tests.length === 0) {
  throw new Error('tests/suite.json has an unsupported or empty test suite.');
}

for (const test of [...suite.tests, ...(suite.browserTests || [])]) {
  if (!/^tests\/[a-z0-9.-]+\.(?:mjs|cjs)$/i.test(test)) {
    throw new Error(`Unsafe test path in suite: ${test}`);
  }
  const result = spawnSync(process.execPath, [test], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
