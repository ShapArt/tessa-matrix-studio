import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const candidatePath = new URL('../tessa-matrix-studio.user.js', import.meta.url);
let candidate = fs.readFileSync(candidatePath, 'utf8');
candidate = candidate.replace(
  'window.__TESSA_MATRIX_SYNC_EXPORTS__ = {',
  'window.__browserExact={APP,mountUi,renderPlan}; window.__TESSA_MATRIX_SYNC_EXPORTS__ = {',
);
assert.match(candidate, /window\.__browserExact=/, 'exact candidate instrumentation failed');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const downloads = [];
page.on('download', download => downloads.push(download));

try {
  await page.route('https://tessa.example.test/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><head></head><body></body></html>',
  }));
  await page.goto('https://tessa.example.test/matrix');
  await page.evaluate(() => { window.__TESSA_MATRIX_SYNC_TEST_MODE__ = true; });
  await page.addScriptTag({ content: candidate });
  await page.evaluate(async () => {
    const U = window.__browserExact;
    const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
    window.alert = () => {};
    window.confirm = () => true;
    window.showSaveFilePicker = undefined;
    U.mountUi();
    U.APP.runtimeMonitor?.stop?.();

    const structure = {
      templateId: 'browser-template',
      conditions: [{ criterionRowId: 'org', criterionName: 'Организация', operandTypeId: E.constants.OPERAND.ReferenceGuid }],
      functions: [],
    };
    const makeRow = (index, suffix, display) => {
      const flat = { 'criterion:org': [display] };
      return {
        index, rowCardId: `card-${suffix}`, versionId: `version-${suffix}`,
        fingerprint: E.fingerprintFlat(flat), flat,
        values: { org: [{ id: `org-${suffix}`, display }] }, roles: {},
      };
    };
    const snapshot = {
      matrixId: 'browser-matrix', templateId: structure.templateId,
      rows: [makeRow(0, 'a', 'Организация А'), makeRow(1, 'b', 'Организация Б')],
    };
    const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
    const columnMap = { columns: new Map([['org', {
      id: 'org', key: 'criterion:org', kind: 'criterion', name: 'Организация', excelHeader: 'Организация',
    }]]) };
    const plan = {
      id: 'browser-plan', matrixId: snapshot.matrixId, templateId: structure.templateId,
      matrixName: 'Browser exact candidate', structure, snapshot, columnMap,
      actions: [
        {
          type: 'update', excelRow: { excelRow: 15, flat: { 'criterion:org': ['Организация В'] }, ids: { 'criterion:org': ['org-c'] } },
          currentRow: snapshot.rows[0],
          changes: [{ key: 'criterion:org', label: 'Организация', before: ['Организация А'], after: ['Организация В'] }],
        },
        {
          type: 'add', excelRow: { excelRow: 16, flat: { 'criterion:org': ['Организация Г'] }, ids: { 'criterion:org': ['org-d'] } },
          currentRow: null, changes: [{ key: 'criterion:org', label: 'Организация', before: [], after: ['Организация Г'] }],
        },
        {
          type: 'delete', excelRow: null, currentRow: snapshot.rows[1],
          changes: [{ key: 'criterion:org', label: 'Организация', before: ['Организация Б'], after: [] }],
        },
      ],
      skippedRows: [
        { excelRow: 21, source: 'input-validation', code: 'invalid-value', reason: 'Значение не найдено' },
        { excelRow: 22, source: 'manual-skip', reason: 'Пользователь пропустил строку' },
      ],
      skippedFields: [], skippedValues: [], warnings: [],
      safety: { blocked: false, blockedReasons: [], matrixInfo: { matrixId: snapshot.matrixId, templateId: structure.templateId } },
      matrixInfo: { matrixId: snapshot.matrixId, templateId: structure.templateId },
    };
    const matrixInfo = { matrixId: snapshot.matrixId, TemplateID: structure.templateId, Name: plan.matrixName };
    const uploaded = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
    U.APP.structure = structure;
    U.APP.snapshot = snapshot;
    U.APP.dictionaryCatalog = catalog;
    U.APP.bridge = { matrixInfo: () => matrixInfo };
    U.APP.review = E.createPlanReviewState();
    U.APP.selectedFileRef = new File([uploaded], 'matrix-uploaded.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', lastModified: 1,
    });
    U.APP.plan = plan;
    U.renderPlan(plan);
  });

  try {
    await page.waitForFunction(() => document.querySelector('#tms-download-package')?.dataset.state === 'ready', null, { timeout: 15000 });
  } catch (error) {
    const detail = await page.evaluate(() => ({
      button: document.querySelector('#tms-download-package')?.outerHTML,
      logs: window.__browserExact?.APP?.logs?.slice(-10),
      hasArtifact: Boolean(window.__browserExact?.APP?.supportBundleArtifact),
      build: window.__browserExact?.APP?.supportBundleBuild ? { key: window.__browserExact.APP.supportBundleBuild.key } : null,
    }));
    throw new Error(`support bundle preparation timed out: ${JSON.stringify(detail)}`, { cause: error });
  }
  await page.locator('#tms-launch').click();

  const expectedCounts = { update: 1, add: 1, delete: 1, skip: 2, error: 1 };
  for (const [filter, count] of Object.entries(expectedCounts)) {
    const button = page.locator(`button[data-preview-counter-filter="${filter}"]`);
    await button.click();
    await assert.doesNotReject(async () => assert.equal(await page.locator('#tms-plan > details.tms-action').count(), count));
    assert.equal(await page.locator(`button[data-preview-counter-filter="${filter}"]`).getAttribute('aria-pressed'), 'true');
    await page.locator(`button[data-preview-counter-filter="${filter}"]`).click();
    assert.equal(await page.locator(`button[data-preview-counter-filter="${filter}"]`).getAttribute('aria-pressed'), 'false');
  }
  const keyboardFilter = page.locator('button[data-preview-counter-filter="add"]');
  await keyboardFilter.focus();
  await keyboardFilter.press('Enter');
  assert.equal(await page.locator('button[data-preview-counter-filter="add"]').getAttribute('aria-pressed'), 'true');
  await page.locator('button[data-preview-counter-filter="add"]').press('Space');
  assert.equal(await page.locator('button[data-preview-counter-filter="add"]').getAttribute('aria-pressed'), 'false');

  if (process.env.TMS_SCREENSHOT_PATH) {
    const screenshotPath = path.resolve(process.env.TMS_SCREENSHOT_PATH);
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.locator('#tms-panel').screenshot({ path: screenshotPath });
  }

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#tms-download-package').click(),
  ]);
  assert.equal(downloads.length, 1, 'one UI click must emit one browser download');
  assert.match(download.suggestedFilename(), /^TESSA_Matrix_Package_.*\.zip$/);
  const outputPath = path.join(os.tmpdir(), `tessa-support-${process.pid}.zip`);
  await download.saveAs(outputPath);
  const saved = fs.readFileSync(outputPath);
  const savedSha = crypto.createHash('sha256').update(saved).digest('hex');
  const browserEvidence = await page.evaluate(async () => {
    const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
    const artifact = window.__browserExact.APP.supportBundleArtifact;
    const entries = await E.unzipArrayBuffer(artifact.bytes.buffer.slice(artifact.bytes.byteOffset, artifact.bytes.byteOffset + artifact.bytes.byteLength));
    const text = bytes => new TextDecoder().decode(bytes);
    const manifest = JSON.parse(text(entries.get('manifest.json')));
    const hashesValid = (await Promise.all(manifest.files.map(async file => ({
      path: file.path,
      valid: entries.has(file.path) && await E.sha256Hex(entries.get(file.path)) === file.sha256,
    })))).every(item => item.valid);
    const current = await E.readXlsxArrayBuffer(entries.get('excel/matrix-current.xlsx').buffer.slice(
      entries.get('excel/matrix-current.xlsx').byteOffset,
      entries.get('excel/matrix-current.xlsx').byteOffset + entries.get('excel/matrix-current.xlsx').byteLength,
    ), 'matrix-current.xlsx');
    const uploaded = await E.readXlsxArrayBuffer(entries.get('excel/matrix-uploaded.xlsx').buffer.slice(
      entries.get('excel/matrix-uploaded.xlsx').byteOffset,
      entries.get('excel/matrix-uploaded.xlsx').byteOffset + entries.get('excel/matrix-uploaded.xlsx').byteLength,
    ), 'matrix-uploaded.xlsx');
    const changes = await E.unzipArrayBuffer(entries.get('excel/changes.xlsx').buffer.slice(
      entries.get('excel/changes.xlsx').byteOffset,
      entries.get('excel/changes.xlsx').byteOffset + entries.get('excel/changes.xlsx').byteLength,
    ));
    return {
      sha256: await E.sha256Hex(artifact.bytes),
      mime: artifact.blob.type,
      bundleBytes: artifact.bytes.byteLength,
      entryNames: [...entries.keys()].sort(),
      manifestFormat: manifest.format,
      hashesValid,
      currentRows: current.rows.length,
      uploadedRows: uploaded.rows.length,
      changesWorkbook: changes.has('[Content_Types].xml') && changes.has('xl/worksheets/sheet1.xml'),
    };
  });
  assert.equal(browserEvidence.sha256, savedSha, 'downloaded browser file differs from the prepared artifact');
  assert.equal(browserEvidence.mime, 'application/zip');
  assert.equal(browserEvidence.manifestFormat, 'TESSA_MATRIX_SUPPORT_BUNDLE_V1');
  assert.equal(browserEvidence.hashesValid, true);
  assert.equal(browserEvidence.currentRows, 2);
  assert.equal(browserEvidence.uploadedRows, 2);
  assert.equal(browserEvidence.changesWorkbook, true);
  assert.ok(browserEvidence.entryNames.includes('excel/changes.xlsx'));
  assert.ok(browserEvidence.bundleBytes <= 12 * 1024 * 1024, `successful bundle is ${browserEvidence.bundleBytes} bytes`);
  fs.rmSync(outputPath, { force: true });

  await page.waitForTimeout(1300);
  await cdp.send('HeapProfiler.collectGarbage');
  const heapBefore = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  for (let index = 0; index < 10; index += 1) {
    if (!await page.locator('#tms-panel').evaluate(node => node.classList.contains('tms-open'))) await page.locator('#tms-launch').click();
    await page.evaluate(() => window.__browserExact.renderPlan(window.__browserExact.APP.plan));
    const cycleDownload = page.waitForEvent('download');
    await page.locator('#tms-download-package').click();
    await (await cycleDownload).cancel();
    await page.locator('#tms-panel .tms-close').click();
  }
  await page.waitForTimeout(1500);
  await cdp.send('HeapProfiler.collectGarbage');
  const heapAfter = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  assert.ok(heapAfter <= heapBefore * 1.2, `retained heap grew more than 20%: ${heapBefore} -> ${heapAfter}`);

  console.log(`Playwright exact candidate: filters, keyboard, one-click ZIP, SHA-256/XLSX contents and 10-cycle heap ${heapBefore}->${heapAfter} OK`);
} finally {
  await context.close();
  await browser.close();
}
