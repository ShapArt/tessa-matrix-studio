from pathlib import Path
from textwrap import indent

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

if 'function evaluateRuntimeCapabilities(' in text:
    raise SystemExit('Task 1 helpers already exist; refusing duplicate bootstrap patch.')

marker = '  function captureExtensionRequire() {'
if text.count(marker) != 1:
    raise SystemExit(f'Expected one captureExtensionRequire marker, found {text.count(marker)}.')

helpers = r'''
/**
 * Pure compatibility model. It consumes only already-observed booleans and
 * never touches TESSA services. Scoped write gaps degrade Studio to `limited`;
 * missing authoritative read/identity primitives are fail-closed.
 */
function evaluateRuntimeCapabilities(probe = {}) {
  const p = probe || {};
  const blockers = [];
  const warnings = [];
  const addBlocker = (code, scope) => blockers.push({ code, scope });
  const addWarning = (code, scope) => warnings.push({ code, scope });

  if (!p.runtime?.extensionRequire) addBlocker('runtime-extension-require-missing', 'snapshot');
  if (!p.runtime?.apiLoader) addBlocker('runtime-api-loader-missing', 'workspace');
  if (!p.runtime?.workspace) addBlocker('workspace-missing', 'card');
  if (!p.runtime?.editor) addBlocker('editor-missing', 'card');
  if (!p.runtime?.cardModel) addBlocker('card-model-missing', 'card');
  if (!p.cardService?.get || !p.constructors?.cardGetRequest) addBlocker('card-get-unavailable', 'read');
  if (!p.cardService?.request || !p.constructors?.cardRequest) addBlocker('card-request-unavailable', 'read');
  if (!p.matrix?.identity || !p.matrix?.template || !p.matrix?.stateReadable) addBlocker('matrix-identity-unavailable', 'matrix');
  if (!p.nativeView?.found) addBlocker('native-view-missing', 'snapshot');

  if (!p.matrix?.writableState) addWarning('matrix-not-writable', 'apply');
  if (!p.cardService?.store || !p.constructors?.cardStoreRequest || !p.constructors?.affectVersion) addWarning('update-store-unavailable', 'apply');
  if (!p.cardService?.newOrCreate || !p.constructors?.cardNewRequest) addWarning('add-store-unavailable', 'apply');
  if (p.nativeView?.found && !p.nativeView?.refresh) addWarning('native-view-refresh-unavailable', 'refreshView');
  if (p.nativeView?.found && !p.nativeView?.paging) addWarning('native-view-paging-limited', 'snapshot');

  return {
    ...p,
    blockers,
    warnings,
    overall: blockers.length ? 'incompatible' : warnings.length ? 'limited' : 'ready',
  };
}

function capabilityOperationAvailability(capabilities, actions = []) {
  const c = capabilities || {};
  const types = new Set((actions || []).map(action => action?.type).filter(Boolean));
  const readBlockers = [];
  if (!c.runtime?.extensionRequire || !c.runtime?.apiLoader || !c.runtime?.workspace || !c.runtime?.editor || !c.runtime?.cardModel) readBlockers.push('runtime-read-unavailable');
  if (!c.cardService?.get || !c.constructors?.cardGetRequest) readBlockers.push('card-get-unavailable');
  if (!c.cardService?.request || !c.constructors?.cardRequest) readBlockers.push('card-request-unavailable');
  if (!c.matrix?.identity || !c.matrix?.template || !c.matrix?.stateReadable) readBlockers.push('matrix-identity-unavailable');
  if (!c.nativeView?.found) readBlockers.push('native-view-missing');
  const readReady = readBlockers.length === 0;

  const applyBlockers = [...readBlockers];
  if (!c.matrix?.writableState) applyBlockers.push('matrix-not-writable');
  if (types.has('update') && (!c.cardService?.store || !c.constructors?.cardStoreRequest || !c.constructors?.affectVersion)) applyBlockers.push('update-store-unavailable');
  if (types.has('add') && (!c.cardService?.newOrCreate || !c.constructors?.cardNewRequest || !c.cardService?.store || !c.constructors?.cardStoreRequest || !c.constructors?.affectVersion)) applyBlockers.push('add-store-unavailable');
  if (types.has('delete') && (!c.cardService?.request || !c.constructors?.cardRequest)) applyBlockers.push('delete-request-unavailable');

  const unique = values => [...new Set(values.filter(Boolean))];
  return {
    export: { enabled: readReady, blockers: unique(readBlockers) },
    analyze: { enabled: readReady, blockers: unique(readBlockers) },
    apply: { enabled: applyBlockers.length === 0, blockers: unique(applyBlockers) },
    refreshView: {
      enabled: Boolean(c.nativeView?.found && c.nativeView?.refresh),
      blockers: c.nativeView?.found && c.nativeView?.refresh ? [] : ['native-view-refresh-unavailable'],
    },
    reconcile: { enabled: readReady, blockers: unique(readBlockers) },
  };
}

function humanCapabilityBlocker(blockers) {
  const codes = (Array.isArray(blockers) ? blockers : [blockers])
    .map(item => typeof item === 'string' ? item : item?.code)
    .filter(Boolean);
  const labels = {
    'runtime-extension-require-missing': 'Не удалось подключиться к внутреннему runtime открытой страницы TESSA.',
    'runtime-api-loader-missing': 'На странице недоступен API текущей web-сборки TESSA.',
    'runtime-read-unavailable': 'Среда TESSA не предоставляет обязательные возможности чтения карточки.',
    'workspace-missing': 'Не найдена активная рабочая область карточки TESSA.',
    'editor-missing': 'Не найден редактор открытой карточки TESSA.',
    'card-model-missing': 'Не найдена модель открытой карточки TESSA.',
    'card-get-unavailable': 'Недоступно безопасное чтение карточек строк матрицы.',
    'card-request-unavailable': 'Недоступен обязательный запрос структуры матрицы TESSA.',
    'matrix-identity-unavailable': 'Не удалось надёжно определить открытую матрицу, её шаблон или состояние.',
    'native-view-missing': 'Не найдено нативное представление матрицы со служебными идентификаторами строк.',
    'native-view-refresh-unavailable': 'Автоматическое локальное обновление отображения недоступно; запись при этом может оставаться доступной.',
    'native-view-paging-limited': 'Нативное представление не публикует безопасный постраничный переход; большие матрицы могут потребовать обновления страницы.',
    'matrix-not-writable': 'Открытая матрица сейчас недоступна для безопасной записи.',
    'update-store-unavailable': 'В этой сборке недоступна безопасная запись изменений существующих строк.',
    'add-store-unavailable': 'В этой сборке недоступно безопасное создание новых строк; изменение существующих строк может оставаться доступным.',
    'delete-request-unavailable': 'В этой сборке недоступно безопасное удаление строк матрицы.',
  };
  const messages = [...new Set(codes.map(code => labels[code] || 'Часть возможностей Studio недоступна в текущей сборке TESSA.'))];
  return messages.join(' ');
}
'''

text = text.replace(marker, indent(helpers.strip('\n'), '  ') + '\n\n' + marker, 1)

export_marker = 'window.__TESSA_MATRIX_SYNC_EXPORTS__ = {'
if text.count(export_marker) != 1:
    raise SystemExit(f'Expected one test export marker, found {text.count(export_marker)}.')
text = text.replace(
    export_marker,
    export_marker + '\n    evaluateRuntimeCapabilities, capabilityOperationAvailability, humanCapabilityBlocker,',
    1,
)

path.write_text(text, encoding='utf-8')
