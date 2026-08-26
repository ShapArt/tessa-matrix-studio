# Установка TESSA Matrix Studio

Установка выполняется один раз: сначала устанавливается Tampermonkey, затем сам TESSA Matrix Studio.

## 1. Установить Tampermonkey

Используйте официальные источники:

- Chrome Web Store: https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo
- Firefox Add-ons: https://addons.mozilla.org/firefox/addon/tampermonkey/
- Официальный сайт Tampermonkey: https://www.tampermonkey.net/

### Google Chrome

1. Откройте Tampermonkey в Chrome Web Store.
2. Нажмите **«Добавить в Chrome»**.
3. Просмотрите разрешения и подтвердите установку.
4. Закрепите Tampermonkey рядом с адресной строкой.

Для современных Chrome Tampermonkey 5.3+ требует отдельное разрешение на выполнение userscripts. Официальная инструкция Tampermonkey предлагает включить **Allow User Scripts**; если переключателя нет — использовать Developer Mode.

Открыть настройки расширения:

<p align="center"><img src="https://www.tampermonkey.net/images/manage_extension.jpg" width="460" alt="Официальный скриншот Tampermonkey: Manage extension"></p>

Включить **Allow User Scripts**:

<p align="center"><img src="https://www.tampermonkey.net/images/userscripts_toggle.png" width="700" alt="Официальный скриншот Tampermonkey: Allow User Scripts"></p>

Если переключателя нет, открыть `chrome://extensions` и включить Developer Mode:

<p align="center"><img src="https://www.tampermonkey.net/images/chrome_extensions.jpg" width="760" alt="Официальный скриншот Tampermonkey: Chrome extensions"></p>

Официальная справка: https://www.tampermonkey.net/faq.php?q=Q209

### Mozilla Firefox

1. Откройте страницу Tampermonkey в Firefox Add-ons.
2. Нажмите **«Добавить в Firefox»**.
3. Просмотрите список разрешений и подтвердите установку.
4. При желании закрепите значок Tampermonkey на панели.

Firefox показывает разрешения самого Tampermonkey на странице дополнения. TESSA Matrix Studio отдельно не запрашивает Tampermonkey API — в userscript используется `@grant none`.

Официальный скриншот встроенного редактора Tampermonkey со страницы Mozilla Add-ons:

<p align="center"><img src="https://addons.mozilla.org/user-media/previews/thumbs/170/170870.jpg?modified=1622132485" width="560" alt="Официальный скриншот Tampermonkey в Firefox"></p>

Страница дополнения: https://addons.mozilla.org/firefox/addon/tampermonkey/

Справка Mozilla: https://support.mozilla.org/kb/find-and-install-add-ons-add-features-to-firefox

### Microsoft Edge

1. Установите Tampermonkey из магазина Edge либо из Chrome Web Store.
2. Если Edge спрашивает разрешение на расширения из других магазинов — подтвердите его.
3. Проверьте, что Tampermonkey включён.
4. Для Chromium-версии действуют те же требования к userscripts, что и в Chrome.

Официальный пример Tampermonkey для Edge:

<p align="center"><img src="https://www.tampermonkey.net/images/edge_dev_mode.jpg" width="760" alt="Официальный скриншот Tampermonkey: Developer Mode в Edge"></p>

Справка Microsoft: https://support.microsoft.com/edge/add-turn-off-or-remove-extensions-in-microsoft-edge

### Opera

Tampermonkey поддерживает Opera. Установите официальную версию, убедитесь, что расширение включено и имеет доступ к странице TESSA. Для Chromium-сборок логика разрешения userscripts аналогична Chrome.

Официальный список версий: https://www.tampermonkey.net/faq.php?q=Q406

### Safari

Tampermonkey доступен для Safari через App Store. Основной рабочий сценарий TESSA Matrix Studio рассчитан на desktop TESSA; перед использованием Safari сначала проверьте скрипт на черновой матрице и убедитесь, что Safari разрешил расширению доступ к домену TESSA.

Официальный список версий: https://www.tampermonkey.net/faq.php?q=Q406

### Brave и другие Chromium-браузеры

Используйте Chromium-версию Tampermonkey. После установки:

- расширение должно быть включено;
- выполнение userscripts должно быть разрешено;
- Tampermonkey должен иметь доступ к странице TESSA.

Если браузер управляется организацией и установка расширений запрещена политикой, обойти это ограничение скриптом нельзя — потребуется разрешение администратора.

## 2. Какие разрешения нужны

| Настройка | Значение |
|---|---|
| Tampermonkey | Включён |
| Allow User Scripts / User Scripts | Включено, если браузер показывает настройку |
| Доступ к сайту | Разрешён для доменов TESSA |
| Доступ к `file://` | Не нужен |
| Инкогнито / приватный режим | Не нужен |

TESSA Matrix Studio работает с `@grant none`. Это значит, что userscript не получает отдельные GM_* API. Он выполняется на открытой странице TESSA и использует права текущего пользователя TESSA.

## 3. Установить TESSA Matrix Studio

Нажмите:

[**Установить TESSA Matrix Studio**](https://raw.githubusercontent.com/ShapArt/tessa-matrix-studio/main/tessa-matrix-studio.user.js)

Tampermonkey откроет страницу установки userscript.

Перед подтверждением проверьте:

- название: **TESSA Matrix Studio — Черкизово**;
- автор: **Шаповалов Артём**;
- версия: **1.9.1**;
- `@grant none`;
- адреса запуска относятся только к TESSA Группы Черкизово.

Нажмите **Install / Установить**.

## 4. Проверить установку

1. Откройте TESSA.
2. Перейдите в карточку матрицы.
3. Обновите страницу (`Ctrl+R`).
4. Справа внизу должна появиться круглая красная кнопка Studio.
5. Нажмите её — откроется панель.

Реальная кнопка запуска:

<p align="center"><img src="assets/studio-launcher.webp" width="360" alt="Кнопка запуска TESSA Matrix Studio"></p>

Реальная панель v1.9.1:

<p align="center"><img src="assets/studio-panel.webp" width="500" alt="Панель TESSA Matrix Studio"></p>

Если кнопки нет, см. [TROUBLESHOOTING.md](TROUBLESHOOTING.md#скрипт-установлен-но-кнопки-в-tessa-нет).

## 5. Права в TESSA

Установка userscript **не выдаёт прав на изменение матрицы**.

Для выгрузки нужен доступ к карточке. Для применения изменений нужны штатные права на корректировку конкретной матрицы и состояние карточки, в котором TESSA разрешает редактирование.

Если TESSA не разрешает изменение матрицы текущему пользователю, Studio не должен и не будет обходить это ограничение.
