import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
const source = fs.readFileSync(sourcePath, 'utf8');

// Regression from live Full UAT seed 696022484:
// TessaViewResult.Columns is a ValueTuple-like [Name, SchemeType] in this runtime.
assert.match(source, /SERVER_PAGED_NATIVE_VIEW_V5/,
  'candidate must contain the V5 server paging adapter');
assert.match(source, /Array\.isArray\(column\)\s*\?\s*column\[0\]/,
  'server paging must read the name from tuple-shaped TessaViewResult.Columns');
assert.match(source, /const hasExplicitPaging = parameters =>/,
  'direct request builders must prove PageLimit and PageOffset are present');
assert.match(source, /if \(!(?:hasExplicitPaging\(parameters\)|isPagingUsableForPage\(parameters, page, lastAcceptedOffset\))\) return null;/,
  'a createDataRequest result without usable paging parameters must not be accepted as server-paged');
assert.match(source, /if \(rawRows\.length < pageLimit\) break;/,
  'a full page equal to pageLimit must not terminate paging early');
assert.doesNotMatch(source, /if \(rawRows\.length <= pageLimit\) break;/,
  'the old off-by-one paging stop must be gone');

// The v1.15.10 transform emitted RegExp constructor strings with JS escapes already
// consumed (\b => backspace, \s => s), so a real row such as 81 was invisible.
assert.match(source, /const fullCell = new RegExp\(String\.raw`<c\\b/,
  'physical XLSX cell matcher must preserve regex escapes with String.raw');
assert.match(source, /const rowRe = new RegExp\(String\.raw`\(\\<row\\b|const rowRe = new RegExp\(String\.raw`\(\\?<?row\\b/,
  'physical XLSX row matcher must preserve regex escapes with String.raw');

const xml = '<row r="81" ht="40"><c r="A81" s="5"/></row>';
const rowNumber = 81;
const fixed = new RegExp(String.raw`(<row\b[^>]*\br="${rowNumber}"[^>]*>)([\s\S]*?)(<\/row>)`, 'i');
assert.equal(fixed.test(xml), true, 'row 81 fixture must be matched by the fixed regex');

assert.match(source, /version !== '1\.16\.(?:4|6|7|8|9)'/,
  'candidate provenance must validate the composed live candidate');
assert.match(source, /TMS_V1_16_4_PAGING_V5_XLSX_EDIT_V3/,
  'candidate must expose the exact v1.16.4 paging/XLSX fix build');

console.log('v1.16.4 live paging + XLSX edit regressions: PASS');
