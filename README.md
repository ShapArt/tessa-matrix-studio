<div align="center">

# TESSA Matrix Studio

**Excel-редактор матриц согласования TESSA**  
Выгрузка, массовые правки, проверка diff и безопасное применение изменений.

[![version](https://img.shields.io/badge/version-1.9.1-EF233C?style=flat-square)](https://github.com/ShapArt/tessa-matrix-studio/releases/latest)
[![Quality & Security](https://github.com/ShapArt/tessa-matrix-studio/actions/workflows/quality.yml/badge.svg)](https://github.com/ShapArt/tessa-matrix-studio/actions/workflows/quality.yml)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-userscript-24292F?style=flat-square&logo=tampermonkey)](https://www.tampermonkey.net/)

### [УСТАНОВИТЬ](https://cdn.jsdelivr.net/gh/ShapArt/tessa-matrix-studio@main/tessa-matrix-studio.user.js) · [СКАЧАТЬ РЕЛИЗ](https://github.com/ShapArt/tessa-matrix-studio/releases/latest) · [ОТКРЫТЬ КОД](https://github.com/ShapArt/tessa-matrix-studio/blob/main/tessa-matrix-studio.user.js) · [СООБЩИТЬ ОБ ОШИБКЕ](https://github.com/ShapArt/tessa-matrix-studio/issues/new/choose)

**Версия 1.9.1 · Автор: Шаповалов Артём**

</div>

> [!IMPORTANT]
> Скрипт **не выдаёт права в TESSA**. Для применения изменений нужны штатные права на корректировку соответствующей матрицы и режим, в котором TESSA разрешает редактирование.

---

## Что это

TESSA Matrix Studio добавляет к карточке матрицы отдельную панель для работы через Excel. Пользователь выгружает текущую матрицу, меняет значения в привычном `.xlsx`, проверяет список действий и только после этого записывает изменения обратно в TESSA.

<div align="center">
  <img src="docs/assets/studio-panel.webp" alt="TESSA Matrix Studio — основная панель" width="500">
</div>

### Рабочий сценарий

| 1 | 2 | 3 | 4 |
|---|---|---|---|
| **Скачать Excel** | **Изменить файл** | **Проверить изменения** | **Применить к TESSA** |
| Текущая матрица выгружается вместе со справочниками и служебными ID | Правятся только нужные значения | Скрипт показывает `изменить / добавить / удалить / без изменений / пропустить` | Записывается только проверенный план |

На шаге **«Проверить изменения» TESSA не изменяется**.

---

# Установка

Установка выполняется один раз: сначала Tampermonkey, затем TESSA Matrix Studio.

## Chrome / Edge

### 1. Установить Tampermonkey

- [Chrome Web Store — Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Microsoft Edge Add-ons — Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

После установки откройте **Управление расширением / Manage extension**.

<div align="center">
  <img src="https://www.tampermonkey.net/images/manage_extension.jpg" alt="Tampermonkey — Manage Extension" width="560">
</div>

Для Tampermonkey 5.3+ в Chrome-based браузерах необходимо разрешить выполнение userscripts. В Chrome 138+ включите **Allow User Scripts / Разрешить пользовательские скрипты**.

<div align="center">
  <img src="https://www.tampermonkey.net/images/userscripts_toggle.png" alt="Allow User Scripts" width="760">
</div>

Если такого переключателя нет, откройте `chrome://extensions` или `edge://extensions` и включите **Developer mode / Режим разработчика**.

<div align="center">
  <img src="https://www.tampermonkey.net/images/chrome_extensions.jpg" alt="Developer mode in Chrome extensions" width="760">
</div>

Официальная инструкция Tampermonkey: [Permission to execute userscripts](https://www.tampermonkey.net/faq.php?q=Q209).

## Firefox

1. Откройте [Firefox Add-ons — Tampermonkey](https://addons.mozilla.org/firefox/addon/tampermonkey/).
2. Нажмите **Add to Firefox / Добавить в Firefox**.
3. Подтвердите разрешения расширения.
4. Убедитесь, что Tampermonkey включён.

Дополнительный переключатель `Allow User Scripts`, который требуется Chrome-based браузерам, для обычной установки Firefox не нужен.

## 2. Установить TESSA Matrix Studio

Нажмите большую кнопку:

<div align="center">

### [УСТАНОВИТЬ TESSA MATRIX STUDIO](https://cdn.jsdelivr.net/gh/ShapArt/tessa-matrix-studio@main/tessa-matrix-studio.user.js)

</div>

Tampermonkey должен открыть экран установки userscript. Перед подтверждением проверьте:

- название: **TESSA Matrix Studio — Черкизово**;
- версия: **1.9.1**;
- автор: **Шаповалов Артём**;
- `@grant none`;
- адреса запуска — только домены TESSA Черкизово.

### Если кнопка установки не открывается

Корпоративная сеть может блокировать отдельные CDN/Raw-адреса. В этом случае:

1. Откройте [последний GitHub Release](https://github.com/ShapArt/tessa-matrix-studio/releases/latest).
2. Скачайте файл **`tessa-matrix-studio.user.js`** из Assets.
3. Откройте скачанный `.user.js` в браузере с установленным Tampermonkey.
4. Подтвердите установку.

Tampermonkey 5.5 поддерживает открытие локальных userscript-файлов в Chrome и Firefox. См. [changelog Tampermonkey](https://www.tampermonkey.net/changelog.php).

---

# Как работать

## 1. Скачать Excel

Откройте нужную матрицу TESSA и панель **TESSA Matrix Studio**.

- **Скачать Excel** — обычная ежедневная выгрузка.
- **Скачать со свежими справочниками** — используйте, если нужное значение недавно добавили или переименовали в TESSA.

В Excel сохраняются служебные идентификаторы строк. Они нужны скрипту для точного сопоставления и не должны редактироваться вручную.

## 2. Изменить Excel

Ниже — фрагмент **реальной выгрузки матрицы**, использовавшейся при тестировании скрипта.

<div align="center">
  <img src="docs/assets/excel-real.webp" alt="Реальная выгрузка матрицы в Excel" width="100%">
</div>

### Что можно делать со строками

| Действие в Excel | Что покажет Studio | Что произойдёт в TESSA |
|---|---|---|
| Изменить значения существующей строки | **ИЗМЕНИТЬ** | обновится та же строка |
| Скопировать строку в **новую свободную строку** | **ДОБАВИТЬ** | создастся новая строка |
| Вставить копию **поверх другой существующей строки** | **ЗАМЕНИТЬ** | сохранится ID целевой строки, её содержимое будет заменено |
| Удалить существующую строку Excel **целиком** | **УДАЛИТЬ** | строка будет удалена после проверки |
| Просто очистить видимые ячейки существующей строки | **ПРОПУСТИТЬ / предупреждение** | безопасное удаление не выполняется |

> [!CAUTION]
> Если вы не планировали удаление, а в preview появился `УДАЛИТЬ` — **не нажимайте «Применить к TESSA»**. Скачайте свежий Excel и повторите правку.

### Значения в ячейках

- Для логических полей используйте **Да / Нет**.
- Для нескольких значений вводите каждое с новой строки внутри одной ячейки: `Alt+Enter`.
- Для справочников начинайте печатать официальное название; при однозначном совпадении скрипт сопоставляет запись TESSA.
- Не меняйте скрытые технические ID вручную.

## 3. Проверить изменения

1. Нажмите **Выбрать Excel**.
2. Выберите сохранённый `.xlsx`.
3. Нажмите **Проверить изменения**.
4. Дождитесь завершения прогресса.

<div align="center">
  <img src="docs/assets/studio-preview.webp" alt="TESSA Matrix Studio — preview изменений" width="500">
</div>

Проверьте итоговые счётчики и каждую изменённую строку. В карточке показывается, какое действие будет выполнено и какие значения меняются.

| Счётчик | Значение |
|---|---|
| **изменить** | существующие строки с новыми значениями |
| **добавить** | новые строки |
| **удалить** | подтверждённые удаления |
| **без изменений** | строки, совпадающие с текущей TESSA |
| **пропустить** | строки, которые нельзя безопасно применить |

## 4. Применить

Нажимайте **Применить к TESSA** только после проверки preview.

Перед записью Studio повторно перечитывает матрицу и проверяет критические условия. Во время длительных операций отображается этап и прогресс. После завершения формируется JSON-отчёт о результате.

---

# Кнопки Studio

| Кнопка | Назначение |
|---|---|
| **Скачать Excel** | выгрузить текущую матрицу |
| **Скачать со свежими справочниками** | повторно прочитать справочники TESSA и сформировать новую выгрузку |
| **Выбрать Excel** | выбрать отредактированный файл |
| **Актуализировать выбранный Excel** | перенести правки в актуальную структуру, если в TESSA появились новые поля |
| **Проверить изменения** | построить diff без записи |
| **Применить к TESSA** | выполнить проверенный план |
| **Отмена** | остановить операцию, если текущий этап допускает отмену |

---

# Права и безопасность

TESSA Matrix Studio работает в контексте открытой страницы TESSA и текущего пользователя.

- `@grant none` — скрипт не использует привилегированные API Tampermonkey;
- пароль и учётные данные пользователя не сохраняются;
- Excel обрабатывается локально в браузере;
- скрипт не повышает права и не обходит проверки TESSA;
- перед записью выполняется повторная проверка матрицы;
- неоднозначные значения, конфликт версий и небезопасные операции не применяются молча.

Поддерживаемые адреса:

```text
https://tessa.cherkizovsky.net/*
https://tessa-app01.cherkizovsky.net/*
https://tessa-app01tl.cherkizovsky.net/*
https://tessa-app*.cherkizovsky.net/*
```

---

# Если что-то не работает

<details>
<summary><b>Скрипт установлен, но кнопки Studio нет</b></summary>

1. Проверьте, что Tampermonkey включён.
2. В Chrome/Edge проверьте **Allow User Scripts** или **Developer mode**.
3. Откройте один из поддерживаемых доменов TESSA.
4. Обновите страницу `Ctrl+R`.
5. Откройте Tampermonkey и убедитесь, что **TESSA Matrix Studio** включён для текущей страницы.

</details>

<details>
<summary><b>ERR_INVALID_RESPONSE при установке</b></summary>

Ссылка на `raw.githubusercontent.com` может блокироваться корпоративной сетью. Основная кнопка этого README использует **jsDelivr**, а не GitHub Raw. Если CDN также недоступен, скачайте `.user.js` из [GitHub Releases](https://github.com/ShapArt/tessa-matrix-studio/releases/latest) и откройте файл локально.

</details>

<details>
<summary><b>Неожиданно появилось «УДАЛИТЬ»</b></summary>

Не применяйте изменения. Скачайте свежую выгрузку и повторите правку. Preview существует именно для того, чтобы такие операции были видны до записи.

</details>

<details>
<summary><b>Кнопка «Применить к TESSA» недоступна</b></summary>

Проверьте состояние матрицы и права. Скрипт не может и не должен обходить штатные ограничения TESSA. Для записи нужны права на корректировку матрицы.

</details>

---

# Для разработчиков

Репозиторий специально оставлен небольшим: production userscript находится в корне, пользовательская инструкция — в этом README, тесты — в `tests/`.

```bash
npm test
```

Команда выполняет:

1. проверку синтаксиса `node --check`;
2. smoke-test metadata и базовых преобразований;
3. regression-тест planner, включая сценарии `ADD / UPDATE / REPLACE / DELETE`.

GitHub Actions запускает эти проверки для push и pull request. CodeQL выполняет отдельный анализ JavaScript в том же workflow.

### Структура

```text
tessa-matrix-studio/
├── tessa-matrix-studio.user.js   # production userscript
├── README.md                      # вся пользовательская инструкция
├── CHANGELOG.md
├── SECURITY.md
├── package.json
├── tests/
├── docs/assets/                   # реальные скриншоты
└── .github/                       # CI и шаблон ошибки
```

---

## История версий

См. [CHANGELOG.md](CHANGELOG.md) и [GitHub Releases](https://github.com/ShapArt/tessa-matrix-studio/releases).

## Автор

**Шаповалов Артём**  
GitHub: [@ShapArt](https://github.com/ShapArt)
