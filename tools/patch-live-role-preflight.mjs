import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(path, 'utf8');
const marker = 'LIVE_ASSIGNABLE_ROLE_PREFLIGHT_V1';
if (source.includes(marker)) {
  console.log(`${marker} already installed`);
  process.exit(0);
}

const preflightMarker = '  async function preflightPlan(plan, options = {}) {';
if (!source.includes(preflightMarker)) throw new Error('preflightPlan marker not found');

const helper = `  // ${marker}\n  // A roundtrip workbook may legitimately preserve historical role identities from its\n  // source matrix. Those identities are safe to keep on an existing row, but a NEW row\n  // must reference a RoleID that exists in the current target TESSA Roles domain.\n  // Snapshot overlays are therefore not sufficient evidence for ADD eligibility.\n  function assertAddRoleIdentitiesAvailable(action, structure, dictionaryCatalog) {\n    if (!action || !dictionaryCatalog) return;\n    for (const fn of structure.functions || []) {\n      const column = action.excelRow?.columns?.get?.(fn.id);\n      if (!column) continue;\n      const displays = action.excelRow.flat?.[column.key] || [];\n      const ids = action.excelRow.ids?.[column.key] || [];\n      if (!displays.length) continue;\n\n      const catalogId = dictionaryCatalog.columnCatalogIds?.[definitionKey('function', fn.id)];\n      const roleCatalog = catalogId ? dictionaryCatalog.catalogs?.[catalogId] : null;\n      if (!roleCatalog) {\n        throw new Error(\`Не удалось подтвердить актуальный справочник ролей для функции «\${fn.name}». Запись новой строки остановлена до Store.\`);\n      }\n\n      // loadDictionaryCatalog() merges current matrix snapshot values into the catalog\n      // to preserve historical selectors. For ADD they are deliberately excluded here:\n      // only identities actually returned by the current MtxRoles view are assignable.\n      const liveEntries = (roleCatalog.entries || []).filter(entry =>\n        canonicalValue(entry?.source || roleCatalog.sourceView || '') === 'mtxroles'\n        && canonicalValue(entry?.status || '') !== canonicalValue('Текущее значение'));\n      if (!liveEntries.length) {\n        throw new Error(\`Актуальный MtxRoles для функции «\${fn.name}» пуст или недоступен. Запись новой строки остановлена до Store.\`);\n      }\n\n      const byId = new Map();\n      for (const entry of liveEntries) {\n        const id = canonicalValue(entry?.id || '');\n        if (!id) continue;\n        if (!byId.has(id)) byId.set(id, []);\n        byId.get(id).push(entry);\n      }\n\n      displays.forEach((display, index) => {\n        const explicit = String(ids[index] || '').trim();\n        if (!explicit) return; // hydrateMissingIdsForAction handles genuinely missing IDs.\n        const [rawId = '', rawType = ''] = explicit.split('|').map(value => value.trim());\n        const id = canonicalValue(rawId);\n        const roleTypeId = canonicalValue(rawType);\n        const candidates = byId.get(id) || [];\n        const exact = candidates.find(entry => !roleTypeId || canonicalValue(entry.roleTypeId) === roleTypeId);\n        if (exact) return;\n        const typeSuffix = rawType ? \`, RoleTypeID=\${rawType}\` : '';\n        throw new Error(\`Роль «\${display}» (RoleID=\${rawId}\${typeSuffix}) недоступна в актуальном MtxRoles текущей TESSA. Старый/чужой ID нельзя вставить в новую строку. Обновите справочники и выберите актуального исполнителя.\`);\n      });\n    }\n  }\n\n`;
source = source.replace(preflightMarker, helper + preflightMarker);

const freshMapMarker = '    const freshByVersion = new Map(fresh.rows.map(row => [canonicalValue(row.versionId), row]));';
if (!source.includes(freshMapMarker)) throw new Error('freshByVersion marker not found');
const liveCatalogBlock = `    let liveAddRoleCatalog = options.liveAddRoleCatalog || null;\n    let liveAddRoleCatalogError = null;\n    const needsAddRoleValidation = (plan.actions || []).some(action => action.type === 'add');\n    if (needsAddRoleValidation && !liveAddRoleCatalog && typeof bridge.loadDictionaryCatalog === 'function') {\n      try {\n        preflightProgress(20, 'Проверяю актуальные роли', 'Сверяю RoleID новых строк с текущим MtxRoles');\n        liveAddRoleCatalog = await awaitPreflightAbortable(bridge.loadDictionaryCatalog(structure, fresh, { forceRefresh: true, transient: true }));\n      } catch (error) {\n        if (isPreflightAbortError(error)) throw error;\n        liveAddRoleCatalogError = error;\n      }\n    }\n\n`;
source = source.replace(freshMapMarker, liveCatalogBlock + freshMapMarker);

const addStart = source.indexOf('    const validateAddAction = async action => {');
if (addStart < 0) throw new Error('validateAddAction marker not found');
const addTail = source.slice(addStart);
const hydrateMarker = '        await awaitPreflightAbortable(hydrateMissingIdsForAction(action, structure, fresh, bridge));\n        for (const condition of structure.conditions) {';
const hydratePos = addTail.indexOf(hydrateMarker);
if (hydratePos < 0) throw new Error('ADD hydrate marker not found');
const replacement = `        await awaitPreflightAbortable(hydrateMissingIdsForAction(action, structure, fresh, bridge));\n        if (liveAddRoleCatalogError) {\n          throw new Error(\`Не удалось перечитать актуальный MtxRoles перед добавлением строки: \${liveAddRoleCatalogError.message || liveAddRoleCatalogError}\`);\n        }\n        if (liveAddRoleCatalog) assertAddRoleIdentitiesAvailable(action, structure, liveAddRoleCatalog);\n        for (const condition of structure.conditions) {`;
const absolute = addStart + hydratePos;
source = source.slice(0, absolute) + replacement + source.slice(absolute + hydrateMarker.length);

fs.writeFileSync(path, source);
console.log(`${marker} installed`);
