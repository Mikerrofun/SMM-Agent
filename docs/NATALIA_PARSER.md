# Парсер канала Натальи (@talant_director)

Этот парсер собирает текстовые посты из Telegram-канала Натальи для создания базы знаний. База используется для дедупликации идей — проверки, была ли тема уже раскрыта.

---

## 📋 Подготовка: настройка .env файла

Перед первым запуском нужно настроить переменные окружения в `.env` файле.

### Шаг 1: Получить Telegram API credentials

1. Перейди на https://my.telegram.org/auth
2. Войди под своим номером телефона
3. Перейди в раздел **API development tools**
4. Создай новое приложение:
   - **App title:** `SMM Agent Parser` (любое название)
   - **Short name:** `smm_parser` (любое)
   - **Platform:** Desktop
5. Скопируй `api_id` и `api_hash`

### Шаг 2: Добавить credentials в .env

Открой `.env` файл и добавь:

```bash
# Telegram MTProto API (для парсеров)
TELEGRAM_API_ID="12345678"                    # ← твой api_id
TELEGRAM_API_HASH="abc123def456..."           # ← твой api_hash (32 символа)
TELEGRAM_SESSION_STRING=""                     # ← оставь пустым (заполнится автоматически)
```

**Важно:**
- `TELEGRAM_API_ID` — число (твой api_id)
- `TELEGRAM_API_HASH` — строка из 32 символов
- `TELEGRAM_SESSION_STRING` — **оставь пустым** при первом запуске

### Шаг 3: Убедись, что DATABASE_URL настроен

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/smm_agent"
```

---

## 🚀 Первый запуск

### Команда:

```bash
npm run parse:natalia
```

### Что произойдет:

1. **Авторизация (первый раз):**
   ```
   🔐 Authorization required
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Enter your phone number (with country code, e.g., +1234567890): 
   ```
   
   - Введи номер телефона в формате `+1234567890`
   - Telegram отправит код в приложение
   
   ```
   📨 Verification code sent to your Telegram app
   Enter the verification code:
   ```
   
   - Введи код из Telegram
   - Если включена 2FA, введи пароль (или просто нажми Enter)

2. **Session String:**
   ```
   ✅ Authorization successful!
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   📋 IMPORTANT: Save this session string to your .env file:
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TELEGRAM_SESSION_STRING="1AgAOMTQ5LjE1NC4xNjcuNTEBu...очень длинная строка...=="
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

   **ОБЯЗАТЕЛЬНО:**
   - Скопируй **всю строку** (включая кавычки)
   - Вставь в `.env` файл:
   
   ```bash
   TELEGRAM_SESSION_STRING="1AgAOMTQ5LjE1NC4xNjcuNTEBu...xjZw=="
   ```

3. **Парсинг:**
   ```
   📡 Starting to parse channel @talant_director
   📅 Cutoff date: 2023-04-03T00:00:00.000Z
   
   ⏳ Обработано: 154/233 сообщений
   
   ✅ Парсинг завершен!
   ```

---

## 🔄 Повторные запуски

После сохранения `TELEGRAM_SESSION_STRING` в `.env`:

```bash
npm run parse:natalia
```

**Что изменится:**
- ✅ Авторизация **не требуется** (используется сохраненная сессия)
- ✅ Парсер сразу начинает работу
- ✅ Номер телефона и код **не нужны**

Вывод:
```
🔧 Initializing Telegram client...
✅ Using existing session (already authorized)
📡 Starting to parse channel @talant_director
```

---

## 📊 Что собирается

### ✅ Собираются:

- Текстовые посты
- Посты с фото + текст (только текст)
- Посты с видео + текст (только текст)
- Посты с документом + текст (только текст)

### ❌ Пропускаются:

- Опросы (polls)
- Только медиа без текста (стикеры, видео без подписи)
- Пустые сообщения
- Посты старше `CUTOFF_DATE` (сейчас: 3 апреля 2023)

---

## ⚙️ Настройка парсера

**Файл:** `src/parser/natalia/config.ts`

```typescript
export const PARSER_CONFIG = {
  CHANNEL_USERNAME: 'talant_director',           // Имя канала (без @)
  CUTOFF_DATE: new Date('2023-04-03T00:00:00.000Z'), // Дата начала парсинга
  BATCH_SIZE: 20,                                // Размер батча для сохранения
  MESSAGES_PER_REQUEST: 100,                     // Сообщений за один запрос к API
} as const;
```

### Изменить дату парсинга:

Если хочешь загрузить посты с другой даты:

```typescript
CUTOFF_DATE: new Date('2022-01-01T00:00:00.000Z'), // С 1 января 2022
```

**После изменения:**
1. Очисти таблицу `NataliaPost` (или сделай `prisma migrate reset`)
2. Запусти парсер заново

---

## 🔄 Инкрементальная загрузка

Парсер работает инкрементально — загружает **только новые посты**.

### Как работает:

1. **Первый запуск:** загружает все посты с `CUTOFF_DATE` до сегодня
2. **Повторные запуски:** загружает только посты новее последнего в БД

**Пример:**

```bash
# Первый запуск (20.01.2025)
npm run parse:natalia
# → Загрузились посты с 03.04.2023 по 20.01.2025

# Через месяц (20.02.2025)
npm run parse:natalia
# → Загрузятся только новые посты с 20.01.2025 по 20.02.2025
```

### Вывод:

```
🔄 Incremental mode: fetching posts newer than 2025-01-20T12:00:00.000Z

⏹️  Reached previously parsed messages (2025-01-20T11:55:00.000Z)

📊 Статистика:
  📨 Всего найдено постов:     50
  ✔️  Сохранено новых:         35
  ⏭️  Пропущено (дубли):       15
```

---

## 🗑️ Очистка БД для повторной загрузки

Если нужно загрузить посты заново (например, изменил `CUTOFF_DATE`):

### Вариант 1: Очистить только NataliaPost

```bash
npx prisma studio
```

В UI удали все записи из `NataliaPost`.

### Вариант 2: Полный сброс БД

```bash
npx prisma migrate reset --force
```

⚠️ **Осторожно:** удалит ВСЕ данные из всех таблиц!

---

## 📈 Статистика парсинга

После завершения выводится:

```
📊 Статистика:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📨 Всего найдено постов:     233
  ✔️  Сохранено новых:         154
  ⏭️  Пропущено (дубли):       79
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Что означают цифры:

- **Всего найдено:** сколько сообщений получено от Telegram API
- **Сохранено новых:** сколько постов добавлено в БД
- **Пропущено:** невалидные сообщения (опросы, пустые) + дубли URL

**Примечание:** 30-40% пропущено — это нормально (опросы, служебные сообщения, медиа без текста).

## 🔧 Техническая структура кода

Для разработчиков: как организован код парсера.

```
src/
├── types/
│   └── nataliaPost.types.ts          # Типы: CreateNataliaPostInput, ParseStatistics
│
├── shared/
│   └── telegram/                     # Переиспользуемые модули для работы с Telegram
│       ├── config.ts                 # TELEGRAM_RETRY_CONFIG
│       ├── connection.ts             # connectWithRetry()
│       ├── auth.ts                   # authorizeClient()
│       ├── validators.ts             # isTextMessage, isValidDate, validateMessageData
│       ├── transformers.ts           # extractMessageText, extractMessageDate
│       ├── utils.ts                  # sleep, promptInput
│       ├── client.ts                 # initializeTelegramClient()
│       └── index.ts                  # Публичный API
│
├── parser/natalia/
│   ├── config.ts                     # CHANNEL_USERNAME, CUTOFF_DATE, BATCH_SIZE
│   ├── errors.ts                     # TelegramAuthError, NetworkError
│   ├── checkChannel.ts               # Проверка существования канала
│   ├── batchProcessor.ts             # Сбор и сохранение батчей
│   ├── parser.ts                     # Основная логика
│   └── run.ts                        # CLI entry point
│
└── repositories/
    └── nataliaPostRepository.ts      # getLatestPublishedDate, createMany
```

---

## ❓ Troubleshooting

### Session string не сохраняется

**Проблема:** Каждый раз запрашивается номер телефона и код.

**Решение:**
- Скопируй session string из консоли после первой авторизации
- Вставь в `.env` файл:
  ```bash
  TELEGRAM_SESSION_STRING="1AgAO...длинная строка...=="
  ```
- Формат: **с кавычками**, вся строка целиком

---

### "Channel not found"

**Возможные причины:**
- Канал является приватным (нужен доступ)
- Канал был удален или заблокирован
- Неверное имя канала

**Решение:**
- Проверь имя: `talant_director` (без `@`)
- Убедись, что канал публичный или ты подписан (для приватных)
- Попробуй открыть канал в Telegram: https://t.me/talant_director

---

### "Network error"

**Возможные причины:**
- Нет интернета
- Telegram API заблокирован в регионе
- Временные проблемы с Telegram серверами

**Решение:**
- Проверь подключение к интернету
- Используй VPN (если Telegram заблокирован)
- Retry логика автоматически попытается переподключиться (3 попытки с задержкой 4 сек)

---

### Много "пропущено" в статистике

**Это нормально!**

В "пропущено" попадают:
- Опросы (polls)
- Пустые сообщения
- Только медиа без текста (стикеры, видео без подписи)
- Дубли URL (при повторном запуске)

**30-40% пропущено** — нормальный показатель для Telegram-канала.

---

### Дубли в БД

**Невозможно** — `telegramPostUrl` имеет unique constraint в PostgreSQL.

Prisma использует `skipDuplicates: true`, который:
- Пропускает дубли автоматически
- Не бросает ошибку
- Считает только реально вставленные записи

---

### Парсинг останавливается на середине

**Это нормальное поведение** — инкрементальная загрузка.

При повторном запуске парсер:
1. Получает дату последнего поста в БД
2. Останавливается, когда встречает этот пост
3. Выводит: `⏹️  Reached previously parsed messages`

**Результат:** Загружаются только новые посты.

---

### Нужно загрузить посты заново

Если изменил `CUTOFF_DATE` или хочешь перезагрузить все посты:

**Способ 1: Через Prisma Studio**
```bash
npx prisma studio
```
Удали все записи из `NataliaPost` в UI.

**Способ 2: SQL запрос**
```bash
npx prisma db execute --stdin <<SQL
TRUNCATE TABLE "NataliaPost" CASCADE;
SQL
```

**Способ 3: Полный сброс (осторожно!)**
```bash
npx prisma migrate reset --force
```
⚠️ Удалит ВСЕ данные из всех таблиц!

---

### Ошибка "DATABASE_URL is required"

**Проблема:** Prisma не видит переменную окружения.

**Решение:**
- Проверь, что `.env` файл существует в корне проекта
- Убедись, что `DATABASE_URL` прописан:
  ```bash
  DATABASE_URL="postgresql://user:password@localhost:5432/smm_agent"
  ```
- Перезапусти команду
