# Корпоративное развёртывание через Edge, GPO и Intune

## Пакет

Production userscript собирается командой `npm run build:production`. Корпоративная оболочка создаётся только из этого exact-файла:

```powershell
node tools/build-enterprise-package.mjs dist/tessa-matrix-studio.user.js enterprise-config.json dist/enterprise-unsigned
```

Минимальный config для пилота:

```json
{
  "origins": [
    "https://tessa-app01tl.cherkizovsky.net",
    "https://tessa-app01.cherkizovsky.net",
    "https://tessa.cherkizovsky.net"
  ]
}
```

Builder создаёт Manifest V3 с точными host patterns и без дополнительных permissions. Подпись CRX выполняет ИТ в защищённом контуре: закрытый ключ не хранится в репозитории или CI. Для управляемого обновления config должен содержать выданный Edge extension ID, корпоративные HTTPS `updateUrl` и `crxUrl`; тогда пакет также создаёт `update.xml` и заготовки policy.

Full UAT не встраивается в production-расширение. Для тестового контура соберите отдельный exact-кандидат командой `npm run build:uat`; кнопка **«Запустить полный UAT»** будет видна в разделе **«Проверки и поддержка»**. Публичный GitHub Release содержит только production userscript/meta/ZIP и контрольные суммы. UAT остаётся отдельным CI-артефактом и не устанавливается пользователям. В production служебные действия закрыты сворачиваемым разделом, а UAT runner, host и test exports отсутствуют.

## Рекомендуемая схема поставки

```text
Git tag + CI provenance
        |
        v
production userscript -> unsigned MV3 -> ИТ-подпись стабильным ключом
                                      |
                                      v
                         immutable HTTPS CRX + update.xml
                                      |
                   +------------------+------------------+
                   v                  v                  v
                 Pilot        Production limited      Production
```

1. CI собирает production из тега, проверяет SHA-256, CodeQL, dependency/secret scan и live-evidence gate.
2. ИТ подписывает CRX одним защищённым ключом. Смена PEM меняет extension ID и превращает обновление в отдельное расширение.
3. CRX публикуется по неизменяемому versioned URL. `update.xml` переключается последним, после загрузки CRX и проверки его SHA-256.
4. `ExtensionSettings` или `ExtensionInstallForcelist` указывает `extension_id;update_url`. Пользователь не может отключить force-installed расширение.
5. Кольца задаются группами Entra ID/AD/Intune. Бинарник между кольцами не пересобирается: продвигается тот же SHA-256.
6. Для userscript-пилота `@updateURL`/`@downloadURL` указывают только на production assets GitHub Release. UAT-файл не должен использовать production update URL.

Microsoft описывает self-hosted CRX, update manifest и требование сохранять исходный ключ в [Self-host Microsoft Edge extensions](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-manage-extensions-webstore). Для Intune предпочтителен [Settings catalog](https://learn.microsoft.com/en-us/intune/device-configuration/settings-catalog/configure-edge); не задавайте одну политику одновременно через Settings catalog и конфликтующий custom OMA-URI.

## Кольца

1. **Pilot** — тестовая группа, тестовый TESSA контур, Fast UAT и один Live smoke с восстановлением.
2. **Production limited** — небольшая бизнес-группа, мониторинг ошибок и времени операций не менее одного рабочего дня.
3. **Production** — обязательная установка через `ExtensionSettings` или `ExtensionInstallForcelist` после ACL gate и Certification UAT.

Продвижение между кольцами выполняется изменением назначения группы, а не заменой файла. Рекомендуемый минимум наблюдения: Pilot — один рабочий день и минимум один реальный Preview/Apply/reconcile; Production limited — один рабочий день и контроль ошибок, времени выгрузки, размера XLSX и reconciliation; Production — после отсутствия блокирующих инцидентов.

В Intune используйте Administrative Templates для Microsoft Edge или импортированный ADMX. В GPO задайте force-installed extension и корпоративный update URL. Запретите пользователю менять источник обновления. Перед раскаткой сверьте SHA-256 `studio.js`, CRX и published manifest с утверждённой заявкой.

Официальные ориентиры: [управление расширениями Edge](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-manage-extensions) и [политики установки расширений](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-manage-extensions-policies).

## Обновление и откат

- Версия задаётся только в `package.json`; production, manifest, ZIP и отчёты получают её из канонического builder.
- Публикация версии неизменяема: workflow не перезаписывает существующий release и создаёт attestation по `SHA256SUMS.txt`.
- Edge обычно не устанавливает более низкую версию поверх более высокой через обычный update manifest. Для быстрого автоматического отката выпустите новый номер версии с проверенным кодом rollback baseline под тем же extension ID и подпишите тем же ключом. Управляемое удаление/повторная установка старой версии допустимы только как отдельная операция ИТ. Точный userscript baseline 1.16.15 имеет SHA-256 `AF0F7D3E4B240A9F5BF35F736920AAB67C2D1A89D7BA6B67EAEBF2A9771AFECF`; исходная точка — tag `v1.16.15`, commit `ad9f86e`.
- После отката очистите кэш расширения/страницы, заново откройте карточку и выполните read-only smoke. Откат не должен повторно применять Excel-файл.

Подробный порядок отката и контрольные суммы: [ROLLBACK-v1.16.15.md](ROLLBACK-v1.16.15.md).
