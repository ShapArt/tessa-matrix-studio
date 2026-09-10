import fs from 'node:fs';
const path = 'package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
const marker = 'node tests/cross-matrix-success-verification.mjs';
const test = 'node tests/main-card-unsaved-guard.mjs';
if (!pkg.scripts.test.includes(test)) {
  if (!pkg.scripts.test.includes(marker)) throw new Error('cross-matrix success test marker not found');
  pkg.scripts.test = pkg.scripts.test.replace(marker, `${marker} && ${test}`);
}
fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
console.log('Main-card unsaved guard added to npm test');
