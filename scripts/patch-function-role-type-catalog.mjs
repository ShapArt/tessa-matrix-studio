import fs from 'node:fs';

const path = new URL('../tessa-matrix-studio.user.js', import.meta.url);
let source = fs.readFileSync(path, 'utf8');

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

// The role-catalog projection changed. Invalidate 1.10.1 IndexedDB dictionary caches so
// an old unfiltered MtxRoles catalog can never survive an upgrade and reintroduce the bug.
if (source.includes('projectionVersion: 2,')) source = source.replace('projectionVersion: 2,', 'projectionVersion: 3,');
else if (!source.includes('projectionVersion: 3,')) throw new Error('dictionary projectionVersion anchor not found');

fs.writeFileSync(path, source, 'utf8');
console.log('Applied function RoleType catalog partition + cache projection bump.');
