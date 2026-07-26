# Парсинг Telegram-каналов

## Зачем

Для дедупликации идей и анализа контента нужна база постов из Telegram-каналов. Парсеры собирают текстовые посты автоматически, загружая только новые (инкрементально). Это позволяет:

- Проверять, была ли идея уже озвучена
- Анализировать частоту тем и форматы постов
- Генерировать контент с учётом уже опубликованного

## Как работает

### Архитектура

```
CLI скрипт (npm run parse:natalia)
  ↓
Telegram MTProto Client (GramJS)
  ↓
Получение сообщений пакетами по 100
  ↓
Валидация (только текст, дата >= cutoff)
  ↓
Инкрементальная проверка (дошли до уже загруженных → стоп)
  ↓
Батчинг и сохранение в Prisma по 20 постов
  ↓
Статистика: всего/сохранено/пропущено/ошибки
```

### Инкрементальная загрузка

При первом запуске загружаются все посты с указанной даты (например, с 24.12.2024).  
При повторных запусках:

1. Запрос к БД: `SELECT MAX(publishedAt) FROM NataliaPost`
2. Парсинг останавливается, когда встречает пост старше этой даты
3. Сохраняются только новые посты

**Результат:** При повторном запуске через месяц загрузится только 30-50 новых постов вместо всей истории.

### Пагинация

Telegram API не отдаёт все сообщения сразу. Используется `offsetId` для получения следующих порций:

```
Запрос 1: getMessages(limit=100, offsetId=0)     → посты 1-100
Запрос 2: getMessages(limit=100, offsetId=100)   → посты 101-200
Запрос 3: getMessages(limit=100, offsetId=200)   → посты 201-300
...
```

Цикл продолжается, пока:
- Не получено 0 сообщений (конец канала)
- Или не достигнута дата последнего загруженного поста (инкрементальный стоп)

### Авторизация

**Первый запуск:**
1. Скрипт запрашивает номер телефона
2. Telegram отправляет код в приложение
3. Пользователь вводит код
4. Генерируется session string (длинная строка)
5. Session string нужно сохранить в `.env`

**Повторные запуски:**
- Session string из `.env` используется автоматически
- Авторизация не требуется

### Батчинг

Посты сохраняются пакетами по 20 штук:

```typescript
batch = [post1, post2, ..., post20]
prisma.nataliaPost.createMany({ data: batch, skipDuplicates: true })
```

**Почему не по одному:**
- `createMany` — одна транзакция вместо 20
- Ускорение записи в ~10 раз
- `skipDuplicates: true` пропускает дубли по `telegramPostUrl` (unique constraint)

## Структура кода

```
src/
├── types/
│   └── nataliaPost.types.ts          # Типы: CreateNataliaPostInput, ParseStatistics
│
├── shared/
│   └── telegram/
│       └── client.ts                 # Инициализация Telegram клиента (переиспользуется)
│
├── parser/natalia/
│   ├── config.ts                     # Константы: CHANNEL_USERNAME, CUTOFF_DATE, BATCH_SIZE
│   ├── errors.ts                     # Кастомные ошибки: TelegramAuthError, NetworkError
│   ├── validator.ts                  # Фильтрация сообщений (текст + дата)
│   ├── checkChannel.ts               # Проверка существования канала
│   ├── batchProcessor.ts             # Сбор и сохранение батчей
│   ├── parser.ts                     # Основная логика (координация модулей)
│   └── run.ts                        # CLI entry point
│
└── repositories/
    └── nataliaPostRepository.ts      # Работа с БД (getLatestPublishedDate, createMany)
```

## Запуск

```bash
npm run parse:natalia
```

**Первый запуск:**
- Введите номер телефона и код из Telegram
- Скопируйте session string в `.env`
- Загрузятся все посты с 24.12.2024

**Повторные запуски:**
- Авторизация автоматически (session string из `.env`)
- Загрузятся только новые посты

## Добавление нового парсера

Для парсинга канала конкурента:

1. **Создать конфиг:**
   ```typescript
   // src/parser/competitor/config.ts
   export const PARSER_CONFIG = {
     CHANNEL_USERNAME: 'competitor_channel',
     CUTOFF_DATE: new Date('2025-01-01'),
     BATCH_SIZE: 20,
     MESSAGES_PER_REQUEST: 100,
   } as const;
   ```

2. **Переиспользовать shared модули:**
   ```typescript
   import { initializeTelegramClient } from '../../shared/telegram/client';
   ```

3. **Создать типы (если структура отличается):**
   ```typescript
   // src/types/competitorPost.types.ts
   export interface CreateCompetitorPostInput {
     text: string;
     telegramPostUrl: string;
     // ...специфичные поля
   }
   ```

4. **Скопировать структуру из `parser/natalia`:**
   - `checkChannel.ts` — без изменений
   - `validator.ts` — адаптировать фильтры (если нужны другие правила)
   - `batchProcessor.ts` — адаптировать под новую модель БД
   - `parser.ts` — координация (минимальные правки)
   - `run.ts` — CLI entry point

5. **Добавить npm-скрипт:**
   ```json
   "parse:competitor": "tsx src/parser/competitor/run.ts"
   ```

## Что НЕ делает парсер

- ❌ Не заполняет `mainIdea` — это делает AI-процесс отдельно
- ❌ Не генерирует `embedding` — отдельный процесс через OpenAI API
- ❌ Не публикует посты — только сбор в БД
- ❌ Не работает как постоянный процесс — только CLI-скрипт для ручного запуска
- ❌ Не использует Telegram Bot API — используется MTProto (GramJS) для чтения чужих каналов

## Troubleshooting

**Session string не сохраняется:**
- Скопируйте строку из консоли вручную в `.env`
- Формат: `TELEGRAM_SESSION_STRING="1AgAO...длинная строка...=="`

**"Channel not found":**
- Проверьте, что канал публичный
- Убедитесь, что аккаунт подписан на канал (для приватных)
- Правильное имя: `talant_director` без `@`

**"Network error":**
- Проверьте интернет-соединение
- Telegram API может быть заблокирован в регионе — используйте VPN
- Retry логика (3 попытки) сработает автоматически

**Дубли в БД:**
- Невозможно — `telegramPostUrl` имеет unique constraint
- Prisma `skipDuplicates: true` пропускает дубли автоматически

**Парсинг останавливается на середине:**
- Это инкрементальная логика — дошли до уже загруженных постов
- Нормальное поведение при повторном запуске
