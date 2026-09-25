import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');

assert.match(source, /id=["']tms-download-package["']/, 'Preview must expose #tms-download-package');
assert.match(source, /async\s+function\s+prepareSupportBundle\s*\(/, 'Preview must prepare the support ZIP before the user click');
assert.match(source, /function\s+updateSupportBundleControl\s*\(/, 'support package control state is missing');
assert.match(source, /tms-download-package[^\n]{0,180}addEventListener\(['"]click['"]/, 'support package button must be wired to click');
assert.match(source, /createChangesReportXlsxBytes\(/, 'support ZIP must include the changes workbook');
assert.match(source, /showSaveFilePicker/, 'Edge streaming save path is missing');
assert.doesNotMatch(source, /id=["']tms-download-changes["']/, 'obsolete changes-only button must not remain visible');

console.log('TESSA Matrix Studio changes report UI lifecycle: OK');
