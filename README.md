# Force RussianProofing4PPTX

Веб-модуль для исправления языка проверки правописания в PowerPoint-презентациях на уровне OOXML-пакета.

Пользователь загружает `.pptx` или `.pptm` через React-интерфейс. Сервер обрабатывает XML-части презентации, формирует исправленный файл и отдаёт его на скачивание. Microsoft PowerPoint на сервере не требуется.

## Что именно исправляется

Для DrawingML-текста внутри `ppt/*.xml` модуль:

- устанавливает `lang="ru-RU"`;
- приводит существующий `altLang` к `ru-RU`;
- удаляет сохранённый флаг ошибки `err`;
- удаляет `noProof`, чтобы проверка правописания не была отключена;
- устанавливает `dirty="1"`, чтобы PowerPoint заново выполнил proofing после открытия;
- добавляет отсутствующий `a:rPr` в текстовые `a:r` / `a:fld`, чтобы язык не оставался только унаследованным от шаблона или старой локали.

Обрабатываются все XML-части внутри каталога `ppt/`, включая слайды, макеты, образцы, заметки, диаграммы и DrawingML/SmartArt-части, если они содержат редактируемый DrawingML-текст.

## Архитектура

- **Frontend:** React 19 + TypeScript + Vite.
- **Backend:** FastAPI.
- **Processor:** Python standard library (`zipfile`, XML validation, byte-level OOXML patching).
- **Deployment:** один Docker-контейнер; React собирается на build-stage и отдаётся FastAPI как static frontend.
- **Progress:** после загрузки создаётся серверная job; React опрашивает `/api/jobs/{id}` и показывает реальный прогресс по XML/ZIP-частям.

## Запуск через Docker

```bash
docker compose up --build
```

Открыть:

```text
http://localhost:8000
```

## Production deployment

Production-стек с Nginx, HTTPS, ограничениями загрузки и hardening находится в `docker-compose.prod.yml`. Пошаговая инструкция: [docs/PRODUCTION.md](docs/PRODUCTION.md).

Для встраивания React-модуля в сторонний сервис используйте [docs/THIRD_PARTY_INTEGRATION.md](docs/THIRD_PARTY_INTEGRATION.md). Предпочтительная схема — same-origin reverse proxy через уже аутентифицированный внешний сервис.

## Локальная разработка

### Backend

```bash
cd server
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
# source .venv/bin/activate

pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

Во втором терминале:

```bash
cd client
npm install
npm run dev
```

Vite работает на `http://localhost:5173` и проксирует `/api` на FastAPI `:8000`.

## API

### `POST /api/jobs`

`multipart/form-data`, поле `file`.

Поддерживаются `.pptx` и `.pptm`.

Ответ `202` содержит `id` задачи, состояние и имя выходного файла.

### `GET /api/jobs/{job_id}`

Возвращает:

- `state`: `queued | processing | ready | error`;
- `progress`: 0–100;
- `current_part`;
- статистику изменений;
- признак `download_ready`.

### `GET /api/jobs/{job_id}/download`

Отдаёт исправленную презентацию. После завершения передачи временный job-каталог удаляется.

### `GET /api/health`

Health check сервиса.

## Встраивание React-компонента

Основной компонент находится в:

```text
client/src/components/RussianProofingUploader.tsx
```

Он изолирован от `App.tsx`, использует CSS-классы с префиксом `frp-` и экспортируется через `client/src/components/index.ts`. Компонент принимает `apiBase`, `credentials`, `maxFileSizeBytes`, `onReady` и `onError`.

Для standalone-сборки API base также можно задать через:

```text
VITE_API_BASE=https://your-api.example.com
```

Если frontend и backend работают на одном origin, переменная не нужна.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---:|---|
| `MAX_UPLOAD_BYTES` | 104857600 | Максимальный размер загружаемого файла |
| `JOB_TTL_SECONDS` | 3600 | Время жизни временной задачи |
| `MAX_CONCURRENT_JOBS` | 2 | Максимум одновременно обрабатываемых презентаций в одном worker |
| `MAX_ZIP_ENTRIES` | 10000 | Защита от аномально больших ZIP-пакетов |
| `MAX_UNCOMPRESSED_BYTES` | 524288000 | Лимит суммарного распакованного объёма |
| `MAX_COMPRESSION_RATIO` | 250 | Ограничение подозрительного compression ratio |
| `CORS_ORIGINS` | `http://localhost:5173` | Разрешённые browser origins; для same-origin proxy может быть пустым |
| `ALLOWED_HOSTS` | `*` | Разрешённые Host headers для TrustedHostMiddleware |
| `ENABLE_DOCS` | dev: true / prod: false | Включение FastAPI Swagger/ReDoc |
| `STATIC_DIR` | `/app/static` | Каталог production React build |

## Безопасность и хранение файлов

- исходный файл не перезаписывается;
- обработка выполняется во временном каталоге;
- результат удаляется после скачивания;
- незавершённые задачи удаляются после TTL;
- выполняются базовые проверки ZIP-пакета, размера, количества entries и compression ratio;
- сервер не запускает макросы и не требует установленного Microsoft Office.

Production-конфигурация намеренно запускает **1 Uvicorn worker**, но ограничивает параллельную обработку через `MAX_CONCURRENT_JOBS`. Для нескольких worker/реплик in-memory `JobManager` нужно заменить на общее хранилище состояния (например Redis) и shared/object storage для временных файлов.

## Ограничения

Модуль меняет только редактируемый DrawingML-текст PowerPoint. Он не может изменить язык текста, который фактически является:

- изображением;
- текстом, переведённым в векторные контуры;
- PDF-вставкой;
- содержимым отдельного внедрённого OLE Word/Excel-файла.

Цифровые подписи OOXML-пакета после изменения ZIP/XML становятся недействительными. Для подписанных документов требуется повторное подписание после обработки.

После скачивания откройте исправленный файл в PowerPoint, дождитесь обновления проверки орфографии и сохраните презентацию один раз.

## Тесты

Backend:

```bash
PYTHONPATH=server pytest server/tests -q
```

Frontend:

```bash
cd client
npm ci
npm run build
```

GitHub repository: `amkrshn/force-russian-proofing-4-pptx`.

Отображаемое название приложения: **Force RussianProofing4PPTX**.
