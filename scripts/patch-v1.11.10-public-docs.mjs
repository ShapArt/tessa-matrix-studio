import fs from 'node:fs';

const VERSION = '1.11.10';

function replaceExactOnce(path, before, after, label) {
  const source = fs.readFileSync(path, 'utf8');
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${path}: missing ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${path}: ambiguous ${label}`);
  fs.writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length));
}

function patchReadme() {
  const path = 'README.md';
  const replacements = [
    ['version-1.11.8-EF233C', `version-${VERSION}-EF233C`, 'version badge'],
    ['**v1.11.8 · Автор: Шаповалов Артём**', `**v${VERSION} · Автор: Шаповалов Артём**`, 'header version'],
    ['Подтвердите установку версии **1.11.8**', `Подтвердите установку версии **${VERSION}**`, 'quick-start version'],
    ['Текущая версия: **1.11.8**', `Текущая версия: **${VERSION}**`, 'support version'],
  ];
  for (const [before, after, label] of replacements) replaceExactOnce(path, before, after, label);

  let source = fs.readFileSync(path, 'utf8');
  const stale = '**Отказ `LeftOperandExtractor` для двух добавлений пока не устранён.** Свежая диагностика 1.9.50 подтвердила, что удаление пустых временных секций его не исправило. Новый раздел собирает недостающие контрольные запросы; он не обходит отказ и не сохраняет тестовые строки.';
  const current = '**Серверный `LeftOperandExtractor is null` остаётся открытым live-блокером (#57).** В 1.11.9 добавлен узкий повтор через `CardNewMode.Valid`, но свежий live-прогон 1.11.9 снова получил `duplicate-interval-extractor`. Studio не трактует такой ответ как «дублей нет»: серверный `ValidateDuplicate` не обходится, а Store не запускается без успешной проверки.';
  if (source.includes(stale)) source = source.replace(stale, current);
  fs.writeFileSync(path, source);
}

function patchChangelog() {
  const path = 'CHANGELOG.md';
  let source = fs.readFileSync(path, 'utf8');
  if (!source.startsWith('# Changelog\n\n')) throw new Error('CHANGELOG.md: unexpected header');
  if (source.includes(`## ${VERSION} —`)) return;

  const entries = `## 1.11.10 — 2026-09-07\n\n- Повторный импорт уже применённого точного ADD стал идемпотентным: если желаемая строка полностью совпадает ровно с одной неизменяемой строкой текущей TESSA, Studio привязывает её к точной server identity и показывает как «без изменений» вместо ложного duplicate-SKIP. Повторная запись и Store для такой строки не выполняются.\n- Граница безопасности не ослаблена: два новых одинаковых ADD без текущего совпадения по-прежнему конфликтуют; UPDATE/REPLACE, создающий дубль, по-прежнему пропускается; при нескольких одинаковых строках TESSA Studio не выбирает одну произвольно; строка, которая в том же плане изменяется или удаляется, не используется как идемпотентное совпадение.\n- Исправлена диагностика некорректных числовых диапазонов: значение вроде \`1 - 2 - 3\` больше не урезается до ложного хвоста \`2 - 3\`. Для Int/Decimal используется точная грамматика двух границ; ошибочный ввод отклоняется целиком и показывается пользователю в исходном виде.\n- Публичная сборка 1.11.10 остаётся composed-release: проверенный base userscript детерминированно дополняется transform-ом диапазонов и узким interval fallback; release-CI заново проверяет синтаксис, полный npm test, SHA-256, provenance attestation и публичный \`releases/latest/download\`.\n- Live-кейс #57 не объявляется исправленным: свежий support report 1.11.9 всё ещё содержит \`duplicate-interval-extractor\`. Серверный \`ValidateDuplicate\` не обходится, Store/Delete safety не ослаблялись.\n\n## 1.11.9 — 2026-09-07\n\n- Для единственного известного server-side отказа \`duplicate-interval-extractor / LeftOperandExtractor is null\` добавлен узкий production fallback: после отказа обычного CardNew создаётся отдельная карточка через \`CardNewMode.Valid\`, в неё заново собирается та же желаемая строка и выполняется тот же серверный \`ValidateDuplicate\`.\n- Fallback не является обходом проверки дублей: реальный duplicate, повторный extractor failure и любые посторонние серверные ошибки остаются fail-closed; до успешного второго \`ValidateDuplicate\` карточка не может попасть в Store.\n- Issue #57 оставлен открытым до live-подтверждения. Последующий live-прогон 1.11.9 показал, что на проблемной конфигурации extractor failure всё ещё воспроизводится, поэтому дальнейшая диагностика продолжается без отключения серверной проверки.\n\n`;
  source = '# Changelog\n\n' + entries + source.slice('# Changelog\n\n'.length);
  fs.writeFileSync(path, source);
}

function patchIssueTemplate() {
  replaceExactOnce('.github/ISSUE_TEMPLATE/bug_report.yml', 'placeholder: 1.11.8', `placeholder: ${VERSION}`, 'bug report version placeholder');
}

function patchLockfile() {
  const path = 'package-lock.json';
  const lock = JSON.parse(fs.readFileSync(path, 'utf8'));
  lock.version = VERSION;
  if (!lock.packages || !lock.packages['']) throw new Error('package-lock.json: root package entry missing');
  lock.packages[''].version = VERSION;
  fs.writeFileSync(path, JSON.stringify(lock, null, 2) + '\n');
}

patchReadme();
patchChangelog();
patchIssueTemplate();
patchLockfile();
console.log(`Patched public docs and lockfile for v${VERSION}.`);
