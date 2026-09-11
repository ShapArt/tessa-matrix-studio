import fs from 'node:fs';

const target = new URL('../tessa-matrix-studio.user.js', import.meta.url);
let code = fs.readFileSync(target, 'utf8');

function replaceOnce(before, after, label) {
  if (code.includes(after)) return;
  const index = code.indexOf(before);
  if (index < 0) throw new Error(`Patch anchor not found: ${label}`);
  if (code.indexOf(before, index + before.length) >= 0) throw new Error(`Patch anchor is not unique: ${label}`);
  code = code.slice(0, index) + after + code.slice(index + before.length);
}

const helpersAnchor = `  function finalizeDictionaryEntries(entries) {`;
const helpersBlock = `  // EMPLOYEE_ROLE_PROJECTION_V1\n  // RoleID/RoleTypeID remain the identity. Employee fields below are presentation/search\n  // metadata read from explicit MtxRoles projection columns; position is never guessed\n  // from RoleName or free-form details.\n  const PERSONAL_ROLE_TYPE_ID = 1;\n\n  function exactProjectionColumnIndex(columns, aliases) {\n    const accepted = new Set((aliases || []).map(searchCanonical));\n    return Array.from(columns || []).findIndex(column => accepted.has(searchCanonical(column)));\n  }\n\n  function projectionText(row, columns, aliases, localize = value => value) {\n    const index = exactProjectionColumnIndex(columns, aliases);\n    if (index < 0) return '';\n    const raw = row?.[index];\n    if (raw === null || raw === undefined || typeof raw === 'object') return '';\n    return normalizeSpace(localize(raw));\n  }\n\n  function employeeProjectionFields(row, columns, roleTypeId, nativeDisplay, localize = value => value) {\n    if (Number(roleTypeId) !== PERSONAL_ROLE_TYPE_ID) return null;\n    const explicitShort = projectionText(row, columns, [\n      'ShortName', 'RoleShortName', 'UserShortName', 'EmployeeShortName', 'PersonalRoleShortName',\n    ], localize);\n    const shortName = explicitShort || normalizeSpace(nativeDisplay);\n    const fullName = projectionText(row, columns, [\n      'FullName', 'RoleFullName', 'UserFullName', 'EmployeeFullName', 'PersonalRoleFullName', 'PersonFullName',\n    ], localize);\n    const position = projectionText(row, columns, [\n      'PositionName', 'Position', 'RolePositionName', 'UserPositionName', 'EmployeePositionName',\n      'PersonalRolePositionName', 'JobTitle', 'JobTitleName', 'PostName',\n    ], localize);\n    const department = projectionText(row, columns, [\n      'DepartmentName', 'Department', 'RoleDepartmentName', 'UserDepartmentName', 'EmployeeDepartmentName',\n      'PersonalRoleDepartmentName', 'SubdivisionName', 'UnitName',\n    ], localize);\n    const displayName = position && shortName ? \`${'${shortName}'} — ${'${position}'}\` : (shortName || fullName || normalizeSpace(nativeDisplay));\n    return { shortName, fullName, position, department, displayName, nativeDisplay: normalizeSpace(nativeDisplay) };\n  }\n\n  function employeeResolvableAliases(item) {\n    if (!item || Number(item.roleTypeId) !== PERSONAL_ROLE_TYPE_ID) return [];\n    return [...new Set([\n      item.displayName, item.shortName, item.fullName, item.nativeDisplay,\n      ...(item.previousSelectors || []),\n    ].map(normalizeSpace).filter(Boolean))];\n  }\n\n  function dictionaryRoleDisplay(catalog, item) {\n    if (!catalog || !item) return item?.display || '';\n    const lookup = dictionaryLookup(catalog);\n    const id = canonicalValue(item.id);\n    const roleType = canonicalValue(item.roleTypeId);\n    const candidates = lookup?.byId?.get(\`${'${id}'}|${'${roleType}'}\`) || lookup?.byId?.get(\`${'${id}'}|\`) || [];\n    const found = candidates.find(entry => !roleType || canonicalValue(entry.roleTypeId) === roleType) || candidates[0];\n    return found?.displayName || found?.display || item.display || '';\n  }\n\n${helpersAnchor}`;
replaceOnce(helpersAnchor, helpersBlock, 'employee projection helpers');

const finalizeSource = `      const identity = \`${'${canonicalValue(id)}'}|${'${canonicalValue(roleTypeId)}'}\`;\n      const qualifier = normalizeSpace(source.qualifier || humanQualifierFromDetails(source.details, display));\n      if (!byIdentity.has(identity)) byIdentity.set(identity, { ...source, id, display, roleTypeId, qualifier });`;
const finalizeTarget = `      const identity = \`${'${canonicalValue(id)}'}|${'${canonicalValue(roleTypeId)}'}\`;\n      const qualifier = normalizeSpace(source.qualifier || humanQualifierFromDetails(source.details, display));\n      const previousSelectors = [...new Set([\n        ...(source.previousSelectors || []),\n        ...(Number(roleTypeId) === PERSONAL_ROLE_TYPE_ID && source.nativeDisplay && canonicalValue(source.nativeDisplay) !== canonicalValue(display) ? [source.nativeDisplay] : []),\n      ].map(normalizeSpace).filter(Boolean))];\n      if (!byIdentity.has(identity)) byIdentity.set(identity, { ...source, id, display, roleTypeId, qualifier, previousSelectors });`;
replaceOnce(finalizeSource, finalizeTarget, 'preserve employee bare-FIO selector');

const appendCurrentSource = `      if (current?.display === display || (firstDisplay && (current?.previousSelectors || []).includes(display))) return;\n      if (!changesByCatalog.has(catalogId)) changesByCatalog.set(catalogId, new Map());`;
const appendCurrentTarget = `      if (current?.display === display || (firstDisplay && (current?.previousSelectors || []).includes(display))) return;\n      const employeeAliasMatch = current && Number(current.roleTypeId) === PERSONAL_ROLE_TYPE_ID\n        && employeeResolvableAliases(current).some(alias => canonicalValue(alias) === canonicalValue(display));\n      if (employeeAliasMatch) {\n        const aliases = [...new Set([...(current.previousSelectors || []), display].map(normalizeSpace).filter(Boolean))];\n        if ((current.previousSelectors || []).map(canonicalValue).includes(canonicalValue(display))) return;\n        if (!changesByCatalog.has(catalogId)) changesByCatalog.set(catalogId, new Map());\n        changesByCatalog.get(catalogId).set(identity, { ...current, previousSelectors: aliases });\n        return;\n      }\n      if (!changesByCatalog.has(catalogId)) changesByCatalog.set(catalogId, new Map());`;
replaceOnce(appendCurrentSource, appendCurrentTarget, 'preserve enriched caption during snapshot overlay');

const lookupMapsSource = `    const byId = new Map();\n    const bySelector = new Map();\n    const byDisplay = new Map();\n    const searchRows = [];`;
const lookupMapsTarget = `    const byId = new Map();\n    const bySelector = new Map();\n    const byDisplay = new Map();\n    const byEmployeeAlias = new Map();\n    const searchRows = [];`;
replaceOnce(lookupMapsSource, lookupMapsTarget, 'employee alias lookup map');

const lookupAppendSource = `      append(bySelector, canonicalValue(item.selector), item);\n      append(byDisplay, canonicalValue(item.display), item);\n      searchRows.push({`;
const lookupAppendTarget = `      append(bySelector, canonicalValue(item.selector), item);\n      append(byDisplay, canonicalValue(item.display), item);\n      for (const alias of employeeResolvableAliases(item)) append(byEmployeeAlias, canonicalValue(alias), item);\n      searchRows.push({`;
replaceOnce(lookupAppendSource, lookupAppendTarget, 'index employee aliases');

const lookupReturnSource = `    const lookup = { items, byId, bySelector, byDisplay, searchRows, isBoolean, resolutionCache: new Map() };`;
const lookupReturnTarget = `    const lookup = { items, byId, bySelector, byDisplay, byEmployeeAlias, searchRows, isBoolean, resolutionCache: new Map() };`;
replaceOnce(lookupReturnSource, lookupReturnTarget, 'return employee alias index');

const explicitMatchSource = `    if (explicitMatch && [explicitMatch.selector, explicitMatch.display, ...(explicitMatch.previousSelectors || [])].map(canonicalValue).includes(visibleCanonical)) {\n      return resolvedItem(explicitMatch, 'id-and-text');\n    }\n\n    let matches = lookup.bySelector.get(visibleCanonical) || [];\n    if (!matches.length) matches = lookup.byDisplay.get(visibleCanonical) || [];`;
const explicitMatchTarget = `    if (explicitMatch && [\n      explicitMatch.selector, explicitMatch.display, ...(explicitMatch.previousSelectors || []),\n      ...employeeResolvableAliases(explicitMatch),\n    ].map(canonicalValue).includes(visibleCanonical)) {\n      return resolvedItem(explicitMatch, 'id-and-text');\n    }\n\n    let matches = lookup.bySelector.get(visibleCanonical) || [];\n    if (!matches.length) matches = lookup.byDisplay.get(visibleCanonical) || [];\n    if (!matches.length) matches = lookup.byEmployeeAlias.get(visibleCanonical) || [];`;
replaceOnce(explicitMatchSource, explicitMatchTarget, 'resolve employee exact aliases');

const projectionSource = `        const roleTypeId = roleTypeIndex >= 0 && row[roleTypeIndex] !== null && row[roleTypeIndex] !== undefined && row[roleTypeIndex] !== '' ? Number(row[roleTypeIndex]) : '';\n        const details = columns.map((alias, index) => {`;
const projectionTarget = `        const roleTypeId = roleTypeIndex >= 0 && row[roleTypeIndex] !== null && row[roleTypeIndex] !== undefined && row[roleTypeIndex] !== '' ? Number(row[roleTypeIndex]) : '';\n        const nativeDisplay = display;\n        const employee = roleMode ? employeeProjectionFields(row, columns, roleTypeId, nativeDisplay, value => this.localizeValue(value)) : null;\n        if (employee?.displayName) display = employee.displayName;\n        const details = columns.map((alias, index) => {`;
replaceOnce(projectionSource, projectionTarget, 'read employee projection fields');

const entryPushSource = `        entries.push({ id: String(id), display, qualifier, roleTypeId: Number.isFinite(roleTypeId) ? roleTypeId : '', source: result.alias, status: 'Доступно', details, searchText });`;
const entryPushTarget = `        entries.push({\n          id: String(id), display, qualifier, roleTypeId: Number.isFinite(roleTypeId) ? roleTypeId : '',\n          source: result.alias, status: 'Доступно', details, searchText,\n          ...(employee || {}),\n        });`;
replaceOnce(entryPushSource, entryPushTarget, 'persist employee projection fields');

const gridRoleSource = `        values.push(items.map(item => item.display || dictionarySelector(dict, item.id, item.roleTypeId, '')).join('\\n'));`;
const gridRoleTarget = `        values.push(items.map(item => dictionaryRoleDisplay(dict, item) || item.display || dictionarySelector(dict, item.id, item.roleTypeId, '')).join('\\n'));`;
replaceOnce(gridRoleSource, gridRoleTarget, 'export enriched role labels');

replaceOnce(`      projectionVersion: 4,`, `      projectionVersion: 5,`, 'invalidate old dictionary projection cache');

fs.writeFileSync(target, code);

// Make the new contracts part of the ordinary regression suite as soon as GREEN lands.
const packageUrl = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(packageUrl, 'utf8'));
for (const testFile of ['tests/employee-position-excel.mjs', 'tests/employee-name-resolver.mjs']) {
  const command = `node ${testFile}`;
  if (!pkg.scripts.test.includes(command)) pkg.scripts.test += ` && ${command}`;
}
fs.writeFileSync(packageUrl, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('EMPLOYEE_ROLE_PROJECTION_V1 installed');
