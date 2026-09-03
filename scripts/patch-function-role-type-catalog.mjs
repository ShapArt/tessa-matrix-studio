import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const write = (file, content) => fs.writeFileSync(new URL(file, root), content, 'utf8');
const replaceRequired = (text, from, to, label) => {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`${label}: expected text not found`);
  return text.replace(from, to);
};

// 1) Keep the functional RoleType fix idempotent.
let source = read('tessa-matrix-studio.user.js');
const helperAnchor = `  function definitionKey(kind, id) {\n    return \`\${kind}:\${canonicalValue(id)}\`;\n  }\n`;
const helperReplacement = `  function knownRoleTypeId(value) {\n    const text = normalizeSpace(value);\n    if (!text) return null;\n    const roleTypeId = Number(text);\n    return Number.isInteger(roleTypeId) && roleTypeId >= 0 && roleTypeId <= 7 ? roleTypeId : null;\n  }\n\n  function definitionKey(kind, id) {\n    return \`\${kind}:\${canonicalValue(id)}\`;\n  }\n`;
if (!source.includes('function knownRoleTypeId(value)')) {
  if (!source.includes(helperAnchor)) throw new Error('definitionKey anchor not found');
  source = source.replace(helperAnchor, helperReplacement);
}

const oldRoleMapping = `      const [criterionResults, roleResult] = await Promise.all([Promise.all(criterionJobs), roleJob]);\n      for (const item of criterionResults) catalog.catalogs[item.catalogId] = item.catalog;\n      catalog.catalogs[roleResult.roleCatalogId] = { id: roleResult.roleCatalogId, label: 'Роли и пользователи TESSA', sourceView: roleResult.roleAlias || 'Текущая матрица', entries: roleResult.roleEntries };\n      structure.functions.forEach(fn => { catalog.columnCatalogIds[definitionKey('function', fn.id)] = roleResult.roleCatalogId; });\n`;
const newRoleMapping = `      const [criterionResults, roleResult] = await Promise.all([Promise.all(criterionJobs), roleJob]);\n      for (const item of criterionResults) catalog.catalogs[item.catalogId] = item.catalog;\n\n      // FunctionType.ID uses the same numeric role-type domain as RoleTypeID.\n      // MtxRoles contains multiple role classes, so exposing one shared catalog to every\n      // function lets departments leak into Personal pickers (and vice versa). Partition\n      // only when the server actually returned typed role entries. Unknown/custom function\n      // types keep the old conservative shared catalog instead of being guessed.\n      const sharedRoleCatalog = {\n        id: roleResult.roleCatalogId,\n        label: 'Роли и пользователи TESSA',\n        sourceView: roleResult.roleAlias || 'Текущая матрица',\n        entries: roleResult.roleEntries,\n      };\n      const hasTypedRoleEntries = roleResult.roleEntries.some(entry => knownRoleTypeId(entry.roleTypeId) !== null);\n      const typedRoleCatalogIds = new Map();\n      const ensureSharedRoleCatalog = () => {\n        if (!catalog.catalogs[roleResult.roleCatalogId]) catalog.catalogs[roleResult.roleCatalogId] = sharedRoleCatalog;\n        return roleResult.roleCatalogId;\n      };\n\n      for (const fn of structure.functions) {\n        const functionRoleTypeId = hasTypedRoleEntries ? knownRoleTypeId(fn.typeId) : null;\n        if (functionRoleTypeId === null) {\n          catalog.columnCatalogIds[definitionKey('function', fn.id)] = ensureSharedRoleCatalog();\n          continue;\n        }\n        let typedCatalogId = typedRoleCatalogIds.get(functionRoleTypeId);\n        if (!typedCatalogId) {\n          typedCatalogId = \`\${roleResult.roleCatalogId}:type:\${functionRoleTypeId}\`;\n          typedRoleCatalogIds.set(functionRoleTypeId, typedCatalogId);\n          catalog.catalogs[typedCatalogId] = {\n            ...sharedRoleCatalog,\n            id: typedCatalogId,\n            label: \`Роли и пользователи TESSA · тип \${functionRoleTypeId}\`,\n            entries: roleResult.roleEntries.filter(entry => knownRoleTypeId(entry.roleTypeId) === functionRoleTypeId),\n          };\n        }\n        catalog.columnCatalogIds[definitionKey('function', fn.id)] = typedCatalogId;\n      }\n`;
if (!source.includes('const hasTypedRoleEntries = roleResult.roleEntries.some')) {
  if (!source.includes(oldRoleMapping)) throw new Error('role mapping anchor not found');
  source = source.replace(oldRoleMapping, newRoleMapping);
}
if (source.includes('projectionVersion: 2,')) source = source.replace('projectionVersion: 2,', 'projectionVersion: 3,');
else if (!source.includes('projectionVersion: 3,')) throw new Error('dictionary projectionVersion anchor not found');

// 2) Prepare immutable release v1.10.2.
source = replaceRequired(source, '// @version      1.10.1', '// @version      1.10.2', 'userscript header version');
source = replaceRequired(source, "    version: '1.10.1',", "    version: '1.10.2',", 'runtime APP version');
write('tessa-matrix-studio.user.js', source);

for (const file of ['package.json', 'package-lock.json']) {
  const json = JSON.parse(read(file));
  json.version = '1.10.2';
  if (json.packages?.['']) json.packages[''].version = '1.10.2';
  write(file, `${JSON.stringify(json, null, 2)}\n`);
}

let readme = read('README.md');
readme = replaceRequired(readme, 'version-1.10.1-', 'version-1.10.2-', 'README badge');
readme = replaceRequired(readme, '**v1.10.1 · Автор: Шаповалов Артём**', '**v1.10.2 · Автор: Шаповалов Артём**', 'README header');
readme = replaceRequired(readme, 'Подтвердите установку версии **1.10.1**', 'Подтвердите установку версии **1.10.2**', 'README quick start');
readme = replaceRequired(readme, 'Текущая версия: **1.10.1**', 'Текущая версия: **1.10.2**', 'README support version');
readme = replaceRequired(readme, 'Что изменилось в 1.10.0–1.10.1 и текущее известное ограничение', 'Что изменилось в 1.10.0–1.10.2 и текущее известное ограничение', 'README details heading');
const readmeMarker = 'В 1.10.1 подписи существующих строк в Excel совпадают с матрицей TESSA.';
const readmeRelease = 'В 1.10.2 списки функций больше не смешивают разные типы ролей TESSA: функции типа Personal предлагают персональные роли, Department — подразделения. Уже сохранённые legacy-значения не теряются: точная пара RoleID/RoleTypeID остаётся доступной в своей строке, но посторонние роли другого типа не предлагаются как новые. Кэш справочников 1.10.1 автоматически инвалидируется.\n\n';
if (!readme.includes('В 1.10.2 списки функций больше не смешивают разные типы ролей TESSA')) {
  if (!readme.includes(readmeMarker)) throw new Error('README release insertion marker not found');
  readme = readme.replace(readmeMarker, `${readmeRelease}${readmeMarker}`);
}
write('README.md', readme);

let bug = read('.github/ISSUE_TEMPLATE/bug_report.yml');
bug = replaceRequired(bug, 'placeholder: 1.10.1', 'placeholder: 1.10.2', 'bug template version');
write('.github/ISSUE_TEMPLATE/bug_report.yml', bug);

let changelog = read('CHANGELOG.md');
if (!changelog.includes('## 1.10.2 — 2026-09-03')) {
  const entry = `## 1.10.2 — 2026-09-03\n\n- Исправлено смешение типов ролей в функциях матрицы: общий \\`MtxRoles\\` теперь разделяется по \\`FunctionType.ID / RoleTypeID\\` для известных типов TESSA. Например, Personal-функция не предлагает подразделения, а Department-функция — персональных пользователей.\n- Текущие значения матрицы сохраняются поверх отфильтрованного справочника по точной паре \\`RoleID|RoleTypeID\\`. Это сохраняет старые/нестандартные строки, но не открывает весь чужой тип роли для нового выбора.\n- Неизвестный или нестандартный тип функции не угадывается: используется консервативный общий каталог, пока TESSA не вернёт однозначный тип.\n- Версия проекции справочников поднята до 3, поэтому кэш 1.10.1 с неразделённым \\`MtxRoles\\` не переиспользуется после обновления.\n- Добавлены две регрессии: разделение Personal/Department и сохранение legacy-значения без утечки остальных ролей чужого типа. Полный \\`npm test\\` проходит.\n- Серверная ошибка \\`LeftOperandExtractor is null\\` остаётся отдельным известным ограничением и не обходится; Store после отказа проверки дубликатов не запускается.\n\n`;
  changelog = changelog.replace('# Changelog\n\n', `# Changelog\n\n${entry}`);
}
write('CHANGELOG.md', changelog);

let uat = read('docs/UAT-v1.10.0.md');
uat = replaceRequired(uat, '# UAT 1.10.0–1.10.1: справочники, обновление и запись', '# UAT 1.10.0–1.10.2: справочники, обновление и запись', 'UAT title');
if (!uat.includes('### Проверка типов ролей в 1.10.2')) {
  uat += `\n### Проверка типов ролей в 1.10.2\n\n| Шаг | Ожидаемый результат |\n|---|---|\n| Открыть «Собрать значения» для функции с FunctionType Personal (RoleTypeID 1), например персонального подписанта | В обычных вариантах только персональные роли; подразделения RoleTypeID 2 не предлагаются |\n| Открыть функцию с FunctionType Department (RoleTypeID 2) | В обычных вариантах только подразделения; персональные роли RoleTypeID 1 не предлагаются |\n| Выгрузить строку, где исторически сохранена роль другого типа | Точное текущее значение остаётся читаемым и даёт NOOP по RoleID|RoleTypeID; другие роли этого чужого типа не появляются в списке |\n| Проверить функцию с неизвестным/нестандартным FunctionType | Studio не угадывает тип и сохраняет консервативный общий каталог |\n| Обновиться с 1.10.1 и выполнить новую выгрузку/обновление справочников | Старый IndexedDB-кэш не переиспользуется: projectionVersion=3 строит новый типизированный каталог |\n\nАвтоматические регрессии \\`tests/function-role-type-catalog.mjs\\` подтверждают разделение Personal/Department и сохранение точного legacy-значения. Живой UAT в рабочей TESSA всё равно требуется: он подтверждает реальные FunctionType конкретного шаблона и содержимое корпоративного \\`MtxRoles\\`.\n`;
}
write('docs/UAT-v1.10.0.md', uat);

console.log('Applied RoleType fix and prepared v1.10.2 release metadata/docs.');
