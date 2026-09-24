import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.Element = class {};
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
const source = fs.readFileSync(process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source.replace('window.__TESSA_MATRIX_SYNC_EXPORTS__ = {',
  'window.__redactionTest = { diagnosticJsonReplacer, jsonReplacer }; window.__TESSA_MATRIX_SYNC_EXPORTS__ = {'));
const E = window.__TESSA_MATRIX_SYNC_EXPORTS__, D = window.__redactionTest;
const keys = ['KrToken', 'Signature', 'sessionToken', 'Access_Token', 'refresh-token', 'Authorization', 'Proxy-Authorization', 'Cookie', 'Set-Cookie', 'Password', 'privateKey', 'client_secret', 'ApiKey', 'SessionID'];
const privateInfo = Object.fromEntries(keys.map(key => [key, { '$__type': 'str', '$__value': `SECRET-${key}` }]));
const card = { ID: 'card-id', Version: 7, Info: privateInfo, Sections: { Values: { Fields: { Name: 'Ordinary business value' } } } };
const input = { request: { card }, response: { card }, map: new Map(Object.entries(privateInfo)), schemaTokens: ['criterion:id'], sourceFingerprint: 'baseline-hash' };
const original = JSON.stringify(card);
for (const sanitized of [JSON.stringify(input, D.diagnosticJsonReplacer), JSON.stringify(input, D.jsonReplacer), JSON.stringify(E.safePlain(input))]) {
  assert.doesNotMatch(sanitized, /SECRET-/, 'no secret material in any serialization path, including Maps');
  assert.match(sanitized, /criterion:id/);
  assert.match(sanitized, /baseline-hash/);
}
const raw = JSON.stringify(input, D.diagnosticJsonReplacer);
assert.match(raw, /card-id/);
assert.match(raw, /Ordinary business value/, 'raw evidence retains business payload shape');
assert.equal(JSON.stringify(card), original, 'redaction must not mutate native cards used by TESSA');
assert.equal(JSON.parse(JSON.stringify({ note: 'Signature is a field name', values: ['unchanged'] }, D.diagnosticJsonReplacer)).note, 'Signature is a field name');
console.log('Diagnostic secret redaction: native typed cards, nested Maps and immutable payloads OK');
