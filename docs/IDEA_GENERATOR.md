---

**Дата:** 02.08.2026  
**Теги:** #features #ai #ideas #competitors

---

## 1. Зачем

Системе нужен механизм автоматической генерации идей для постов из контента конкурентов. Раньше Наталья вручную просматривала каналы конкурентов, анализировала темы и адаптировала их под свою аудиторию — это занимало несколько часов в неделю. Задача: автоматизировать этот процесс через AI, который читает пост конкурента и генерирует структурированную идею (заголовок, тезис, цель) в стиле Натальи. Критично было не просто вызвать LLM на каждый пост, а сделать это эффективно: с rate limiting (не словить 429 от OpenAI), retry при ошибках, параллельной обработкой и graceful degradation (не терять успешные при падении одного запроса).

## 2. Где/что уже было

Система уже умеет:
- Парсить посты конкурентов через `src/parser/competitors/` → сохранять в `CompetitorPost` с флагом `isProcessed = false`
- Работать с OpenAI через клиент в `src/core/lib/openai.ts`
- Делать batch-обработку с worker pool — паттерн `mainIdeaProcessor.ts`:

```typescript
// src/services/nataliaPost/mainIdeaProcessor.ts
export async function processBatch(
  items: ProcessableItem[],
  options: ProcessOptions
): Promise<ProcessStats> {
  // Worker pool с rate limiting
  // Retry через withRetry()
  // Graceful degradation: succeeded/failed раздельно
}
```

Этот паттерн уже использовался для извлечения `mainIdea` из постов Натальи. Задача — переиспользовать этот подход для генерации идей из постов конкурентов, но с изменениями:
- Не просто текст извлекаем, а структурированный JSON (`title`, `mainIdea`, `goal`)
- Используем OpenAI Structured Outputs (JSON Schema) вместо обычного текста
- Сохраняем не в одно поле, а создаём запись `Idea` + помечаем `CompetitorPost.isProcessed = true` в транзакции

Все утилиты (retry, sleep, progressBar) уже были готовы.

## 3. Реализация

### 3.1. Типы и схемы валидации

```typescript
// src/schemas/idea.schema.ts
import { z } from 'zod';

export const GeneratedIdeaSchema = z.object({
  title: z.string().min(10).max(60),
  mainIdea: z.string().min(50).max(500),
  goal: z.string().min(20).max(200),
});

// JSON Schema для OpenAI Structured Outputs
export const IdeaJsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 60 },
    mainIdea: { type: 'string' },
    goal: { type: 'string' },
  },
  required: ['title', 'mainIdea', 'goal'],
  additionalProperties: false,
} as const;
```

```typescript
// src/types/idea.types.ts
export type GeneratedIdea = z.infer<typeof GeneratedIdeaSchema>;

export interface CreateIdeaInput {
  competitorPostId: string;
  title: string;
  mainIdea: string;
  goal: string;
}

export interface IdeaProcessItem {
  id: string;   // competitorPostId
  text: string; // текст поста конкурента
}
```

### 3.2. AI модуль с Structured Outputs

```typescript
// src/ai/ideaExtractor.ts
import { openai, DEFAULT_MODEL } from '../core/lib/openai';
import { GeneratedIdeaSchema, IdeaJsonSchema } from '../schemas/idea.schema';
import { loadPrompt } from '../shared/utils/promptLoader';
import { IDEA_PROMPT_PATH, IDEA_MAX_TOKENS, IDEA_TEMPERATURE } from './ideaExtractor.config';

export async function extractIdea(postText: string): Promise<GeneratedIdea> {
  const trimmed = postText?.trim() ?? '';
  
  if (trimmed.length === 0) {
    throw new Error('Cannot extract idea from empty text');
  }
  
  const systemPrompt = loadPrompt(IDEA_PROMPT_PATH);
  
  // Оборачиваем в <untrusted_source> для безопасности
  const userMessage = `<untrusted_source>\n${trimmed}\n</untrusted_source>`;
  
  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL, // gpt-4o-mini
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: IDEA_MAX_TOKENS,
    temperature: IDEA_TEMPERATURE,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'idea_extraction',
        strict: true,
        schema: IdeaJsonSchema,
      },
    },
  });
  
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('LLM returned empty response');
  }
  
  const parsed = JSON.parse(content);
  const validated = GeneratedIdeaSchema.parse(parsed); // Zod валидация
  
  return validated;
}
```

**Ключевое отличие от mainIdeaExtractor:**
- `response_format: { type: 'json_schema' }` — OpenAI гарантирует JSON на выходе
- Валидация через Zod — проверяем длины полей
- Промпт загружается через утилиту `loadPrompt()` (рефакторинг)

### 3.3. Конфигурация AI

```typescript
// src/ai/ideaExtractor.config.ts
export const IDEA_PROMPT_PATH = resolve(
  process.cwd(),
  'src/prompts/extract-idea-competitor-post.md'
);

export const IDEA_MAX_TOKENS = 300;
export const IDEA_TEMPERATURE = 0.7;
```

Вынесено в отдельный файл (после рефакторинга) — было встроено в `ideaExtractor.ts`.

### 3.4. Утилита загрузки промптов

```typescript
// src/shared/utils/promptLoader.ts (новый файл после рефакторинга)
const promptCache = new Map<string, string>();

export function loadPrompt(path: string): string {
  const cached = promptCache.get(path);
  if (cached !== undefined) return cached;
  
  const content = readFileSync(path, 'utf-8');
  promptCache.set(path, content);
  return content;
}
```

Переиспользуемо для всех промптов — не дублируем код загрузки.

### 3.5. Repository с транзакцией

```typescript
// src/repositories/ideaRepository.ts
export async function createIdeaAndMarkProcessed(
  data: CreateIdeaInput
): Promise<IdeaModel> {
  // Атомарно: создаём Idea + помечаем CompetitorPost.isProcessed = true
  return prisma.$transaction(async (tx) => {
    const idea = await tx.idea.create({
      data: {
        competitorPostId: data.competitorPostId,
        title: data.title,
        mainIdea: data.mainIdea,
        goal: data.goal,
        status: 'NEW',
      },
    });
    
    await tx.competitorPost.update({
      where: { id: data.competitorPostId },
      data: { isProcessed: true },
    });
    
    return idea;
  });
}

export async function getUnprocessedCompetitorPosts(): Promise<IdeaProcessItem[]> {
  return prisma.competitorPost.findMany({
    where: { isProcessed: false },
    select: { id: true, text: true },
    orderBy: { publishedAt: 'asc' }, // старые первыми
  });
}

// Методы для Telegram (добавлены после рефакторинга)
export async function getNewIdeasForSending(limit: number = 10): Promise<IdeaModel[]> {
  return prisma.idea.findMany({
    where: { status: 'NEW' },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getIdeasByStatus(
  status: 'NEW' | 'SENT' | 'SELECTED' | 'REJECTED' | 'DUPLICATE',
  limit?: number
): Promise<IdeaModel[]> {
  return prisma.idea.findMany({
    where: { status },
    orderBy: { createdAt: 'desc' },
    ...(limit && { take: limit }),
  });
}

export async function countIdeasByStatus(
  status: 'NEW' | 'SENT' | 'SELECTED' | 'REJECTED' | 'DUPLICATE'
): Promise<number> {
  return prisma.idea.count({ where: { status } });
}
```

Методы `getNewIdeasForSending`, `getIdeasByStatus`, `countIdeasByStatus` добавлены после рефакторинга для интеграции с Telegram-ботом.

### 3.6. Service-процессор с worker pool

```typescript
// src/services/idea/ideaProcessor.ts
import { extractIdea } from '../../ai/ideaExtractor';
import { createIdeaAndMarkProcessed } from '../../repositories/ideaRepository';
import { withRetry } from '../../shared/utils/retry';
import { sleep } from '../../shared/utils/sleep';
import { IDEA_RETRY_CONFIG, IDEA_RATE_LIMIT } from './idea.config';

export async function processIdeaBatch(
  options: IdeaProcessOptions
): Promise<IdeaProcessStats> {
  const { items, onProgress } = options;
  const { requestsPerMinute, concurrency } = IDEA_RATE_LIMIT;
  const intervalMs = Math.ceil(60_000 / requestsPerMinute); // 2000ms для 30 req/min

  const stats: IdeaProcessStats = {
    total: items.length,
    succeeded: 0,
    failed: 0,
    failedItems: [],
  };

  let processed = 0;
  let nextIndex = 0;
  let lastStart = 0;

  async function processItem(item: IdeaProcessItem): Promise<void> {
    try {
      // 1. Генерация идеи через AI (с retry)
      const idea = await withRetry(
        () => extractIdea(item.text),
        IDEA_RETRY_CONFIG
      );

      // 2. Сохранение в БД + пометка поста (транзакция)
      await createIdeaAndMarkProcessed({
        competitorPostId: item.id,
        ...idea,
      });

      stats.succeeded++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stats.failed++;
      stats.failedItems.push({ id: item.id, error: message });
    } finally {
      processed++;
      onProgress?.(processed, items.length);
    }
  }

  // Worker pool с rate limiting
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const item = items[nextIndex++]; // Берём следующий элемент из очереди

      // Контроль rate limit: запросы стартуют с фиксированным интервалом
      const now = Date.now();
      const wait = lastStart + intervalMs - now;
      lastStart = wait > 0 ? now + wait : now;
      if (wait > 0) {
        await sleep(wait);
      }

      await processItem(item);
    }
  }

  // Запускаем concurrency воркеров параллельно
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );

  await Promise.all(workers);

  return stats;
}
```

**Ключевые детали processIdeaBatch:**

1. **Worker pool (5 воркеров)**:
   - Создаём 5 async функций `worker()`
   - Каждая в цикле берёт элемент из общей очереди (`nextIndex++`)
   - Обрабатывает параллельно, пока очередь не пуста

2. **Rate limiting (30 req/min)**:
   - `intervalMs = 60000 / 30 = 2000ms` — интервал между запусками запросов
   - `lastStart` — глобальная переменная, отслеживает время последнего старта
   - Воркер проверяет: прошло ли 2000ms с последнего старта?
   - Если нет — ждёт `sleep(wait)`, затем стартует запрос
   - Даже если воркер освободился раньше — ждёт своей очереди

3. **Retry (3 попытки, backoff 2x)**:
   - `withRetry(() => extractIdea(item.text), IDEA_RETRY_CONFIG)`
   - При ошибке: 1s → 2s → 4s задержки
   - После 3 неудач → элемент в `failedItems`

4. **Graceful degradation**:
   - Каждый успешный элемент сохраняется сразу в БД
   - Ошибка одного элемента не ломает остальные
   - Статистика `succeeded`/`failed` отдельно

5. **Транзакционность**:
   - Создание `Idea` + пометка `CompetitorPost.isProcessed = true` — атомарно
   - Либо оба действия проходят, либо ни одно

```typescript
// src/services/idea/idea.config.ts
export const IDEA_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffFactor: 2, // 1s → 2s → 4s
};

export const IDEA_RATE_LIMIT = {
  requestsPerMinute: 30, // Консервативно для стабильности
  concurrency: 5,
} as const;
```

### 3.7. CLI скрипт

```typescript
// src/scripts/generateIdeas/competitorPostsToIdeas.ts
import 'dotenv/config';
import { getUnprocessedCompetitorPosts } from '../../repositories/ideaRepository';
import { processIdeaBatch } from '../../services/idea/ideaProcessor';
import { ProgressBar } from '../../shared/utils/progressBar';

async function main(): Promise<void> {
  console.log('\n💡 Генерация идей из постов конкурентов\n');

  const posts = await getUnprocessedCompetitorPosts();

  if (posts.length === 0) {
    console.log('✅ Все посты уже обработаны — нет постов без идей.\n');
    return;
  }

  console.log(`📥 Найдено постов для обработки: ${posts.length}\n`);

  const progress = new ProgressBar();
  progress.start(posts.length);

  const started = Date.now();

  const stats = await processIdeaBatch({
    items: posts,
    onProgress: (current) => progress.update(current),
  });

  progress.stop();

  const elapsedSec = Math.round((Date.now() - started) / 1000);

  console.log('\n📊 Статистика');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📨 Всего постов:        ${stats.total}`);
  console.log(`✔️  Успешно обработано:  ${stats.succeeded}`);
  console.log(`❌ Ошибок:              ${stats.failed}`);
  console.log(`⏱️  Время:               ${elapsedSec}s`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (stats.failed > 0) {
    console.log('\n⚠️  Не удалось обработать:');
    for (const item of stats.failedItems) {
      console.log(`   • ${item.id}: ${item.error}`);
    }
    console.log('\n💡 Запустите команду повторно для оставшихся постов.');
  } else {
    console.log('\n✨ Все посты успешно обработаны!');
  }

  console.log('');
}

process.on('SIGINT', () => {
  console.log('\n\n🛑 Прервано пользователем.');
  process.exit(0);
});

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n💥 Ошибка выполнения:', (error as Error).message);
    process.exit(1);
  });
```

Скрипт после рефакторинга переименован: `competitors.ts` → **`competitorPostsToIdeas.ts`** (явное имя трансформации).

NPM команда:
```json
// package.json
"generate:ideas:competitors": "tsx src/scripts/generateIdeas/competitorPostsToIdeas.ts"
```

### 3.8. Промпт (16KB)

```markdown
// src/prompts/extract-idea-competitor-post.md
# Роль и контекст

Ты — креативный ассистент, который помогает создавать идеи для постов 
в Telegram-канале Натальи Жирновой...

[описание Натальи, аудитории, стиля, 7 основных тем, правила адаптации, 
3 подробных примера трансформации постов конкурентов]

# Формат ответа

Верни ТОЛЬКО структурированный JSON с тремя полями: title, mainIdea, goal.
```

Промпт >1024 токенов (16KB) → OpenAI автоматически кэширует → 50% скидка на input после первого запроса.

## 4. UI

Нет UI. Это CLI-скрипт для автоматизации. Результаты идут в БД → позже будут отправляться в Telegram-бота.

## 5. Поток данных

```
npm run generate:ideas:competitors
↓
main() → getUnprocessedCompetitorPosts()
↓
Prisma: SELECT * FROM CompetitorPost WHERE isProcessed = false
↓
processIdeaBatch({ items: posts })
↓
Worker Pool (5 воркеров параллельно):
  Worker 1: берёт post[0] → ждёт rate limit (2000ms) → processItem()
  Worker 2: берёт post[1] → ждёт rate limit (2000ms) → processItem()
  ...
↓
processItem(post):
  withRetry(() => extractIdea(post.text), retry: 3)
    ↓
    loadPrompt(IDEA_PROMPT_PATH) → кэш или readFile
    ↓
    openai.chat.completions.create({
      system: промпт,
      user: <untrusted_source>{post.text}</untrusted_source>,
      response_format: json_schema
    })
    ↓
    LLM возвращает JSON: { title, mainIdea, goal }
    ↓
    Zod валидация: GeneratedIdeaSchema.parse()
    ↓
  createIdeaAndMarkProcessed({...idea, competitorPostId})
    ↓
    Prisma.$transaction:
      INSERT INTO Idea (...)
      UPDATE CompetitorPost SET isProcessed = true WHERE id = ...
    ↓
  stats.succeeded++ → onProgress() → ProgressBar.update()
↓
Все воркеры завершились → return stats
↓
CLI: вывод статистики (succeeded/failed/time)
```

**При ошибке:**
```
extractIdea() → ошибка
↓
withRetry: попытка 2 через 1s
↓
extractIdea() → ошибка
↓
withRetry: попытка 3 через 2s
↓
extractIdea() → ошибка
↓
stats.failed++ → failedItems.push({ id, error })
↓
CLI: вывод списка failed в конце
```

## 6. Почему так, а не иначе

1. **Worker pool вместо Promise.all() на всех элементах**  
   `Promise.all(posts.map(post => processItem(post)))` запустит все запросы одновременно → словим 429 от OpenAI. Worker pool с `concurrency: 5` + rate limiting гарантирует не более 30 запросов/минуту.

2. **Rate limiting через общий `lastStart` вместо ограничения воркеров**  
   Если бы просто ограничили количество параллельных воркеров до 1-2 — это замедлило бы обработку. Worker pool + интервал между запусками даёт и параллелизм, и контроль rate limit.

3. **Транзакция вместо двух отдельных запросов**  
   Без транзакции возможна ситуация: создали `Idea`, но упали до `UPDATE CompetitorPost` → пост останется `isProcessed = false`, при повторном запуске создастся дубликат идеи.

4. **Промпт 16KB вместо минимального**  
   OpenAI кэширует промпты >1024 токенов (50% скидка). Детальное описание стиля Натальи, аудитории, примеров → LLM лучше понимает задачу → меньше неудачных генераций.

5. **Zod поверх JSON Schema**  
   JSON Schema гарантирует структуру от OpenAI, но не проверяет длины полей. Zod ловит кейсы типа `title: 150 символов` (должно быть max 60).

6. **`IdeaProcessItem` вместо полной модели `CompetitorPost`**  
   Service слой не должен знать про Prisma модели. Минимальный интерфейс `{id, text}` → легче тестировать, можно обработать идеи из других источников без изменения service.

7. **Переиспользование утилиты `promptLoader` вместо встроенного кэша**  
   После рефакторинга вынесли загрузку промптов в `shared/utils/promptLoader.ts` → можно переиспользовать для всех промптов проекта, не дублируя код.

## Преимущества

- ✅ Автоматизация ручной работы: 3-4 часа в неделю → 0 (AI генерирует идеи за минуты)
- ✅ Graceful degradation: ошибка одного поста не ломает остальные, можно перезапустить только на failed
- ✅ Rate limiting защищает от 429: стабильные 30 req/min, не словим блокировку API
- ✅ Retry с backoff: временные ошибки (сеть, перегрузка API) не роняют элементы
- ✅ Транзакционность: либо идея создана + пост помечен, либо ничего → нет дубликатов
- ✅ Промпт-кэширование: 50% экономия на input токенах (16KB промпт кэшируется OpenAI)
- ✅ Zod валидация: ловит некорректные длины полей до сохранения в БД
- ✅ Переиспользование паттерна: worker pool + retry уже работал для `mainIdeaProcessor`, не писали с нуля
- ✅ Идемпотентность: можно запускать повторно, обработает только `isProcessed = false`
- ✅ Расширяемость: методы `getNewIdeasForSending()`, `getIdeasByStatus()` готовы для Telegram-бота
