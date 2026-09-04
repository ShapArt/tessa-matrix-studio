import fs from 'node:fs';

function replaceExact(path, before, after, expectedCount = 1) {
  const source = fs.readFileSync(path, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== expectedCount) throw new Error(`${path}: expected ${expectedCount} occurrences of ${JSON.stringify(before)}, got ${count}`);
  fs.writeFileSync(path, source.split(before).join(after));
}

replaceExact('README.md', 'version-1.10.1-', 'version-1.10.2-');
replaceExact('README.md', '**v1.10.1 · Автор: Шаповалов Артём**', '**v1.10.2 · Автор: Шаповалов Артём**');
replaceExact('README.md', 'Подтвердите установку версии **1.10.1**', 'Подтвердите установку версии **1.10.2**');
replaceExact('README.md', 'Текущая версия: **1.10.1**', 'Текущая версия: **1.10.2**');
replaceExact('.github/ISSUE_TEMPLATE/bug_report.yml', 'placeholder: 1.10.1', 'placeholder: 1.10.2');

console.log('Synchronized public v1.10.2 documentation contract.');
