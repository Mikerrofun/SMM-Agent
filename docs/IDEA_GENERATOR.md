# Idea Generator — Генератор идей из постов конкурентов

## Обзор

Система автоматической генерации идей для контента на основе постов конкурентов с использованием GPT-4o и Structured Outputs.

## Архитектура

### Слои системы

```
┌─────────────────────────────────────────────────────────────────┐
│  CLI Script (generateIdeas/competitors.ts)                      │
│  - Получает необработанные CompetitorPost                       │
│  - Запускает ideaProcessor с worker pool                        │
│  - Выводит прогресс и статистику                                │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Service Layer (ideaProcessor.ts)                               │
│  - Worker pool с rate limiting (30 req/min)                     │
│  - Retry с экспоненциальным backoff                             │
│  - Обработка успешных/неудачных элементов                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  AI Layer (ideaExtractor.ts)                                    │
│  - Загрузка промпта из файла (кэширование в памяти)            │
│  - Вызов OpenAI API с Structured Outputs                        │
│  - Обёртка <untrusted_source> для текста конкурента             │
│  - Валидация через Zod schema                                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Repository Layer (ideaRepository.ts)                           │
│  - Создание записи Idea                                         │
│  - Обновление CompetitorPost.isProcessed + связь               │
│  - Получение необработанных постов                              │
└─────────────────────────────────────────────────────────────────┘
```

## Файловая структура

```
src/
├── ai/
│   ├── ideaExtractor.ts              # AI модуль для генерации идей
│   └── ideaExtractor.config.ts       # Конфигурация AI (токены, температура, промпт)
├── services/
│   └── idea/
│       ├── ideaProcessor.ts          # Батч-обработка с worker pool
│       ├── ideaProcessor.types.ts    # Типы для процессора
│       └── idea.config.ts            # Конфигурация retry и rate limit
├── repositories/
│   └── ideaRepository.ts             # Работа с БД (Idea, CompetitorPost)
├── types/
│   └── idea.types.ts                 # TypeScript типы
├── schemas/
│   └── idea.schema.ts                # Zod схемы и JSON Schema для OpenAI
├── shared/
│   └── utils/
│       └── promptLoader.ts           # Утилита загрузки промптов с кэшированием
├── prompts/
│   └── extract-idea-competitor-post.md  # Системный промпт (>1024 токенов)
└── scripts/
    └── generateIdeas/
        └── competitorPostsToIdeas.ts # CLI точка входа
```

## Конфигурация

### Rate Limiting

```typescript
{
  requestsPerMinute: 30,  // Консервативный лимит для стабильности
  concurrency: 5          // Параллельных worker'ов
}
```

### Retry Policy

```typescript
{
  maxAttempts: 3,
  delayMs: 1000,
  backoffFactor: 2  // 1s → 2s → 4s
}
```

### OpenAI Parameters

```typescript
{
  model: "gpt-4o-mini",
  temperature: 0.7,       // Баланс креативности и стабильности
  max_tokens: 300         // title + mainIdea + goal
}
```

## Структура идеи

Каждая сгенерированная идея содержит:

- **title** (10-60 символов) — цепляющий заголовок
- **mainIdea** (50-500 символов) — ключевой тезис, 2-3 предложения
- **goal** (20-200 символов) — чёткая цель публикации

## Валидация

Используется Zod для валидации структуры идей:

```typescript
{
  title: z.string().min(10).max(60),
  mainIdea: z.string().min(50).max(500),
  goal: z.string().min(20).max(200)
}
```

OpenAI Structured Outputs гарантирует соответствие JSON схеме.

## Промпт-кэширование

Системный промпт >1024 токенов автоматически кэшируется OpenAI:
- **Первый запрос**: полная стоимость
- **Последующие запросы**: 50% скидка на input токены

Промпт загружается в память один раз при первом вызове `extractIdea()`.

## Транзакционность

Создание идеи и пометка поста как обработанного выполняется атомарно:

```typescript
prisma.$transaction(async (tx) => {
  const idea = await tx.idea.create({ ... });
  await tx.competitorPost.update({ 
    where: { id }, 
    data: { isProcessed: true } 
  });
  return idea;
});
```

## Использование

### CLI команда

```bash
npm run generate:ideas:competitors
```

**Выполняется:** `src/scripts/generateIdeas/competitorPostsToIdeas.ts`

### Что происходит

1. Получает все посты с `isProcessed = false`
2. Если постов нет — выходит с сообщением
3. Запускает батч-обработку с прогресс баром
4. Для каждого поста:
   - Генерирует идею через AI (с retry)
   - Сохраняет в БД в транзакции
   - Помечает пост как обработанный
5. Выводит детальную статистику

### Graceful degradation

- Успешные элементы сохраняются сразу
- Failed элементы логируются
- Можно запустить повторно — обработает только оставшиеся
- SIGINT корректно прерывает выполнение

## Примеры вывода

### Успешный запуск

```
💡 Генерация идей из постов конкурентов

📥 Найдено постов для обработки: 47

[████████████████████] 100% | 47/47 | Elapsed: 3m | ETA: 0s

📊 Статистика
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📨 Всего постов:        47
✔️  Успешно обработано:  47
❌ Ошибок:              0
⏱️  Время:               187s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✨ Все посты успешно обработаны!
```

### С ошибками

```
📊 Статистика
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📨 Всего постов:        47
✔️  Успешно обработано:  45
❌ Ошибок:              2
⏱️  Время:               189s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  Не удалось обработать:
   • clxyz123: LLM returned empty response
   • clxyz456: Cannot extract idea from empty text

💡 Запустите команду повторно для оставшихся постов.
```

## Отладка

### Проверка типов

```bash
npm run type-check
```

### Просмотр необработанных постов

```sql
SELECT COUNT(*) FROM "CompetitorPost" WHERE "isProcessed" = false;
```

### Просмотр созданных идей

```sql
SELECT 
  i.title,
  i.status,
  c.name as competitor_name,
  cp."publishedAt"
FROM "Idea" i
JOIN "CompetitorPost" cp ON cp.id = i."competitorPostId"
JOIN "Competitor" c ON c.id = cp."competitorId"
ORDER BY i."createdAt" DESC
LIMIT 10;
```

## Безопасность

- Текст конкурента оборачивается в `<untrusted_source>` теги
- Валидация через Zod перед сохранением
- Все ошибки логируются с деталями
- Транзакции предотвращают частичные обновления

## Расширение

### Добавление нового поля в идею

1. Обновить Prisma schema
2. Запустить миграцию
3. Обновить `GeneratedIdeaSchema` в `idea.schema.ts`
4. Обновить `IdeaJsonSchema` для OpenAI
5. Обновить промпт с инструкциями для нового поля
6. Обновить `CreateIdeaInput` в `idea.types.ts`

### Изменение параметров AI

Редактировать `src/ai/ideaExtractor.ts`:
- `MAX_TOKENS` — для более длинных идей
- `TEMPERATURE` — для большей/меньшей креативности

### Изменение rate limit

Редактировать `src/services/idea/idea.config.ts`:
- `requestsPerMinute` — скорость обработки
- `concurrency` — количество параллельных worker'ов

## Что дальше

Система готова к использованию. Следующие этапы (из roadmap):
- Дедупликация идей через embeddings (отдельная задача)
- Интеграция с Telegram-ботом
- Генерация постов из выбранных идей
