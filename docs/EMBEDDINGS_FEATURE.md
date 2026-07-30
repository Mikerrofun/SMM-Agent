---

**Дата:** 30.07.2026  
**Теги:** #features #embeddings #deduplication #pgvector

---

## 1. Зачем

До этого момента у постов Натальи (`NataliaPost`) было поле `mainIdea`, но не было векторного представления для дедупликации. Без embeddings невозможно проверять похожесть идей через pgvector — приходилось бы делать дорогие LLM-вызовы для каждого сравнения или писать примитивные текстовые алгоритмы. Нужен механизм, который один раз векторизует mainIdea и позволяет делать быстрый cosine similarity поиск по базе через SQL. Плюс, этот же механизм позже применится к таблице `Idea` для проверки уникальности сгенерированных идей.

## 2. Где/что уже было

Переиспользуется существующая инфраструктура:

- **OpenAI клиент** из `src/core/lib/openai.ts` — уже настроенный экземпляр с API ключом
- **mainIdeaExtractor** из `src/ai/mainIdeaExtractor.ts` — для извлечения mainIdea из текста поста (режим 1)
- **ProgressBar** из `src/shared/utils/progressBar.ts` — визуальный прогресс-бар для CLI
- **Паттерн батч-процессора** из `src/services/nataliaPost/mainIdeaProcessor.ts` — worker pool с параллелизмом

```ts
// src/ai/mainIdeaExtractor.ts (существующий)
export async function extractMainIdea(text: string): Promise<string> {
  // LLM-вызов для извлечения главной мысли из поста
  // ...
}
```

Задача была не писать новую архитектуру для LLM-вызовов, а использовать существующий OpenAI клиент и добавить отдельный модуль для Embeddings API (который работает иначе — без chat completion, просто векторизация текста).

## 3. Реализация

### 3.1. Generic модуль embeddings

Новый модуль для работы с OpenAI Embeddings API. Модель `text-embedding-3-small` — дешёвая ($0.02/1M токенов), быстрая, стабильная (retry не нужен).

```ts
// src/ai/embeddings.ts
import { openai } from "../core/lib/openai";

export async function createEmbedding(text: string): Promise<number[]> {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    throw new Error("Cannot create embedding from empty text");
  }

  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: trimmed,
    encoding_format: "float",
  });

  const embedding = response.data[0]?.embedding;

  if (!embedding || embedding.length === 0) {
    throw new Error("OpenAI returned empty embedding");
  }

  return embedding; // массив из 1536 чисел
}
```

### 3.2. Расширение repository

Prisma не поддерживает тип `vector(1536)` нативно (в схеме это `Unsupported("vector(1536)")`), поэтому все операции с embeddings идут через raw SQL.

```ts
// src/repositories/nataliaPostRepository.ts (добавлено)
export async function updateMainIdeaAndEmbedding(
  id: string,
  mainIdea: string,
  embedding: number[]
): Promise<void> {
  const vectorLiteral = `[${embedding.join(",")}]`;

  await prisma.$executeRaw`
    UPDATE "NataliaPost"
    SET "mainIdea" = ${mainIdea},
        embedding = ${vectorLiteral}::vector
    WHERE id = ${id}
  `;
}

export async function updateEmbedding(
  id: string,
  embedding: number[]
): Promise<void> {
  const vectorLiteral = `[${embedding.join(",")}]`;

  await prisma.$executeRaw`
    UPDATE "NataliaPost"
    SET embedding = ${vectorLiteral}::vector
    WHERE id = ${id}
  `;
}

export async function getPostsWithoutEmbedding(): Promise<
  Array<{ id: string; mainIdea: string }>
> {
  const result = await prisma.$queryRaw<Array<{ id: string; mainIdea: string }>>`
    SELECT id, "mainIdea"
    FROM "NataliaPost"
    WHERE "mainIdea" != '' AND "mainIdea" IS NOT NULL
      AND embedding IS NULL
    ORDER BY "publishedAt" DESC
  `;

  return result;
}
```

**Почему raw SQL:** Prisma Client не генерирует типы для `Unsupported` полей — нельзя использовать `.update({ data: { embedding: ... } })` или `where: { embedding: null }`. Через `$executeRaw` и `$queryRaw` работаем напрямую с PostgreSQL, передаём вектор как строку `[1.2, 3.4, ...]::vector`.

### 3.3. Батч-процессор для embeddings

Generic процессор для параллельной обработки embeddings. Отличается от `mainIdeaProcessor` отсутствием rate-limiting (Embeddings API быстрый — лимит 3000 req/min).

```ts
// src/services/nataliaPost/embeddingProcessor.ts
import { createEmbedding } from "../../ai/embeddings";

export interface EmbeddingItem {
  id: string;
  text: string; // mainIdea для векторизации
}

export interface EmbeddingProcessOptions {
  items: EmbeddingItem[];
  saveEmbedding: (id: string, embedding: number[]) => Promise<void>;
  onProgress?: (processed: number, total: number) => void;
}

export async function processEmbeddingsBatch(
  options: EmbeddingProcessOptions
): Promise<EmbeddingProcessStats> {
  const { items, saveEmbedding, onProgress } = options;
  const CONCURRENCY = 10;

  // Worker pool: 10 параллельных воркеров
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      try {
        const embedding = await createEmbedding(item.text);
        await saveEmbedding(item.id, embedding);
        stats.succeeded++;
      } catch (error) {
        stats.failed++;
        stats.failedItems.push({ id: item.id, error: message });
      } finally {
        onProgress?.(++processed, items.length);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker())
  );

  return stats;
}
```

**Что НЕ тронуто:** логика retry из `mainIdeaProcessor` не портирована — Embeddings API стабильный, если упал запрос, фиксируем ошибку в `failedItems` и продолжаем.

### 3.4. CLI-скрипт с двумя режимами

Умный скрипт: проверяет, какие посты нужно обработать, и запускает соответствующий режим.

```ts
// src/scripts/generateEmbeddings/natalia.ts
import { extractMainIdea } from "../../ai/mainIdeaExtractor";
import {
  getPostsWithoutMainIdea,
  getPostsWithoutEmbedding,
  updateMainIdeaAndEmbedding,
  updateEmbedding,
} from "../../repositories/nataliaPostRepository";
import { processEmbeddingsBatch } from "../../services/nataliaPost/embeddingProcessor";

async function main(): Promise<void> {
  // ──────────────────────────────────────────────────────────
  // Режим 1: посты без mainIdea
  // ──────────────────────────────────────────────────────────
  const postsWithoutMainIdea = await getPostsWithoutMainIdea();

  if (postsWithoutMainIdea.length > 0) {
    // Шаг 1: извлекаем mainIdea через LLM (последовательно)
    const items1 = [];
    for (const post of postsWithoutMainIdea) {
      try {
        const mainIdea = await extractMainIdea(post.text);
        items1.push({ id: post.id, text: mainIdea, originalMainIdea: mainIdea });
      } catch (error) {
        console.error(`❌ Ошибка извлечения mainIdea для ${post.id}`);
      }
    }

    // Шаг 2: генерируем embeddings параллельно
    const mainIdeasMap = new Map(items1.map((i) => [i.id, i.originalMainIdea]));

    await processEmbeddingsBatch({
      items: items1,
      saveEmbedding: async (id, embedding) => {
        const mainIdea = mainIdeasMap.get(id)!;
        await updateMainIdeaAndEmbedding(id, mainIdea, embedding);
      },
      onProgress: (processed) => progress1.update(processed),
    });
  }

  // ──────────────────────────────────────────────────────────
  // Режим 2: посты с mainIdea, но без embedding
  // ──────────────────────────────────────────────────────────
  const postsWithoutEmbedding = await getPostsWithoutEmbedding();

  if (postsWithoutEmbedding.length > 0) {
    await processEmbeddingsBatch({
      items: postsWithoutEmbedding.map((p) => ({ id: p.id, text: p.mainIdea })),
      saveEmbedding: updateEmbedding,
      onProgress: (processed) => progress2.update(processed),
    });
  }
}
```

**Почему два режима:**
- Режим 1 нужен для первого запуска на базе, где mainIdea ещё нет (комбинирует extractMainIdea + createEmbedding)
- Режим 2 — оптимизация для случая, когда mainIdea уже извлечена, но embedding пропущен (например, после сбоя)

Оба режима выполняются за один запуск, скрипт автоматически определяет, какие посты нуждаются в обработке.

## 5. Поток данных

### Режим 1 (посты без mainIdea):

```
npm run generate:embeddings:natalia
  ↓
getPostsWithoutMainIdea()
  ↓
for each post:
  extractMainIdea(post.text) → mainIdea
  ↓
processEmbeddingsBatch([{id, text: mainIdea}])
  ↓
10 параллельных воркеров:
  createEmbedding(mainIdea) → embedding (1536 чисел)
  ↓
  updateMainIdeaAndEmbedding(id, mainIdea, embedding)
    ↓
    prisma.$executeRaw (UPDATE ... SET mainIdea, embedding)
```

### Режим 2 (посты с mainIdea, без embedding):

```
npm run generate:embeddings:natalia
  ↓
getPostsWithoutEmbedding()
  ↓
processEmbeddingsBatch([{id, text: mainIdea}])
  ↓
10 параллельных воркеров:
  createEmbedding(mainIdea) → embedding
  ↓
  updateEmbedding(id, embedding)
    ↓
    prisma.$executeRaw (UPDATE ... SET embedding)
```

## 6. Почему так, а не иначе

1. **Raw SQL вместо Prisma Client** — Prisma не поддерживает `vector` тип нативно. Через `$executeRaw` работаем напрямую с PostgreSQL, передаём вектор как строку `[1.2, 3.4, ...]::vector`. Альтернатива (драйвер адаптер) требует дополнительных зависимостей.

2. **Отдельный модуль `embeddings.ts`, а не расширение `mainIdeaExtractor.ts`** — это разные API: `mainIdeaExtractor` использует chat completions (GPT-4o-mini), `embeddings` использует Embeddings API (text-embedding-3-small). Разная логика обработки ответов, разные модели, разные цены.

3. **Generic батч-процессор с callback `saveEmbedding`** — через неделю нужно будет добавить embeddings для таблицы `Idea`. С callback'ом просто передадим другую функцию сохранения (`updateIdeaEmbedding`), не меняя логику параллелизма.

4. **Concurrency 10, а не 3 как у mainIdeaProcessor** — Embeddings API быстрый (3000 req/min лимит), можно больше параллельных запросов. mainIdeaExtractor использует rate-limiting из-за GPT-4o-mini limits.

5. **Два режима в одном скрипте, а не два отдельных** — удобнее для пользователя: запускаешь одну команду, она сама смотрит, что нужно обработать. Если база пустая — отработает режим 1. Если mainIdea уже есть — только режим 2. Если всё готово — выведет "✅ Все посты обработаны".

## Преимущества

- ✅ Векторное представление mainIdea для быстрой дедупликации через pgvector (cosine similarity)
- ✅ Generic design — процессор и модуль embeddings переиспользуются для `Idea` без изменений
- ✅ Умный скрипт: автоматически определяет режим обработки, не нужно вручную выбирать
- ✅ Параллелизм 10 воркеров — быстрая обработка больших объёмов без блокировок
- ✅ Graceful shutdown — прерывание скрипта (Ctrl+C) не теряет уже сохранённые embeddings
- ✅ Детальная статистика и прогресс-бары — видно, сколько обработано, сколько упало
- ✅ Ошибки не блокируют обработку — один упавший пост не останавливает остальные 1000
