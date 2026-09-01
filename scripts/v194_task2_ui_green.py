from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

if 'function capabilityStatusModel(' in text:
    raise SystemExit('Task 2 UI helpers already exist; refusing duplicate patch.')

# 1. Session state.
old = """    bridge: null,
    busy: false,"""
new = """    bridge: null,
    capabilities: null,
    capabilityAvailability: null,
    capabilityCheckedCardId: null,
    busy: false,"""
if text.count(old) != 1:
    raise SystemExit('APP state marker not found exactly once.')
text = text.replace(old, new, 1)

# 2. Capability UI/gating helpers immediately before mountUi().
marker = '  function mountUi() {'
if text.count(marker) != 1:
    raise SystemExit('mountUi marker not found exactly once.')
helpers = r'''  function capabilityStatusModel(capabilities, availability) {
    const overall = ['ready', 'limited', 'incompatible'].includes(capabilities?.overall)
      ? capabilities.overall
      : 'incompatible';
    const labels = {
      ready: 'Среда: готова',
      limited: 'Среда: ограничена',
      incompatible: 'Среда: несовместима',
    };
    const codes = [...new Set([
      ...(capabilities?.blockers || []).map(item => item?.code || item),
      ...(capabilities?.warnings || []).map(item => item?.code || item),
    ].filter(Boolean))];
    const detail = codes.length
      ? humanCapabilityBlocker(codes)
      : 'Обязательные возможности текущей сборки TESSA доступны.';
    return {
      label: labels[overall],
      tone: overall,
      detail,
      codes,
      exportEnabled: Boolean(availability?.export?.enabled),
      analyzeEnabled: Boolean(availability?.analyze?.enabled),
      applyEnabled: Boolean(availability?.apply?.enabled),
      refreshViewEnabled: Boolean(availability?.refreshView?.enabled),
      reconcileEnabled: Boolean(availability?.reconcile?.enabled),
    };
  }

  function renderCapabilityStatus(capabilities = APP.capabilities, availability = APP.capabilityAvailability) {
    const host = document.querySelector('#tms-capability-status');
    const details = document.querySelector('#tms-capability-details');
    if (!host || !details) return null;
    const model = capabilityStatusModel(capabilities, availability);
    host.textContent = model.label;
    host.dataset.tone = model.tone;
    details.textContent = model.detail;
    details.dataset.tone = model.tone;
    return model;
  }

  function refreshRuntimeCapabilities(actions = []) {
    let probe;
    try {
      probe = probeRuntimeEnvironment();
    } catch (_) {
      probe = {
        runtime: { extensionRequire: false, apiLoader: Boolean(window.tessa?.apiLoader), workspace: false, editor: false, cardModel: false },
        cardService: { get: false, request: false, store: false, newOrCreate: false },
        constructors: { cardGetRequest: false, cardRequest: false, cardStoreRequest: false, cardNewRequest: false, affectVersion: false },
        matrix: { identity: false, template: false, stateReadable: false, writableState: false, matrixId: null },
        nativeView: { found: false, paging: false, refresh: false },
      };
    }
    const capabilities = evaluateRuntimeCapabilities(probe);
    const availability = capabilityOperationAvailability(capabilities, actions);
    APP.capabilities = capabilities;
    APP.capabilityAvailability = availability;
    APP.capabilityCheckedCardId = probe?.matrix?.matrixId || null;
    renderCapabilityStatus(capabilities, availability);
    return { probe, capabilities, availability };
  }

  function requireRuntimeOperation(operation, actions = []) {
    const checked = refreshRuntimeCapabilities(actions);
    const state = checked.availability?.[operation];
    if (state?.enabled) return checked;
    const reason = humanCapabilityBlocker(state?.blockers || checked.capabilities?.blockers || []);
    throw new Error(reason || 'Текущая web-сборка TESSA не предоставляет обязательные возможности для этой операции.');
  }

'''
text = text.replace(marker, helpers + marker, 1)

# 3. Compact CSS in the existing sticky status.
old = ".tms-progress-detail{min-height:16px;font-size:11px;color:#777}.tms-step{"
new = ".tms-progress-detail{min-height:16px;font-size:11px;color:#777}.tms-capability-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:7px;padding-top:7px;border-top:1px solid #e7e7e7}.tms-capability-status{font-size:11px;font-weight:800;color:#2d6a3f}.tms-capability-status[data-tone=limited]{color:#86630b}.tms-capability-status[data-tone=incompatible]{color:var(--tms-red-dark)}.tms-capability-recheck{border:0!important;background:transparent!important;padding:2px 4px!important;font-size:10px!important;color:#666!important;text-decoration:underline}.tms-capability-details{font-size:10px;color:#777;margin-top:3px;line-height:1.35}.tms-step{"
if text.count(old) != 1:
    raise SystemExit('Capability CSS marker not found exactly once.')
text = text.replace(old, new, 1)

# 4. Markup lives inside the existing sticky status.
old = '<div id="tms-status" class="tms-status"><div class="tms-status-line"><span id="tms-progress-label">Готово</span><span id="tms-progress-percent" class="tms-progress-percent">0%</span></div><div class="tms-progress-track"><div id="tms-progress-fill" class="tms-progress-fill"></div></div><div id="tms-progress-detail" class="tms-progress-detail">Скачайте Excel, внесите изменения и загрузите файл обратно.</div></div>'
new = '<div id="tms-status" class="tms-status"><div class="tms-status-line"><span id="tms-progress-label">Готово</span><span id="tms-progress-percent" class="tms-progress-percent">0%</span></div><div class="tms-progress-track"><div id="tms-progress-fill" class="tms-progress-fill"></div></div><div id="tms-progress-detail" class="tms-progress-detail">Скачайте Excel, внесите изменения и загрузите файл обратно.</div><div class="tms-capability-row"><span id="tms-capability-status" class="tms-capability-status" data-tone="limited">Среда: проверяю…</span><button id="tms-capability-recheck" class="tms-capability-recheck" type="button">Повторить проверку</button></div><div id="tms-capability-details" class="tms-capability-details">Проверяю совместимость текущей сборки TESSA.</div></div>'
if text.count(old) != 1:
    raise SystemExit('Sticky status markup marker not found exactly once.')
text = text.replace(old, new, 1)

# 5. Manual recheck action.
old = "    panel.querySelector('#tms-stop').addEventListener('click', requestApplyAbort);"
new = """    panel.querySelector('#tms-stop').addEventListener('click', requestApplyAbort);
    panel.querySelector('#tms-capability-recheck').addEventListener('click', () => {
      if (APP.busy) return;
      const effectiveActions = APP.plan ? buildReviewedPlan(APP.plan, APP.review).actions : [];
      refreshRuntimeCapabilities(effectiveActions);
    });"""
if text.count(old) != 1:
    raise SystemExit('Recheck listener marker not found exactly once.')
text = text.replace(old, new, 1)

# 6. Gate read operations immediately before their existing functions.
old = "      try { await exportCurrentMatrixXlsx(); alert('Excel скачан. Можно редактировать лист «Матрица».'); }"
new = "      try { requireRuntimeOperation('export'); await exportCurrentMatrixXlsx(); alert('Excel скачан. Можно редактировать лист «Матрица».'); }"
if text.count(old) != 1:
    raise SystemExit('Current export marker not found exactly once.')
text = text.replace(old, new, 1)

old = "      try { await exportCurrentMatrixXlsx({ forceDictionaryRefresh: true }); alert('Новый Excel со свежими справочниками скачан.'); }"
new = "      try { requireRuntimeOperation('export'); await exportCurrentMatrixXlsx({ forceDictionaryRefresh: true }); alert('Новый Excel со свежими справочниками скачан.'); }"
if text.count(old) != 1:
    raise SystemExit('Fresh export marker not found exactly once.')
text = text.replace(old, new, 1)

old = "      try { await analyzeSelectedFile(panel.querySelector('#tms-file').files?.[0]); }"
new = "      try { requireRuntimeOperation('analyze'); await analyzeSelectedFile(panel.querySelector('#tms-file').files?.[0]); }"
if text.count(old) != 1:
    raise SystemExit('Analyze marker not found exactly once.')
text = text.replace(old, new, 1)

# 7. Apply gates the effective reviewed plan, never the unreviewed source plan.
old = """      try {
        const reviewedPlan = buildReviewedPlan(APP.plan, APP.review);
        const result = await applyPlan(reviewedPlan);"""
new = """      try {
        const reviewedPlan = buildReviewedPlan(APP.plan, APP.review);
        requireRuntimeOperation('apply', reviewedPlan.actions);
        const result = await applyPlan(reviewedPlan);"""
if text.count(old) != 1:
    raise SystemExit('Apply reviewed-plan marker not found exactly once.')
text = text.replace(old, new, 1)

# 8. Run the first read-only check after the panel and listeners exist.
old = """    });
  }


  async function bootstrap() {"""
new = """    });
    refreshRuntimeCapabilities([]);
  }


  async function bootstrap() {"""
if text.count(old) != 1:
    raise SystemExit(f'mountUi final marker expected once, found {text.count(old)}.')
text = text.replace(old, new, 1)

# 9. Test export for pure status model.
old = '    probeRuntimeEnvironment, inspectNativeViewCapabilitiesReadOnly, inspectMatrixCapabilitiesReadOnly,\n    evaluateRuntimeCapabilities, capabilityOperationAvailability, humanCapabilityBlocker,'
new = '    probeRuntimeEnvironment, inspectNativeViewCapabilitiesReadOnly, inspectMatrixCapabilitiesReadOnly,\n    evaluateRuntimeCapabilities, capabilityOperationAvailability, humanCapabilityBlocker, capabilityStatusModel,'
if text.count(old) != 1:
    raise SystemExit('Test export marker not found exactly once.')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
