# TechCoop.AI 0.1.0

Публичная статическая витрина технологической кооперации для GitHub Pages.

## Онлайн-страницы

- `index.html` — релизный executive dashboard.
- `app/techcoop_map_v7.html` — карта кооперации 2.0.
- `app/techcoop_passport_v7.html` — паспорт компании.
- `app/techcoop_ui_v7.html` — единая v7-витрина с картой и паспортом.

## Данные релиза

- 2 223 861 базовых профилей компаний в поиске и паспорте.
- 558 373 компании с рассчитанными ролями.
- 1 896 871 role rows.
- 8 670 enterprise-профилей с resolved-названиями.
- Evidence detail layer: ГИСП, реестр ПО, патенты/РИД, вакансии, закупки.

Если название компании не найдено в текущем публичном identity-слое, интерфейс показывает `Профиль расчётной базы` и реквизиты ИНН/ОГРН. Названия не фабрикуются.

## GitHub Pages

Релиз работает как статический сайт: HTML, CSS, JS, изображения и JSON shards. Серверный API, DuckDB и raw-выгрузки не требуются и не публикуются.

В published tree ветки `main` входят только файлы, необходимые для отображения:

- `index.html`, `favicon.ico`, `VERSION`, `.nojekyll`;
- `app/techcoop_map_v7.html`, `app/techcoop_passport_v7.html`, `app/techcoop_ui_v7.html`;
- минимальные `assets/`, включая локальный Leaflet;
- `data/techcoop_ui_v7_payload.js`;
- `data/v7_static/**`.

GitHub Pages настроен на публикацию из ветки `main`, каталог `/`. Этот режим выбран для релиза 0.1.0 после успешной проверки локального release kit: полный статический слой близок к лимиту GitHub Pages в 1 GB, поэтому он публикуется напрямую из allowlist-репозитория без промежуточного Actions-артефакта.

Не публикуются `.venv`, `preview`, `logs`, `src`, `tests`, raw archives/parquet/DuckDB, screenshots и audit zip.
