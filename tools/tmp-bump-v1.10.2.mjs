import fs from 'node:fs';

function replaceExact(path, before, after, expectedCount = 1) {
  const source = fs.readFileSync(path, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== expectedCount) throw new Error(`${path}: expected ${expectedCount} occurrences, got ${count}`);
  fs.writeFileSync(path, source.split(before).join(after));
}

replaceExact('tessa-matrix-studio.user.js', '// @version      1.10.1', '// @version      1.10.2');
replaceExact('tessa-matrix-studio.user.js', "    version: '1.10.1',", "    version: '1.10.2',");
replaceExact('package.json', '"version": "1.10.1"', '"version": "1.10.2"');
replaceExact('package-lock.json', '"version": "1.10.1"', '"version": "1.10.2"', 2);

const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const anchor = '# Changelog\n\n';
if (!changelog.startsWith(anchor)) throw new Error('CHANGELOG anchor missing');
const entry = `## 1.10.2 — 2026-09-04\n\n- Добавлена ограниченная read-only диагностика серверной ошибки \`LeftOperandExtractor is null\`: после отклонённого контрольного \`saved-rebuilt\` выполняются три дополнительных duplicate-check варианта.\n- В вариантах по одному меняется только сериализованная interval-строка исходящего запроса: удаляется \`.changed\`, \`.state\` или оба маркера. Значения \`IntValue/IntToValue\`, идентификаторы, роли и остальные строки не меняются.\n- Исходная SDK-карточка не модифицируется; Store/Delete не вызываются, обычный Apply не меняется. Диагностика ограничена семью duplicate-check запросами и не запускает structural probes, если контрольная перестроенная строка уже проходит проверку.\n- Это диагностический релиз, а не объявление исправления серверной ошибки. Результат нужен, чтобы определить минимальный structural trigger перед отдельным fix-PR.\n\n`;
if (changelog.includes('## 1.10.2 —')) throw new Error('CHANGELOG already contains 1.10.2');
fs.writeFileSync('CHANGELOG.md', anchor + entry + changelog.slice(anchor.length));

console.log('Prepared v1.10.2 metadata and changelog.');
