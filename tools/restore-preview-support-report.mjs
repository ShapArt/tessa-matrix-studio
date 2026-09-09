import fs from 'node:fs';

const file = new URL('../tessa-matrix-studio.user.js', import.meta.url);
let code = fs.readFileSync(file, 'utf8');

if (code.includes('function buildPreviewSupportReport(plan, review = null, options = {})')) {
  console.log('Preview support report already present');
  process.exit(0);
}

const marker = '  function jsonReplacer(key, value) {';
const index = code.indexOf(marker);
if (index < 0) throw new Error('jsonReplacer marker not found');

const fn = `  function buildPreviewSupportReport(plan, review = null, options = {}) {
    const reviewed = buildReviewedPlan(plan, review);
    const availability = applyAvailability(plan, review);
    const reasonCodes = [...new Set([
      ...(reviewed?.skippedRows || []).map(item => normalizeSpace(item?.code || '')).filter(Boolean),
      ...(reviewed?.skippedFields || []).map(item => normalizeSpace(item?.code || '')).filter(Boolean),
    ])].sort();
    const roleTypeIds = new Set();
    const collectRow = row => {
      for (const values of Object.values(row?.ids || {})) {
        for (const packed of values || []) {
          const typeId = previewPackedRoleTypeId(packed);
          if (typeId) roleTypeIds.add(typeId);
        }
      }
      for (const values of Object.values(row?.roles || {})) {
        for (const item of values || []) {
          const typeId = normalizeSpace(item?.roleTypeId ?? '');
          if (typeId) roleTypeIds.add(typeId);
        }
      }
    };
    for (const action of reviewed?.actions || []) {
      collectRow(action?.excelRow);
      collectRow(action?.currentRow);
    }
    return {
      format: 'TESSA_MATRIX_SUPPORT_REPORT_V1',
      studioVersion: APP.version,
      createdAt: nowIso(),
      ...(options.includeIds ? {
        matrixId: plan?.matrixId || null,
        templateId: plan?.templateId || null,
      } : {}),
      counts: {
        update: Number(reviewed?.counts?.update || 0),
        add: Number(reviewed?.counts?.add || 0),
        delete: Number(reviewed?.counts?.delete || 0),
        noop: Number(reviewed?.counts?.noop || 0),
        skip: Number(reviewed?.counts?.skip || 0),
        skippedFields: Number(reviewed?.skippedFields?.length || 0),
      },
      reasonCodes,
      roleTypeIds: [...roleTypeIds].sort(),
      sources: [...new Set((reviewed?.skippedRows || []).map(item => normalizeSpace(item?.source || '')).filter(Boolean))].sort(),
      apply: {
        canApply: Boolean(availability.canApply),
        count: Number(availability.count || 0),
        blocked: Boolean(availability.blocked),
        batchBlocked: Boolean(availability.batchBlocked),
      },
    };
  }

`;

code = code.slice(0, index) + fn + code.slice(index);
fs.writeFileSync(file, code);
console.log('Restored preview support report after v1.12.1 sanitizer patch');
