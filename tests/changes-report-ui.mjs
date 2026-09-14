import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');

assert.match(source, /id=["']tms-download-changes["']/, 'Preview must expose #tms-download-changes');
assert.match(source, /function\s+downloadReviewedChangesXlsx\s*\(/, 'changes report download handler missing');
assert.match(source, /function\s+prepareReviewedChangesArtifact\s*\(/, 'Preview must prepare the changes artifact before the user click');
assert.match(source, /function\s+updateReviewedChangesDownloadControl\s*\([\s\S]{0,700}button\.hidden\s*=\s*!hasChanges/, 'changes button visibility must follow Preview changes state');
assert.match(source, /updateReviewedChangesDownloadControl\(\{\s*hasChanges:\s*true,\s*ready\s*\}\)/, 'Preview must expose changes download control while the artifact is preparing or ready');
assert.match(source, /clearReviewedChangesArtifact\(APP\)[\s\S]{0,250}updateReviewedChangesDownloadControl\(\)/, 'Preview invalidation must hide the changes button and clear its artifact');
assert.match(source, /tms-download-changes[^\n]{0,180}addEventListener\(['"]click['"]/, 'changes button must be wired to click');
assert.match(source, /createChangesReportXlsxBytes\(/, 'UI must call changes report XLSX builder');
assert.doesNotMatch(source, /async\s+function\s+downloadReviewedChangesXlsx\s*\(/, 'download click handler must stay synchronous after artifact preparation');

console.log('TESSA Matrix Studio changes report UI lifecycle: OK');
