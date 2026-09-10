import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let code = fs.readFileSync(path, 'utf8');

const marker = `  function evaluatePlanSafety(plan, bridge) {`;
if (!code.includes(marker)) throw new Error('evaluatePlanSafety marker not found');
if (!code.includes('function classifyWorkbookContext(')) {
  code = code.replace(marker, `  function classifyWorkbookContext(workbook, matrixInfo) {
    const workbookMatrixId = canonicalValue(workbook?.roundtrip?.matrixId || '');
    const currentMatrixId = canonicalValue(matrixInfo?.matrixId || '');
    const workbookTemplateId = canonicalValue(workbook?.roundtrip?.templateId || '');
    const currentTemplateId = canonicalValue(matrixInfo?.TemplateID || matrixInfo?.templateId || '');
    const previousMatrixId = canonicalValue(matrixInfo?.PreviousVersionID || matrixInfo?.previousVersionId || '');
    const details = { workbookMatrixId, currentMatrixId, workbookTemplateId, currentTemplateId, previousMatrixId };
    if (!workbook?.roundtrip?.enabled) return { kind: 'invalid-roundtrip', ...details };
    if (!workbookTemplateId || !currentTemplateId || workbookTemplateId !== currentTemplateId) {
      return { kind: 'foreign-template', ...details };
    }
    if (workbookMatrixId && workbookMatrixId === currentMatrixId) return { kind: 'same-matrix', ...details };
    if (workbookMatrixId && workbookMatrixId === previousMatrixId) return { kind: 'previous-version', ...details };
    return { kind: 'same-template-foreign-matrix', ...details };
  }

${marker}`);
}

const oldBlock = `      const workbookTemplateId = canonicalValue(plan.workbook.roundtrip?.templateId);
      const currentTemplateId = canonicalValue(matrixInfo.TemplateID);
      if (!workbookTemplateId || workbookTemplateId !== currentTemplateId) {
        blockedReasons.push('Файл выгружен из другого шаблона матрицы TESSA.');
        suppressUnsafePreview = true;
      }

      const workbookMatrixId = canonicalValue(plan.workbook.roundtrip?.matrixId);
      const currentMatrixId = canonicalValue(matrixInfo.matrixId);
      const currentPreviousId = canonicalValue(matrixInfo.PreviousVersionID);
      const sameMatrix = Boolean(workbookMatrixId && workbookMatrixId === currentMatrixId);
      const exportedFromPreviousVersion = Boolean(workbookMatrixId && workbookMatrixId === currentPreviousId);
      if (!sameMatrix && !exportedFromPreviousVersion) {
        blockedReasons.push('Excel относится к другой карточке матрицы. Скачайте свежий Excel из открытой матрицы.');
        suppressUnsafePreview = true;
      }
`;
const newBlock = `      const workbookContext = classifyWorkbookContext(plan.workbook, matrixInfo);
      if (workbookContext.kind === 'foreign-template') {
        blockedReasons.push('Файл выгружен из другого шаблона матрицы TESSA.');
        suppressUnsafePreview = true;
      } else if (workbookContext.kind === 'invalid-roundtrip') {
        blockedReasons.push('Не удалось определить контекст выгрузки Excel. Скачайте новый файл из TESSA.');
        suppressUnsafePreview = true;
      }
`;
if (!code.includes(oldBlock)) throw new Error('old workbook context safety block not found');
code = code.replace(oldBlock, newBlock);

const returnNeedle = `      roundtripMatrixId: plan.workbook.roundtrip?.matrixId || null,
      roundtripTemplateId: plan.workbook.roundtrip?.templateId || null,
`;
const returnReplacement = `      roundtripMatrixId: plan.workbook.roundtrip?.matrixId || null,
      roundtripTemplateId: plan.workbook.roundtrip?.templateId || null,
      workbookContext: plan.mode === 'roundtrip' ? classifyWorkbookContext(plan.workbook, matrixInfo) : null,
      crossMatrixReplacement: plan.mode === 'roundtrip' && classifyWorkbookContext(plan.workbook, matrixInfo).kind === 'same-template-foreign-matrix',
`;
if (!code.includes(returnNeedle)) throw new Error('evaluatePlanSafety return marker not found');
code = code.replace(returnNeedle, returnReplacement);

const exportNeedle = `    safePlain, suppressPlanForUnsafeContext, evaluatePlanSafety, resultingRoleCountForAction, matrixNameSimilarity,`;
const exportReplacement = `    safePlain, classifyWorkbookContext, suppressPlanForUnsafeContext, evaluatePlanSafety, resultingRoleCountForAction, matrixNameSimilarity,`;
if (!code.includes(exportNeedle)) throw new Error('exports marker not found');
code = code.replace(exportNeedle, exportReplacement);
fs.writeFileSync(path, code);

const acceptancePath = 'tests/acceptance.mjs';
let acceptance = fs.readFileSync(acceptancePath, 'utf8');
const oldAcceptance = `// 8. Safety — активная матрица и Excel от другой карточки блокируются целиком.
plan = E.buildPlan(patch, structure, snapshot);
let safety = E.evaluatePlanSafety(plan, makeBridge(snapshot, { matrixInfo: { StateName: 'Активная' } }));
assert(safety.blocked && safety.suppressUnsafePreview, 'active matrix must be blocked');
const foreignWorkbook = { ...baseline, roundtrip: { ...baseline.roundtrip, matrixId: 'foreign-matrix' } };
plan = E.buildPlan(foreignWorkbook, structure, snapshot);
safety = E.evaluatePlanSafety(plan, makeBridge(snapshot));
assert(safety.blocked && safety.blockedReasons.some(reason => /другой карточк/i.test(reason)),
  'foreign matrix workbook must be blocked');
`;
const newAcceptance = `// 8. Safety — активная матрица блокируется, а другая карточка того же шаблона
// классифицируется как явный кандидат на перенос. Сам replacement-plan проверяется отдельно.
plan = E.buildPlan(patch, structure, snapshot);
let safety = E.evaluatePlanSafety(plan, makeBridge(snapshot, { matrixInfo: { StateName: 'Активная' } }));
assert(safety.blocked && safety.suppressUnsafePreview, 'active matrix must be blocked');
const foreignWorkbook = { ...baseline, roundtrip: { ...baseline.roundtrip, matrixId: 'foreign-matrix' } };
plan = E.buildPlan(foreignWorkbook, structure, snapshot);
safety = E.evaluatePlanSafety(plan, makeBridge(snapshot));
assert(!safety.blocked && safety.crossMatrixReplacement === true,
  'same-template foreign matrix workbook must become an explicit transfer candidate');
`;
if (!acceptance.includes(oldAcceptance)) throw new Error('legacy acceptance context block not found');
acceptance = acceptance.replace(oldAcceptance, newAcceptance);
fs.writeFileSync(acceptancePath, acceptance);

console.log('Task 1 production + acceptance patch applied');
