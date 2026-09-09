import fs from 'node:fs';

const file = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
const needle = 'node tests/native-evidence-validator.mjs';
const gate = 'node tests/release-native-evidence-gate.mjs';
if (!String(pkg.scripts?.test || '').includes(needle)) throw new Error('native evidence test marker not found in npm test');
if (!String(pkg.scripts.test).includes(gate)) {
  pkg.scripts.test = pkg.scripts.test.replace(`${needle} &&`, `${needle} && ${gate} &&`);
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log('Added release native-evidence gate to npm test');
} else {
  console.log('Release native-evidence gate already present in npm test');
}
