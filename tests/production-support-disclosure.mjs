import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildCandidate } from '../tools/build-candidate.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-production-ui-'));
const target = path.join(temp, 'production.user.js');
buildCandidate({ profile: 'production', out: target });
let source = fs.readFileSync(target, 'utf8');
source = source.replace(
  '  window.__TMS_RUNTIME_BRIDGE__ = { TessaBridge };\n\n  bootstrap();',
  '  window.__productionUi = { mountUi };\n  window.__TMS_RUNTIME_BRIDGE__ = { TessaBridge };\n\n  bootstrap();',
);
assert.match(source, /window\.__productionUi/, 'production UI instrumentation failed');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://tessa.example.test/**', route => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>',
  }));
  await page.goto('https://tessa.example.test/matrix');
  await page.evaluate(() => { window.__TESSA_MATRIX_SYNC_TEST_MODE__ = true; });
  await page.addScriptTag({ content: source });
  await page.evaluate(() => window.__productionUi.mountUi());
  await page.locator('#tms-launch').click();

  const disclosure = page.locator('details#tms-test-tools');
  assert.equal(await disclosure.count(), 1, 'production support disclosure missing');
  assert.equal(await disclosure.getAttribute('open'), null, 'production support disclosure must start closed');
  assert.equal(await page.locator('#tms-run-tests').isVisible(), false, 'support actions must start hidden');
  assert.equal(await page.locator('#tms-uat-actions').count(), 0, 'production must not reserve a Full UAT host');
  assert.equal(await page.getByText('Full UAT', { exact: false }).count(), 0, 'production UI must not mention Full UAT');

  await disclosure.locator('summary').click();
  assert.equal(await page.locator('#tms-run-tests').isVisible(), true, 'support actions must be available after opening');
  console.log('Production support disclosure: closed by default, usable on demand, no Full UAT surface: OK');
} finally {
  await browser.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
