import fs from 'node:fs';

const paths = {
  pkg: new URL('../package.json', import.meta.url),
  lock: new URL('../package-lock.json', import.meta.url),
  source: new URL('../tessa-matrix-studio.user.js', import.meta.url),
  readme: new URL('../README.md', import.meta.url),
  changelog: new URL('../CHANGELOG.md', import.meta.url),
  message: new URL('../docs/communications/v1.14-colleague-test-message.md', import.meta.url),
};

const pkg = JSON.parse(fs.readFileSync(paths.pkg, 'utf8'));
pkg.version = '1.14.0';
if (!pkg.scripts.test.includes('tests/v1.14-rc-contract.mjs')) {
  pkg.scripts.test += ' && node tests/v1.14-rc-contract.mjs';
}
fs.writeFileSync(paths.pkg, JSON.stringify(pkg, null, 2) + '\n');

const lock = JSON.parse(fs.readFileSync(paths.lock, 'utf8'));
lock.version = '1.14.0';
if (lock.packages?.['']) lock.packages[''].version = '1.14.0';
fs.writeFileSync(paths.lock, JSON.stringify(lock, null, 2) + '\n');

let source = fs.readFileSync(paths.source, 'utf8');
source = source.replace(/^\/\/ @version\s+1\.13\.0$/m, '// @version      1.14.0');
source = source.replace("    version: '1.13.0',", "    version: '1.14.0',");
if (!/^\/\/ @version\s+1\.14\.0$/m.test(source) || !source.includes("version: '1.14.0'")) {
  throw new Error('Could not bump userscript/runtime version to 1.14.0');
}
fs.writeFileSync(paths.source, source);

let changelog = fs.readFileSync(paths.changelog, 'utf8');
if (!changelog.includes('## 1.14.0 — 2026-09-11')) {
  const section = `## 1.14.0 — 2026-09-11\n\n- Добавлены tab-local session cache и performance telemetry. Кэш живёт только в текущей вкладке, привязан к MatrixID + TemplateID и инвалидируется при смене контекста; при сомнительной свежести Studio возвращается к полному безопасному пути.\n- Planner получил fingerprint fast path для неизменённых строк: KEEP больше не проходит тяжёлое разрешение всех справочников. Серверные preflight и reconciliation используют touched-only identities там, где runtime позволяет это доказать безопасно; stale/ambiguous state по-прежнему приводит к full fallback или блокировке, а не к догадке.\n- Для персональных ролей Excel и picker показывают **ФИО — должность**. RoleID/RoleTypeID остаются первичной identity; старое голое ФИО поддерживается только при однозначном совпадении, одноимённые сотрудники без уточнения блокируются fail-closed.\n- После Preview добавлена кнопка **«Скачать изменения в Excel»**: отдельная report-only книга содержит только ADD/UPDATE/DELETE/SKIP, без KEEP, и лист с деталями «было → стало». Такой отчёт нельзя случайно загрузить обратно как Apply-файл.\n- В диагностику добавлен **Performance UAT**: 10 synthetic read-only сценариев от 0 изменений до 3000 KEEP + 1 ADD/UPDATE, со временем planner-а, fully validated/preflight rows, baseline fast-path и cache hit/miss. В ZIP сохраняются полный и компактный performance-отчёты.\n- Контрольный GitHub Actions прогон на Node.js 24: synthetic Performance UAT — **6.36 с** standalone и **6.11 с** внутри полного regression suite; incremental-large 3000 строк — **365.4 мс** без изменений и **306.8 мс** для 3000 KEEP + 1 ADD. Это synthetic CI-измерения локального planner-а, а не подтверждённая задержка live TESSA.\n- Safety-инварианты не ослаблены: copied-row lifecycle, stale/version guards, cross-matrix atomicity, unsaved-editor guard, серверный ValidateDuplicate и verified read-back остаются обязательными. Версия 1.14.0 остаётся release candidate до live TESSA UAT; production 1.13.0 не заменяется автоматически.\n\n`;
  changelog = changelog.replace('# История изменений\n\n', '# История изменений\n\n' + section);
}
fs.writeFileSync(paths.changelog, changelog);

let readme = fs.readFileSync(paths.readme, 'utf8');
readme = readme.replace(/version-1\.13\.0/g, 'version-1.14.0');
readme = readme.replace(/\*\*v1\.13\.0/g, '**v1.14.0');
readme = readme.replace(/версии \*\*1\.13\.0\*\*/g, 'версии **1.14.0**');
const readmeMarker = 'После обычного Apply Studio автоматически перечитывает матрицу и сверяет сохранённые строки и значения. Неподтверждённая запись не считается полностью успешной.\n';
const readmeNote = `\nВ **1.14.0** неизменённые строки проходят быстрый fingerprint-path, а серверная перепроверка по возможности ограничивается реально затронутыми строками с безопасным fallback. Для сотрудников Excel показывает **ФИО — должность**. После Preview можно нажать **«Скачать изменения в Excel»** и получить отдельный отчёт только по ADD/UPDATE/DELETE/SKIP; он помечен как report-only и не принимается обратно для Apply. В диагностический ZIP добавлен read-only Performance UAT. Числа из CI являются synthetic-замерами локального planner-а и не заменяют live-проверку TESSA.\n`;
if (!readme.includes('В **1.14.0** неизменённые строки')) {
  if (!readme.includes(readmeMarker)) throw new Error('README insertion anchor missing');
  readme = readme.replace(readmeMarker, readmeMarker + readmeNote);
}
fs.writeFileSync(paths.readme, readme);

fs.mkdirSync(new URL('../docs/communications/', import.meta.url), { recursive: true });
const message = `# Сообщение коллегам — тестирование TESSA Matrix Studio 1.14.0\n\nКоллеги, всем привет!\n\nПодготовил **TESSA Matrix Studio 1.14.0** для тестовой проверки. Это пока **release candidate**, не production-релиз: сначала хочу прогнать его вместе с вами на реальной тестовой TESSA и убедиться, что ускорение не повлияло на безопасность Apply.\n\nЧто изменилось:\n- неизменённые строки теперь не проходят повторно всю тяжёлую обработку справочников;\n- preflight и проверка результата по возможности читают только реально затронутые строки, но при любой неопределённости Studio автоматически возвращается к полному безопасному пути;\n- в Excel у сотрудников отображается **ФИО — должность**, при этом RoleID остаётся основной identity;\n- после Preview появилась кнопка **«Скачать изменения в Excel»** — она выгружает отдельный отчёт только по ADD / UPDATE / DELETE / SKIP и деталям «было → стало»;\n- в пакет диагностики добавлен Performance UAT и метрики текущей сессии.\n\nНа CI локальный synthetic Performance UAT из 10 сценариев проходит примерно за **6.1–6.4 секунды**; отдельный synthetic кейс на 3000 строк планируется примерно за **0.3–0.4 секунды**. Это только замер локального planner-а на GitHub runner: **ускорение ещё не подтверждено на live TESSA**, поэтому именно реальную скорость сейчас и проверяем.\n\nНа тесте прошу пройти следующие случаи:\n1. **0 изменений** — скачать Excel и сразу сделать Preview: должно быть только KEEP/«без изменений», Apply не должен предлагать запись.\n2. **1 ADD**, затем **10 ADD** — Preview, Apply, «Проверить результат».\n3. **1 UPDATE**, затем **10 UPDATE** — в том числе изменение исполнителя/подписанта.\n4. **1 DELETE** — очистка строки или физическое удаление строки из Excel.\n5. **Смешанный кейс** — одновременно ADD + UPDATE + DELETE; Preview должен правильно разделить операции.\n6. **Большая матрица ~3000 строк** — 3000 KEEP + 1 ADD и отдельно 3000 KEEP + 1 UPDATE. Здесь особенно важны фактическое время Preview / Apply / проверки результата и отсутствие подвисаний.\n7. **Повторный Preview в той же вкладке** — проверить, что повторная работа действительно быстрее и не тащит старое состояние после смены карточки.\n8. **ФИО — должность** — проверить отображение сотрудников; если есть однофамильцы/одинаковые ФИО, голое неоднозначное ФИО должно блокироваться, а не выбираться случайно.\n9. **Скачать изменения в Excel** — после Preview открыть отчёт, проверить ADD/UPDATE/DELETE/SKIP и лист деталей. Попытка загрузить этот report-only файл обратно должна корректно отклоняться.\n10. После Apply обязательно нажать **«Проверить результат»**: успешный transport-ответ без read-back не считаем полностью подтверждённым результатом.\n\nЕсли что-то долго грузится, результат отличается от Preview или появляется ошибка, ничего повторно применять вслепую не нужно. Откройте **«Дополнительно → Проверки и диагностика → Скачать пакет диагностики»** и пришлите ZIP вместе с коротким описанием: какая матрица, сколько примерно строк, что меняли и на каком шаге возникла проблема. В пакете теперь есть performance-метрики, поэтому сможем отделить локальную обработку от ожидания TESSA.\n\nЕсли все сценарии проходят нормально, после этого уже можно будет принимать решение о публикации 1.14.0.\n`;
fs.writeFileSync(paths.message, message);

console.log('Task 7 v1.14 RC patch applied.');
