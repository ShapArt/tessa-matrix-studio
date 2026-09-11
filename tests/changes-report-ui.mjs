import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');

assert.match(source, /id=["']tms-download-changes["']/, 'Preview must expose #tms-download-changes');
assert.match(source, /function\s+downloadReviewedChangesXlsx\s*\(/, 'changes report download handler missing');
assert.match(source, /#tms-download-changes[\s\S]{0,500}hidden\s*=\s*false|changesButton[\s\S]{0,300}hidden\s*=\s*false/, 'Preview must reveal changes button');
assert.match(source, /#tms-download-changes[\s\S]{0,700}hidden\s*=\s*true|changesButton[\s\S]{0,500}hidden\s*=\s*true/, 'Preview invalidation must hide changes button');
assert.match(source, /tms-download-changes[^\n]{0,180}addEventListener\(['"]click['"]/, 'changes button must be wired to click');
assert.match(source, /createChangesReportXlsxBytes\(/, 'UI must call changes report XLSX builder');

console.log('TESSA Matrix Studio changes report UI lifecycle: OK');
