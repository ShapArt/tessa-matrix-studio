<div align="center">

# TESSA Matrix Studio

**Excel-редактор матриц согласования TESSA для Черкизово**

Выгрузка матрицы в Excel → массовая правка → проверка изменений → безопасное применение в TESSA.

[![Version](https://img.shields.io/badge/version-1.9.2-EF233C?style=flat-square)](https://github.com/ShapArt/tessa-matrix-studio/releases/latest)
[![Quality & Security](https://github.com/ShapArt/tessa-matrix-studio/actions/workflows/quality.yml/badge.svg)](https://github.com/ShapArt/tessa-matrix-studio/actions/workflows/quality.yml)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-userscript-24292F?style=flat-square&logo=tampermonkey)](https://www.tampermonkey.net/)

### [УСТАНОВИТЬ](https://cdn.jsdelivr.net/gh/ShapArt/tessa-matrix-studio@main/tessa-matrix-studio.user.js) · [СКАЧАТЬ РЕЛИЗ](https://github.com/ShapArt/tessa-matrix-studio/releases/latest) · [ОТКРЫТЬ КОД](https://github.com/ShapArt/tessa-matrix-studio/blob/main/tessa-matrix-studio.user.js) · [СООБЩИТЬ ОБ ОШИБКЕ](https://github.com/ShapArt/tessa-matrix-studio/issues/new/choose)

**v1.9.2 · Автор: Шаповалов Артём**

</div>

> [!IMPORTANT]
> TESSA Matrix Studio **не выдаёт и не повышает права**. Для применения изменений у пользователя должны быть штатные права TESSA на корректировку соответствующей матрицы, а сама матрица должна находиться в состоянии, допускающем редактирование.

---

## Что делает скрипт

TESSA Matrix Studio добавляет в карточку матрицы отдельную панель. Работа остаётся под контролем пользователя: сначала матрица выгружается в `.xlsx`, затем Studio строит понятный diff и только после подтверждения записывает изменения в TESSA.

<div align="center">
  <img src="docs/assets/studio-panel.webp" alt="Реальная панель TESSA Matrix Studio" width="520">
  <br><sub>Реальный интерфейс TESSA Matrix Studio v1.9.2</sub>
</div>

### Четыре шага

| 1 | 2 | 3 | 4 |
|---|---|---|---|
| **Скачать Excel** | **Изменить файл** | **Проверить изменения** | **Применить к TESSA** |
| Получить текущую матрицу | Внести нужные правки | Увидеть точный план действий | Записать только проверенный план |

На этапе **«Проверить изменения» ничего в TESSA не изменяется**.

---

# Установка

Нужно один раз установить Tampermonkey, а затем сам TESSA Matrix Studio.

## Chrome / Edge

### 1. Установите Tampermonkey

- [Chrome Web Store — Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Microsoft Edge Add-ons — Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

После установки откройте страницу управления расширением Tampermonkey.

<div align="center">
  <img src="https://www.tampermonkey.net/images/manage_extension.jpg" alt="Официальный экран управления расширением Tampermonkey" width="560">
</div>

Для современных версий Chrome-based браузеров разрешите выполнение пользовательских скриптов. Если доступен переключатель **Allow User Scripts / Разрешить пользовательские скрипты** — включите его.

<div align="center">
  <img src="https://www.tampermonkey.net/images/userscripts_toggle.png" alt="Официальный экран Allow User Scripts" width="760">
</div>

Если такого переключателя нет, откройте `chrome://extensions` или `edge://extensions` и включите **Developer mode / Режим разработчика**.

<div align="center">
  <img src="https://www.tampermonkey.net/images/chrome_extensions.jpg" alt="Официальный экран Chrome Extensions" width="760">
</div>

Официальная справка: [Tampermonkey — Permission to execute userscripts](https://www.tampermonkey.net/faq.php?q=Q209).

## Firefox

1. Откройте [Tampermonkey в Firefox Add-ons](https://addons.mozilla.org/firefox/addon/tampermonkey/).
2. Нажмите **Добавить в Firefox**.
3. Подтвердите разрешения расширения.
4. Проверьте, что расширение включено.

Отдельный переключатель `Allow User Scripts`, используемый в Chromium, для обычной установки Firefox не требуется.

## 2. Установите TESSA Matrix Studio

<div align="center">

### [УСТАНОВИТЬ TESSA MATRIX STUDIO](https://cdn.jsdelivr.net/gh/ShapArt/tessa-matrix-studio@main/tessa-matrix-studio.user.js)

</div>

Tampermonkey откроет карточку установки. Перед подтверждением можно проверить:

- **Название:** `TESSA Matrix Studio — Черкизово`
- **Версия:** `1.9.2`
- **Автор:** `Шаповалов Артём`
- **Разрешения:** `@grant none`
- **Область запуска:** только домены TESSA Черкизово

### Если кнопка «Установить» не открывается

Корпоративная сеть может блокировать отдельные CDN или Raw-адреса. Тогда используйте запасной вариант:

1. Откройте [последний GitHub Release](https://github.com/ShapArt/tessa-matrix-studio/releases/latest).
2. В блоке **Assets** скачайте `tessa-matrix-studio.user.js`.
3. Откройте файл в браузере с установленным Tampermonkey.
4. Подтвердите установку.

---

# Как работать

## 1. Скачать Excel

Откройте нужную матрицу TESSA и панель **TESSA Matrix Studio**.

- **Скачать Excel** — обычная рабочая выгрузка матрицы.
- **Скачать со свежими справочниками** — новая выгрузка с принудительным перечитыванием справочников TESSA; полезно, если недавно добавили или переименовали значение.

В Excel сохраняются скрытые служебные идентификаторы строк. Они нужны для точного сопоставления и **не должны редактироваться вручную**.

## 2. Изменить Excel

Ниже — фрагмент реальной Excel-выгрузки, использовавшейся при тестировании Studio.

<div align="center">
  <img src="docs/assets/excel-real.webp" alt="Реальная Excel-выгрузка TESSA Matrix Studio" width="100%">
  <br><sub>Реальная выгрузка Studio, без нарисованных макетов</sub>
</div>

### Как Studio понимает действия со строками

| Что вы сделали в Excel | Что покажет Studio | Что произойдёт в TESSA |
|---|---|---|
| Изменили значения существующей строки | **ИЗМЕНИТЬ** | обновится эта же строка |
| Скопировали строку в новую свободную строку | **ДОБАВИТЬ** | создастся новая строка |
| Вставили копию поверх другой существующей строки | **ЗАМЕНИТЬ** | сохранится ID целевой строки, её содержимое заменится |
| Удалили существующую строку Excel целиком | **УДАЛИТЬ** | после проверки строка будет удалена |
| Очистили видимые ячейки, не удалив строку | **ПРОПУСТИТЬ / предупреждение** | небезопасное удаление не выполняется |

> [!CAUTION]
> Если вы **не планировали удаление**, но в проверке появилось `УДАЛИТЬ`, не применяйте изменения. Скачайте свежий Excel и повторите правку.

### Значения в ячейках

- Для логических полей используйте **Да / Нет**.
- Если поле допускает несколько значений — каждое значение вводится с новой строки внутри одной ячейки (`Alt+Enter`).
- Для справочников используйте официальное название значения TESSA.
- Не редактируйте скрытые ID и технические столбцы вручную.
- Не вставляйте строку «со сдвигом», если не понимаете, какую существующую строку она заменяет; перед применением всегда смотрите diff.

## 3. Проверить изменения

1. Нажмите **Выбрать Excel**.
2. Выберите сохранённый `.xlsx`.
3. Нажмите **Проверить изменения**.
4. Дождитесь завершения прогресса.
5. Проверьте итоговые счётчики и каждую затронутую строку.

Studio показывает:

| Счётчик | Что означает |
|---|---|
| **изменить** | существующая строка получает новые значения |
| **добавить** | будет создана новая строка |
| **удалить** | существующая строка будет удалена |
| **без изменений** | Excel совпадает с текущей TESSA |
| **пропустить** | строку нельзя применить безопасно |

## 4. Применить к TESSA

Нажимайте **Применить к TESSA** только после проверки списка действий.

Перед записью Studio повторно перечитывает актуальное состояние матрицы и выполняет preflight-проверки. Долгие операции показывают этап и прогресс. По завершении можно сохранить JSON-отчёт с результатом применения.

---

# Что делает каждая кнопка

| Кнопка | Когда использовать |
|---|---|
| **Скачать Excel** | получить текущую матрицу для редактирования |
| **Скачать со свежими справочниками** | если справочники TESSA недавно менялись |
| **Выбрать Excel** | загрузить отредактированный `.xlsx` |
| **Актуализировать выбранный Excel** | перенести ваши правки в актуальную Excel-структуру, если в TESSA появились новые поля |
| **Проверить изменения** | построить diff без записи в TESSA |
| **Применить к TESSA** | выполнить проверенный план изменений |
| **Отмена** | остановить операцию, если текущий этап допускает отмену |

---

# Права и безопасность

TESSA Matrix Studio работает в контексте уже открытой страницы TESSA и текущей пользовательской сессии.

- скрипт не повышает права и не обходит штатные ограничения TESSA;
- для записи нужны права на корректировку конкретной матрицы;
- `@grant none` — привилегированные API Tampermonkey не используются;
- пароль и учётные данные пользователя не сохраняются;
- Excel обрабатывается локально в браузере;
- перед записью выполняется повторная проверка состояния матрицы;
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
<summary><b>Скрипт установлен, но панель Studio не появилась</b></summary>

1. Проверьте, что Tampermonkey включён.
2. В Chrome/Edge проверьте **Allow User Scripts** или **Developer mode**.
3. Убедитесь, что открыт поддерживаемый адрес TESSA.
4. Обновите страницу (`Ctrl+R`).
5. В меню Tampermonkey убедитесь, что **TESSA Matrix Studio** включён для этой страницы.

</details>

<details>
<summary><b>ERR_INVALID_RESPONSE при установке</b></summary>

Основная кнопка README использует jsDelivr, а не GitHub Raw. Если корпоративная сеть блокирует и этот адрес, скачайте `.user.js` из **GitHub Releases** и откройте файл локально.

</details>

<details>
<summary><b>Неожиданно появилось «УДАЛИТЬ»</b></summary>

Не применяйте план. Скачайте свежую выгрузку и повторите правку. Смысл preview — показать опасное действие **до** записи.

</details>

<details>
<summary><b>«Применить к TESSA» недоступно или TESSA отклоняет сохранение</b></summary>

Проверьте состояние матрицы и ваши права на её корректировку. Studio не обходит штатную модель доступа TESSA.

</details>

<details>
<summary><b>В справочнике нет нужного значения</b></summary>

Скачайте Excel кнопкой **«Скачать со свежими справочниками»**. Если значения нет и после этого, сначала проверьте его наличие в самой TESSA.

</details>

---

# Для сопровождения

Production-файл находится прямо в корне репозитория:

```text
tessa-matrix-studio.user.js
```

Проверки проекта:

```bash
npm test
```

Они включают синтаксическую проверку userscript, smoke-тесты и regression-тесты planner. Pull Request в `main` дополнительно проходит GitHub Actions и CodeQL.

Ключевые части userscript разделены комментариями по ответственности: XLSX, справочники, TESSA bridge, planner, safety/apply и UI. При изменении логики сопоставления строк сначала добавляйте regression-case в `tests/planner.mjs`.

---

## Версия и поддержка

Текущая версия: **1.9.2**  
Автор: **Шаповалов Артём**

- [История изменений](CHANGELOG.md)
- [Политика безопасности](SECURITY.md)
- [Сообщить об ошибке](https://github.com/ShapArt/tessa-matrix-studio/issues/new/choose)
- [Скачать последний релиз](https://github.com/ShapArt/tessa-matrix-studio/releases/latest)
