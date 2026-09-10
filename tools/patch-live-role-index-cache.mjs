import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(path, 'utf8');
const marker = 'LIVE_ASSIGNABLE_ROLE_INDEX_CACHE_V1';
if (source.includes(marker)) {
  console.log(`${marker} already installed`);
  process.exit(0);
}

const helperMarker = '  // LIVE_ASSIGNABLE_ROLE_PREFLIGHT_V1\n';
if (!source.includes(helperMarker)) throw new Error('role preflight helper marker not found');
source = source.replace(helperMarker, `  // ${marker}\n  const LIVE_ASSIGNABLE_ROLE_INDEX_CACHE = new WeakMap();\n\n${helperMarker}`);

const oldBlock = `      const liveEntries = (roleCatalog.entries || []).filter(entry =>\n        canonicalValue(entry?.source || roleCatalog.sourceView || '') === 'mtxroles'\n        && canonicalValue(entry?.status || '') !== canonicalValue('Текущее значение'));\n      if (!liveEntries.length) {\n        throw new Error(\`Актуальный MtxRoles для функции «\${fn.name}» пуст или недоступен. Запись новой строки остановлена до Store.\`);\n      }\n\n      const byId = new Map();\n      for (const entry of liveEntries) {\n        const id = canonicalValue(entry?.id || '');\n        if (!id) continue;\n        if (!byId.has(id)) byId.set(id, []);\n        byId.get(id).push(entry);\n      }\n`;
const newBlock = `      let byId = LIVE_ASSIGNABLE_ROLE_INDEX_CACHE.get(roleCatalog);\n      if (!byId) {\n        byId = new Map();\n        for (const entry of roleCatalog.entries || []) {\n          if (canonicalValue(entry?.source || roleCatalog.sourceView || '') !== 'mtxroles') continue;\n          if (canonicalValue(entry?.status || '') === canonicalValue('Текущее значение')) continue;\n          const id = canonicalValue(entry?.id || '');\n          if (!id) continue;\n          if (!byId.has(id)) byId.set(id, []);\n          byId.get(id).push(entry);\n        }\n        LIVE_ASSIGNABLE_ROLE_INDEX_CACHE.set(roleCatalog, byId);\n      }\n      if (!byId.size) {\n        throw new Error(\`Актуальный MtxRoles для функции «\${fn.name}» пуст или недоступен. Запись новой строки остановлена до Store.\`);\n      }\n`;
if (!source.includes(oldBlock)) throw new Error('role catalog indexing block not found');
source = source.replace(oldBlock, newBlock);

fs.writeFileSync(path, source);
console.log(`${marker} installed`);
