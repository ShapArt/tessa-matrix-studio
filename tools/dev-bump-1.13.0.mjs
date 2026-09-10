import fs from 'node:fs';

const version = '1.13.0';

const userPath = 'tessa-matrix-studio.user.js';
let user = fs.readFileSync(userPath, 'utf8');
user = user.replace(/^\/\/ @version\s+\S+/m, `// @version      ${version}`);
user = user.replace(/version:\s*'1\.12\.2'/, `version: '${version}'`);
if (!user.includes(`// @version      ${version}`) || !user.includes(`version: '${version}'`)) {
  throw new Error('userscript version bump failed');
}
fs.writeFileSync(userPath, user);

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.version = version;
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const lockPath = 'package-lock.json';
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
lock.version = version;
if (!lock.packages?.['']) throw new Error('package-lock root package missing');
lock.packages[''].version = version;
fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

const readmePath = 'README.md';
let readme = fs.readFileSync(readmePath, 'utf8');
readme = readme.replace(/version-1\.12\.2-/, `version-${version}-`);
readme = readme.replace(/\*\*v1\.12\.2 · Автор:/, `**v${version} · Автор:`);
if (!readme.includes(`version-${version}-`) || !readme.includes(`**v${version} · Автор:`)) {
  throw new Error('README version bump failed');
}
fs.writeFileSync(readmePath, readme);

console.log(`version bumped to ${version}`);
