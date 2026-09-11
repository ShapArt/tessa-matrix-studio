import fs from 'node:fs';

const targetPath = process.argv[2] || 'tessa-matrix-studio.user.js';
const runnerPath = process.argv[3] || 'hotfixes/full-uat-runner-v1.js';

let source = fs.readFileSync(targetPath, 'utf8');
if (source.includes('__TMS_FULL_UAT_V1__') && source.includes('Запустить полный UAT')) {
  console.log(`Canonical Full UAT already present in ${targetPath}`);
  process.exit(0);
}

const versionMatch = source.match(/^\/\/ @version\s+([^\s]+)$/m);
if (!versionMatch) throw new Error(`Cannot determine userscript version from ${targetPath}`);
const studioVersion = versionMatch[1];

let runner = fs.readFileSync(runnerPath, 'utf8').trim();
if (!runner.includes('__TMS_FULL_UAT_V1__')) throw new Error(`${runnerPath} is not the Full UAT runner`);
if (!runner.includes('Запустить полный UAT')) throw new Error(`${runnerPath} does not expose the Full UAT UI`);

const versionLiteral = /studioVersion:\s*'[^']*'/;
if (!versionLiteral.test(runner)) throw new Error(`${runnerPath} has no studioVersion field to canonicalize`);
runner = runner.replace(versionLiteral, `studioVersion: '${studioVersion}'`);

source = `${source.trimEnd()}\n\n${runner}\n`;
fs.writeFileSync(targetPath, source, 'utf8');

const finalSource = fs.readFileSync(targetPath, 'utf8');
if (!finalSource.includes('__TMS_FULL_UAT_V1__') || !finalSource.includes('Запустить полный UAT')) {
  throw new Error('Canonical Full UAT embedding verification failed');
}
console.log(`Embedded Full UAT into ${targetPath} for Studio ${studioVersion}`);
