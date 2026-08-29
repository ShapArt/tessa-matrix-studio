from pathlib import Path
import re

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')
if 'readMatrixRowFromCard(card, link, structure, caches = {})' in text:
    print('v1.9.28 production patch already present')
    raise SystemExit(0)

marker = '    async loadSnapshot(structure) {'
helper = r'''    readMatrixRowFromCard(card, link, structure, caches = {}) {
      const criterionIdCache = caches.criterionIdCache || null;
      const roleIdCache = caches.roleIdCache || null;
      const roleIdByFunctionCache = caches.roleIdByFunctionCache || null;
      const valuesSection = this.section(card, S.Values);
      const rolesSection = this.section(card, S.Roles);
      const flat = {};
      const values = {};
      const roles = {};

      for (const condition of structure.conditions) {
        const rows = (valuesSection?.rows || []).filter(row =>
          !this.isDeleted(row)
          && canonicalValue(this.rowValue(row, F.OwnerRowID)) === canonicalValue(link.versionId)
          && canonicalValue(this.rowValue(row, F.CriterionRowID)) === canonicalValue(condition.criterionRowId));
        const items = rows.map(row => this.readCriterionValue(row, condition)).filter(Boolean);
        values[condition.criterionRowId] = items;
        flat[definitionKey('criterion', condition.criterionRowId)] = items.map(x => x.display);
        if (criterionIdCache) {
          for (const item of items) {
            if (item.id !== null && item.id !== undefined && item.id !== '') {
              const cacheKey = `${condition.criterionRowId}|${canonicalValue(item.display)}`;
              if (!criterionIdCache.has(cacheKey)) criterionIdCache.set(cacheKey, item);
              else if (canonicalValue(criterionIdCache.get(cacheKey).id) !== canonicalValue(item.id)) criterionIdCache.set(cacheKey, { ambiguous: true, display: item.display });
            }
          }
        }
      }

      for (const fn of structure.functions) {
        const rows = (rolesSection?.rows || []).filter(row =>
          !this.isDeleted(row)
          && canonicalValue(this.rowValue(row, F.OwnerRowID)) === canonicalValue(link.versionId)
          && canonicalValue(this.rowValue(row, F.FunctionID)) === canonicalValue(fn.id));
        const items = rows.map(row => ({
          id: this.rowValue(row, F.RoleID),
          display: this.rowValue(row, F.RoleName) || '',
          roleTypeId: this.rowValue(row, F.RoleTypeID),
        })).filter(x => x.display);
        roles[fn.id] = items;
        flat[definitionKey('function', fn.id)] = items.map(x => x.display);
        for (const item of items) {
          const globalKey = canonicalValue(item.display);
          if (roleIdCache) {
            if (!roleIdCache.has(globalKey)) roleIdCache.set(globalKey, item);
            else if (canonicalValue(roleIdCache.get(globalKey).id) !== canonicalValue(item.id)) roleIdCache.set(globalKey, { ambiguous: true, display: item.display });
          }
          if (roleIdByFunctionCache) {
            const functionKey = `${fn.id}|${globalKey}`;
            if (!roleIdByFunctionCache.has(functionKey)) roleIdByFunctionCache.set(functionKey, item);
            else if (canonicalValue(roleIdByFunctionCache.get(functionKey).id) !== canonicalValue(item.id)) roleIdByFunctionCache.set(functionKey, { ambiguous: true, display: item.display });
          }
        }
      }

      return { ...link, card, values, roles, flat, fingerprint: fingerprintFlat(flat) };
    }

'''
if marker not in text:
    raise SystemExit('loadSnapshot marker not found')
text = text.replace(marker, helper + marker, 1)

pattern = re.compile(
    r"      const loadedRows = await mapConcurrent\(links, PERFORMANCE\.SnapshotCardGetConcurrency, async \(link, i\) => \{[\s\S]*?      \}\);\n      snapshotRows\.push\(\.\.\.loadedRows\);",
    re.M,
)
replacement = r'''      const loadedRows = await mapConcurrent(links, PERFORMANCE.SnapshotCardGetConcurrency, async (link, i) => {
        if (APP.abortRequested) throw new Error('Операция остановлена пользователем.');
        const card = await this.getCard(link.rowCardId);
        return this.readMatrixRowFromCard(card, link, structure, {
          criterionIdCache,
          roleIdCache,
          roleIdByFunctionCache,
        });
      });
      snapshotRows.push(...loadedRows);'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'loadSnapshot decoder replacement count={count}')

old_delete = r'''        // DeleteRow is a custom request without CardStoreRequest.AffectVersion.
        // Re-read the target immediately before deletion and fail closed on any drift.
        const deleteSnapshot = await bridge.loadSnapshot(structure);
        const deleteTarget = (deleteSnapshot.rows || []).find(row =>
          canonicalValue(row.rowCardId) === canonicalValue(prepared.current.rowCardId));
        if (!deleteTarget) {
          throw new Error(`Удаление строки TESSA ${action.currentRow.index + 1} пропущено: строка исчезла после предварительной проверки. Обновите Excel и проверьте изменения заново.`);
        }
'''
new_delete = r'''        // DeleteRow is a custom request without CardStoreRequest.AffectVersion.
        // Read only the target card immediately before deletion instead of reloading the whole matrix.
        const deleteCard = await bridge.getCard(prepared.current.rowCardId);
        const deleteTarget = bridge.readMatrixRowFromCard(deleteCard, {
          index: prepared.current.index,
          rowCardId: prepared.current.rowCardId,
          versionId: prepared.current.versionId,
          rowName: prepared.current.rowName,
          source: 'targeted-delete-recheck',
        }, structure);
'''
if old_delete not in text:
    raise SystemExit('DELETE snapshot block not found')
text = text.replace(old_delete, new_delete, 1)
path.write_text(text, encoding='utf-8')
print('v1.9.28 production patch applied')
