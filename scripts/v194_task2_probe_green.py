from pathlib import Path
from textwrap import indent

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

if 'function probeRuntimeEnvironment(' in text:
    raise SystemExit('Task 2 probe helpers already exist; refusing duplicate patch.')

marker = '  function captureExtensionRequire() {'
if text.count(marker) != 1:
    raise SystemExit(f'Expected one captureExtensionRequire marker, found {text.count(marker)}.')

helpers = r'''
function probeDataValue(data, key, typedField = null) {
  if (!data) return null;
  try {
    if (typeof data.get === 'function') {
      const value = data.get(key);
      if (value !== undefined && value !== null) return value;
    }
  } catch (_) { /* read-only probe fallback */ }
  try {
    if (typeof data.tryGet === 'function') {
      const value = data.tryGet(key);
      return typedField?.get ? typedField.get(value) : value;
    }
  } catch (_) { /* read-only probe fallback */ }
  return data[key] ?? null;
}

function probeControlEntries(editor) {
  const controls = editor?.cardModel?.controls;
  if (!controls) return [];
  try {
    if (typeof controls.entries === 'function') return Array.from(controls.entries());
  } catch (_) { /* continue */ }
  if (Array.isArray(controls)) return controls.map((value, index) => [String(index), value]);
  try { return Object.entries(controls); } catch (_) { return []; }
}

function probeControlRows(control) {
  for (const candidate of [control, control?.control, control?.model, control?.viewModel]) {
    try {
      if (candidate?.table?.rows) return Array.from(candidate.table.rows);
    } catch (_) { /* continue */ }
  }
  return [];
}

function inspectNativeViewCapabilitiesReadOnly(editor, typedField = null) {
  for (const [, original] of probeControlEntries(editor)) {
    const rows = probeControlRows(original);
    const hasMatrixIdentity = rows.some(row => {
      const data = row?.data || row?.selectedObject || null;
      return Boolean(
        probeDataValue(data, 'MatrixRowID', typedField)
        && probeDataValue(data, 'MatrixVersionID', typedField)
      );
    });
    if (!hasMatrixIdentity) continue;
    const candidates = [original, original?.control, original?.model, original?.viewModel].filter(Boolean);
    const target = candidates.find(item =>
      typeof item?.setPageAndRefresh === 'function'
      || typeof item?.refresh === 'function'
      || item?.viewComponent
      || item?.component
    ) || candidates[0] || null;
    const component = target?.viewComponent || target?.component || target;
    return {
      found: true,
      paging: Boolean(
        typeof target?.setPageAndRefresh === 'function'
        || Number.isFinite(Number(component?.currentPage ?? component?._currentPage))
      ),
      refresh: Boolean(
        typeof target?.refresh === 'function'
        || typeof component?.refresh === 'function'
        || typeof target?.setPageAndRefresh === 'function'
      ),
    };
  }
  return { found: false, paging: false, refresh: false };
}

function probeFieldValue(section, name, typedField = null) {
  const fields = section?.fields;
  if (!fields) return null;
  for (const method of ['tryGetString', 'tryGetGuid', 'tryGetNumber', 'tryGetBoolean', 'tryGetDateTime']) {
    try {
      const value = fields[method]?.(name);
      if (value !== undefined && value !== null) return value;
    } catch (_) { /* continue */ }
  }
  try {
    const value = fields.tryGet?.(name);
    return typedField?.get ? typedField.get(value) : value;
  } catch (_) { return null; }
}

function inspectMatrixCapabilitiesReadOnly(mainCard, typedField = null) {
  let section = null;
  try { section = mainCard?.sections?.tryGet?.(S.Matrix) || null; } catch (_) { section = null; }
  const template = probeFieldValue(section, F.TemplateID, typedField);
  const stateName = probeFieldValue(section, 'StateName', typedField);
  let stateCaption = normalizeSpace(stateName);
  try { stateCaption = matrixStateCaption(stateName); } catch (_) { /* raw caption fallback */ }
  const canonicalState = canonicalValue(stateCaption);
  return {
    identity: Boolean(mainCard?.id),
    template: Boolean(template),
    stateReadable: Boolean(stateName),
    writableState: canonicalState === canonicalValue('Черновик') || canonicalState === canonicalValue('Draft'),
    matrixId: mainCard?.id ? String(mainCard.id) : null,
  };
}

function probeAffectVersionSupport(CardStoreRequest) {
  if (typeof CardStoreRequest !== 'function') return false;
  try {
    const proto = CardStoreRequest.prototype;
    if (proto && ('affectVersion' in proto || Object.getOwnPropertyDescriptor(proto, 'affectVersion'))) return true;
  } catch (_) { /* local constructor fallback */ }
  try {
    const request = new CardStoreRequest();
    if (!request || typeof request !== 'object') return false;
    if ('affectVersion' in request) return true;
    request.affectVersion = true;
    return request.affectVersion === true;
  } catch (_) { return false; }
}

function probeRuntimeEnvironment(options = {}) {
  const root = options.root || window;
  const extensionRequireFactory = options.extensionRequireFactory || captureExtensionRequire;
  let extRequire = null;
  let cards = null;
  let core = null;
  let cardService = null;
  try {
    extRequire = extensionRequireFactory();
    cards = extRequire?.(9855) || null;
    core = extRequire?.(9814) || null;
    cardService = extRequire?.(9893)?.CardService?.instance || null;
  } catch (_) {
    extRequire = null;
    cards = null;
    core = null;
    cardService = null;
  }

  const apiLoader = typeof root?.tessa?.apiLoader === 'function' ? root.tessa.apiLoader : null;
  let workspace = null;
  try { workspace = apiLoader?.(546914)?.WorkspaceStorage?.instance?.currentCardWorkspace || null; } catch (_) { workspace = null; }
  const editor = workspace?.editor || null;
  const cardModel = editor?.cardModel || null;
  const mainCard = cardModel?.card || null;

  return {
    runtime: {
      extensionRequire: Boolean(extRequire),
      apiLoader: Boolean(apiLoader),
      workspace: Boolean(workspace),
      editor: Boolean(editor),
      cardModel: Boolean(cardModel),
    },
    cardService: {
      get: typeof cardService?.get === 'function',
      request: typeof cardService?.request === 'function',
      store: typeof cardService?.store === 'function',
      newOrCreate: typeof cardService?.new === 'function' || typeof cardService?.create === 'function',
    },
    constructors: {
      cardGetRequest: typeof cards?.CardGetRequest === 'function',
      cardRequest: typeof cards?.CardRequest === 'function',
      cardStoreRequest: typeof cards?.CardStoreRequest === 'function',
      cardNewRequest: typeof cards?.CardNewRequest === 'function',
      affectVersion: probeAffectVersionSupport(cards?.CardStoreRequest),
    },
    matrix: inspectMatrixCapabilitiesReadOnly(mainCard, core?.TypedField || null),
    nativeView: inspectNativeViewCapabilitiesReadOnly(editor, core?.TypedField || null),
  };
}
'''

text = text.replace(marker, indent(helpers.strip('\n'), '  ') + '\n\n' + marker, 1)

export_marker = 'window.__TESSA_MATRIX_SYNC_EXPORTS__ = {'
if text.count(export_marker) != 1:
    raise SystemExit(f'Expected one test export marker, found {text.count(export_marker)}.')
text = text.replace(
    export_marker,
    export_marker + '\n    probeRuntimeEnvironment, inspectNativeViewCapabilitiesReadOnly, inspectMatrixCapabilitiesReadOnly,',
    1,
)
path.write_text(text, encoding='utf-8')
