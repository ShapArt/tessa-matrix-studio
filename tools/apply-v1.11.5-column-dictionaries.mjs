import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: expected source block not found`);
  if (source.indexOf(before, first + 1) >= 0) throw new Error(`${label}: source block is not unique`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  'role helpers',
`  function knownRoleTypeId(value) {
    const text = normalizeSpace(value);
    if (!text) return null;
    const roleTypeId = Number(text);
    return Number.isInteger(roleTypeId) && roleTypeId >= 0 && roleTypeId <= 7 ? roleTypeId : null;
  }`,
`  function knownRoleTypeId(value) {
    const text = normalizeSpace(value);
    if (!text) return null;
    const roleTypeId = Number(text);
    return Number.isInteger(roleTypeId) && roleTypeId >= 0 && roleTypeId <= 7 ? roleTypeId : null;
  }

  // MtxRoles.RoleTypeID is an Int16 domain and may contain corporate extensions
  // (for example RoleTypeID=9 for a group). FunctionType.ID is a different domain:
  // in the live matrices it is a GUID such as 10a72b11-... for «Исполнитель».
  // Never coerce that GUID into RoleTypeID. For GUID/custom function types we keep all
  // legitimate role classes available, but give every function its own ordered catalog.
  function catalogRoleTypeId(value) {
    const text = normalizeSpace(value);
    if (!text) return null;
    const roleTypeId = Number(text);
    return Number.isInteger(roleTypeId) && roleTypeId >= 0 && roleTypeId <= 32767 ? roleTypeId : null;
  }

  function observedFunctionRoleTypeIds(snapshot, functionId) {
    const counts = new Map();
    for (const row of snapshot?.rows || []) {
      for (const role of row?.roles?.[functionId] || []) {
        const roleTypeId = catalogRoleTypeId(role?.roleTypeId);
        if (roleTypeId === null) continue;
        counts.set(roleTypeId, (counts.get(roleTypeId) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([roleTypeId]) => roleTypeId);
  }

  function prioritizeFunctionRoleEntries(entries, snapshot, functionId) {
    const preferred = observedFunctionRoleTypeIds(snapshot, functionId);
    // Personal is the safest next choice for an «Исполнитель» picker when the matrix
    // does not prove a narrower class. Other classes are not removed: TESSA routes can
    // legitimately contain departments, groups, static/dynamic/context/meta roles.
    if (!preferred.includes(1)) preferred.push(1);
    const fallbackOrder = [9, 2, 0, 3, 4, 5, 6, 7];
    const priority = new Map();
    preferred.forEach(roleTypeId => {
      if (!priority.has(roleTypeId)) priority.set(roleTypeId, priority.size);
    });
    fallbackOrder.forEach(roleTypeId => {
      if (!priority.has(roleTypeId)) priority.set(roleTypeId, priority.size);
    });

    // finalizeDictionaryEntries intentionally alphabetizes ordinary catalogs. Carry a
    // numeric pickerPriority on function-role entries so that normalization can preserve
    // the function-specific role-class order while still sorting names inside one class.
    return Array.from(entries || []).map(entry => {
      const roleTypeId = catalogRoleTypeId(entry?.roleTypeId);
      return {
        ...entry,
        pickerPriority: priority.has(roleTypeId) ? priority.get(roleTypeId) : 1000,
      };
    });
  }`
);

replaceOnce(
  'dictionary priority normalization',
`    return values.sort((a, b) => a.selector.localeCompare(b.selector, 'ru', { sensitivity: 'base' }));`,
`    return values.sort((a, b) => {
      const aPriority = Number.isFinite(Number(a.pickerPriority)) ? Number(a.pickerPriority) : Number.MAX_SAFE_INTEGER;
      const bPriority = Number.isFinite(Number(b.pickerPriority)) ? Number(b.pickerPriority) : Number.MAX_SAFE_INTEGER;
      return aPriority - bPriority || a.selector.localeCompare(b.selector, 'ru', { sensitivity: 'base' });
    });`
);

replaceOnce(
  'role catalog routing',
`      // FunctionType.ID uses the same numeric role-type domain as RoleTypeID.
      // MtxRoles contains multiple role classes, so exposing one shared catalog to every
      // function lets departments leak into Personal pickers (and vice versa). Partition
      // only when the server actually returned typed role entries. Unknown/custom function
      // types keep the old conservative shared catalog instead of being guessed.
      const sharedRoleCatalog = {
        id: roleResult.roleCatalogId,
        label: 'Роли и пользователи TESSA',
        sourceView: roleResult.roleAlias || 'Текущая матрица',
        entries: roleResult.roleEntries,
      };
      const hasTypedRoleEntries = roleResult.roleEntries.some(entry => knownRoleTypeId(entry.roleTypeId) !== null);
      const typedRoleCatalogIds = new Map();
      const ensureSharedRoleCatalog = () => {
        if (!catalog.catalogs[roleResult.roleCatalogId]) catalog.catalogs[roleResult.roleCatalogId] = sharedRoleCatalog;
        return roleResult.roleCatalogId;
      };

      for (const fn of structure.functions) {
        const functionRoleTypeId = hasTypedRoleEntries ? knownRoleTypeId(fn.typeId) : null;
        if (functionRoleTypeId === null) {
          catalog.columnCatalogIds[definitionKey('function', fn.id)] = ensureSharedRoleCatalog();
          continue;
        }
        let typedCatalogId = typedRoleCatalogIds.get(functionRoleTypeId);
        if (!typedCatalogId) {
          typedCatalogId = \`${'${roleResult.roleCatalogId}'}:type:${'${functionRoleTypeId}'}\`;
          typedRoleCatalogIds.set(functionRoleTypeId, typedCatalogId);
          catalog.catalogs[typedCatalogId] = {
            ...sharedRoleCatalog,
            id: typedCatalogId,
            label: \`Роли и пользователи TESSA · тип ${'${functionRoleTypeId}'}\`,
            entries: roleResult.roleEntries.filter(entry => knownRoleTypeId(entry.roleTypeId) === functionRoleTypeId),
          };
        }
        catalog.columnCatalogIds[definitionKey('function', fn.id)] = typedCatalogId;
      }`,
`      // FunctionType.ID and RoleTypeID are separate domains in the live TESSA build.
      // Numeric FunctionType values are still supported for installations that explicitly
      // expose RoleType there. GUID/custom function types get independent catalogs whose
      // ordering is learned from the role types already used by that exact function.
      const sharedRoleCatalog = {
        id: roleResult.roleCatalogId,
        label: 'Роли и пользователи TESSA',
        sourceView: roleResult.roleAlias || 'Текущая матрица',
        entries: roleResult.roleEntries,
      };
      const hasTypedRoleEntries = roleResult.roleEntries.some(entry => catalogRoleTypeId(entry.roleTypeId) !== null);
      const typedRoleCatalogIds = new Map();

      for (const fn of structure.functions) {
        const functionRoleTypeId = hasTypedRoleEntries ? knownRoleTypeId(fn.typeId) : null;
        if (functionRoleTypeId !== null) {
          let typedCatalogId = typedRoleCatalogIds.get(functionRoleTypeId);
          if (!typedCatalogId) {
            typedCatalogId = \`${'${roleResult.roleCatalogId}'}:type:${'${functionRoleTypeId}'}\`;
            typedRoleCatalogIds.set(functionRoleTypeId, typedCatalogId);
            catalog.catalogs[typedCatalogId] = {
              ...sharedRoleCatalog,
              id: typedCatalogId,
              label: \`Роли и пользователи TESSA · тип ${'${functionRoleTypeId}'}\`,
              entries: roleResult.roleEntries.filter(entry => catalogRoleTypeId(entry.roleTypeId) === functionRoleTypeId),
            };
          }
          catalog.columnCatalogIds[definitionKey('function', fn.id)] = typedCatalogId;
          continue;
        }

        const functionCatalogId = \`${'${roleResult.roleCatalogId}'}:function:${'${fn.id}'}\`;
        const observedRoleTypes = observedFunctionRoleTypeIds(snapshot, fn.id);
        catalog.catalogs[functionCatalogId] = {
          ...sharedRoleCatalog,
          id: functionCatalogId,
          label: \`${'${fn.name}'} · роли и пользователи TESSA\`,
          entries: hasTypedRoleEntries
            ? prioritizeFunctionRoleEntries(roleResult.roleEntries, snapshot, fn.id)
            : Array.from(roleResult.roleEntries),
          rolePolicy: {
            mode: hasTypedRoleEntries ? 'function-observed-types-first' : 'untyped-conservative',
            observedRoleTypeIds: observedRoleTypes,
          },
        };
        catalog.columnCatalogIds[definitionKey('function', fn.id)] = functionCatalogId;
      }`
);

replaceOnce('dictionary cache projection version', '      projectionVersion: 3,', '      projectionVersion: 4,');
replaceOnce('userscript header version', '// @version      1.11.4', '// @version      1.11.5');
replaceOnce("runtime version", "    version: '1.11.4',", "    version: '1.11.5',");

fs.writeFileSync(path, source, 'utf8');
console.log('Applied v1.11.5 column dictionary routing patch.');
