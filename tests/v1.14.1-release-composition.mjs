import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(pkg.version === '1.14.1', `package version must be 1.14.1, got ${pkg.version}`);
assert(workflow.includes('hotfixes/v1.14.1-changes-report-full-row.mjs'), 'release must track/package v1.14.1 changes-report transform');
assert(workflow.includes('node hotfixes/v1.14.1-changes-report-full-row.mjs dist/tessa-matrix-studio.user.js'), 'release build must apply v1.14.1 changes-report transform');
assert(workflow.includes('REVIEWED_CHANGES_REPORT_V2'), 'release verification must require the self-contained changes-report marker');
console.log('v1.14.1 release composition: version + transform + marker contract OK');
