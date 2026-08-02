---

**Дата:** 03.08.2026

**Теги:** #features #embeddings #ideas #ai

---

## 1. Зачем

Идеи генерируются из постов конкурентов через LLM, но без векторного представления (embedding) их невозможно сравнивать с постами Натальи и между собой. Дедупликация — ключевая задача, чтобы не предлагать Наталье то, что она уже публиковала или что уже есть в списке идей. 

Embedding должен создаваться сразу при генерации идеи, а не постфактум. Если embedding не создался — идея бесполезна, её не нужно сохранять. Транзакционность критична: либо полная идея с вектором, либо ничего.

## 2. Где/что уже было

**Инфраструктура embeddings:**
- `src/ai/embeddings.ts` — функция `createEmbedding(text)` возвращает `number[]` (1536 измерений)
- `Idea.embedding` — поле `Unsupported("vector(1536)")` в Prisma схеме
- Референс работы с pgvector в `nataliaPostRepository.ts`:

```ts
// src/repositories/nataliaPostRepository.ts
export async function updateMainIdeaAndEmbedding(
  id: string,
  mainIdea: string,
  embedding: number[]
): Promise<void> {
  const vectorLiteral = `[${embedding.join(",")}]`;
  
  await prisma.$executeRaw`
    UPDATE "NataliaPost"
    SET "mainIdea" = ${mainIdea}, embedding = ${vectorLiteral}::vector
    WHERE id = ${id}
  `;
}
```

**Retry механизм:**
- `src/shared/utils/retry.ts` — `withRetry()` с exponential backoff
- `IDEA_RETRY_CONFIG` — 3 попытки, backoffFactor: 2, delayMs: 1000

**Паттерн обработки ошибок:**
- `src/shared/telegram/errors.ts` — классы с `cause`, наследование, `Error.captureStackTrace`

Задача была не писать новую инфраструктуру, а интегрировать генерацию embedding в существующий процессор идей (`ideaProcessor.ts`).

## 3. Реализация

### 3.1 Типизированные ошибки

```ts
// src/services/idea/errors.ts
export class IdeaProcessError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'IdeaProcessError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class IdeaExtractionError extends IdeaProcessError {}
export class EmbeddingGenerationError extends IdeaProcessError {}
export class IdeaSaveError extends IdeaProcessError {}

export function formatIdeaProcessError(
  error: unknown,
  stage: 'extractIdea' | 'embedding' | 'save',
  postId: string
): string {
  let message: string;
  let causedBy = '';

  if (error instanceof IdeaProcessError) {
    message = error.message;
    if (error.cause) {
      causedBy = ` (caused by: ${error.cause.message})`;
    }
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }

  return `[${stage}] ${postId}: ${message}${causedBy}`;
}
```

### 3.2 Расширение типов

```ts
// src/types/idea.types.ts
export interface CreateIdeaInput {
  competitorPostId: string;
  title: string;
  mainIdea: string;
  goal: string;
  embedding: number[]; // ОБЯЗАТЕЛЬНОЕ поле
}
```

```ts
// src/services/idea/ideaProcessor.types.ts
export interface FailedItem {
  id: string;
  stage: 'extractIdea' | 'embedding' | 'save'; // NEW
  error: string;
}
```

### 3.3 Repository — raw SQL для pgvector

```ts
// src/repositories/ideaRepository.ts
export async function createIdeaAndMarkProcessed(
  data: CreateIdeaInput
): Promise<IdeaModel> {
  return prisma.$transaction(async (tx) => {
    const vectorLiteral = `[${data.embedding.join(',')}]`;
    
    const result = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "Idea" (
        id, "competitorPostId", title, "mainIdea", goal,
        embedding, status, "createdAt"
      )
      VALUES (
        gen_random_uuid(), ${data.competitorPostId},
        ${data.title}, ${data.mainIdea}, ${data.goal},
        ${vectorLiteral}::vector, 'NEW', NOW()
      )
      RETURNING id
    `;
    
    const ideaId = result[0].id;
    
    await tx.competitorPost.update({
      where: { id: data.competitorPostId },
      data: { isProcessed: true },
    });
    
    const createdIdea = await tx.idea.findUnique({
      where: { id: ideaId },
    });
    
    if (!createdIdea) {
      throw new Error('Failed to retrieve created idea');
    }
    
    return createdIdea;
  });
}
```

Prisma не поддерживает `vector` тип нативно, поэтому используется `$queryRaw` с приведением `::vector`. Все параметры параметризованы через Prisma template literals (защита от SQL injection). `gen_random_uuid()` генерирует id как в Prisma с `@default(cuid())`.

### 3.4 Процессор — три этапа с retry

```ts
// src/services/idea/ideaProcessor.ts
async function processItem(item: IdeaProcessItem): Promise<void> {
  let stage: 'extractIdea' | 'embedding' | 'save' = 'extractIdea';
  
  try {
    // ЭТАП 1: Генерация идеи через LLM
    stage = 'extractIdea';
    const idea = await withRetry(
      async () => {
        try {
          return await extractIdea(item.text);
        } catch (err) {
          throw new IdeaExtractionError(
            `Failed to extract idea from post ${item.id}`,
            err instanceof Error ? err : undefined
          );
        }
      },
      IDEA_RETRY_CONFIG
    );

    // ЭТАП 2: Генерация embedding от mainIdea
    stage = 'embedding';
    const embedding = await withRetry(
      async () => {
        try {
          return await createEmbedding(idea.mainIdea);
        } catch (err) {
          throw new EmbeddingGenerationError(
            `Failed to create embedding for idea from post ${item.id}`,
            err instanceof Error ? err : undefined
          );
        }
      },
      IDEA_RETRY_CONFIG
    );

    // ЭТАП 3: Сохранение в БД
    stage = 'save';
    try {
      await createIdeaAndMarkProcessed({
        competitorPostId: item.id,
        ...idea,
        embedding,
      });
    } catch (err) {
      throw new IdeaSaveError(
        `Failed to save idea for post ${item.id}`,
        err instanceof Error ? err : undefined
      );
    }

    stats.succeeded++;
  } catch (error) {
    stats.failed++;
    stats.failedItems.push({
      id: item.id,
      stage,
      error: formatIdeaProcessError(error, stage, item.id),
    });
  } finally {
    processed++;
    onProgress?.(processed, items.length);
  }
}
```

Worker pool и rate limiting не тронуты — продолжают работать через `intervalMs` и `lastStart`. Логика параллелизма осталась прежней.

## 4. UI (если применимо)

CLI-скрипт обновлён для отображения stage в логах:

```ts
// src/scripts/generateIdeas/competitorPostsToIdeas.ts
if (stats.failed > 0) {
  console.log('\n⚠️  Не удалось обработать:');
  for (const item of stats.failedItems) {
    console.log(`   • ${item.id} [${item.stage}]: ${item.error}`);
  }
  
  // Группировка ошибок по этапам
  const byStage = stats.failedItems.reduce((acc, item) => {
    acc[item.stage] = (acc[item.stage] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log('\n📊 Ошибки по этапам:');
  for (const [stage, count] of Object.entries(byStage)) {
    console.log(`   ${stage}: ${count}`);
  }
}
```

## 5. Поток данных

```
Запуск скрипта
↓
processIdeaBatch(items) → worker pool с rate limiting
↓
processItem(post)
↓
STAGE 1: withRetry(() => extractIdea(post.text)) → LLM (3 попытки)
↓
STAGE 2: withRetry(() => createEmbedding(idea.mainIdea)) → OpenAI Embeddings (3 попытки)
↓
STAGE 3: createIdeaAndMarkProcessed({...idea, embedding})
↓
prisma.$transaction(
  $queryRaw INSERT with ::vector
  + competitorPost.update(isProcessed: true)
)
↓
stats.succeeded++ / stats.failed++ с stage
↓
onProgress(processed, total)
```

## 6. Почему так, а не иначе

1. **Raw SQL вместо Prisma ORM** — Prisma не поддерживает `vector` тип и оператор `<=>` нативно. Референс из `nataliaPostRepository.ts` показал рабочий паттерн с `$queryRaw` и template literals для безопасной параметризации.

2. **Обязательное поле `embedding`, а не опциональное** — по требованиям идея без embedding бесполезна для дедупликации. TypeScript защищает от случайного вызова `createIdeaAndMarkProcessed()` без вектора. Все идеи в БД всегда в консистентном состоянии.

3. **Retry для обоих AI-вызовов с одинаковым конфигом** — и LLM, и embeddings API нестабильны (rate limits, таймауты). Единая стратегия retry (3 попытки, exponential backoff) обеспечивает стабильность. Использован существующий `IDEA_RETRY_CONFIG`.

4. **Типизированная иерархия ошибок** — следует паттерну `telegram/errors.ts`. Поле `cause` сохраняет оригинальную ошибку, `formatIdeaProcessError()` строит читаемое сообщение с контекстом. В логах сразу видно, на каком этапе и почему упало.

## Преимущества

- ✅ Атомарность: либо полная идея с embedding, либо пост остаётся `isProcessed=false` для повторной обработки
- ✅ Type safety: TypeScript не даст создать идею без embedding
- ✅ Observability: stage в логах показывает, где больше всего проблем (LLM / embeddings API / DB)
- ✅ Retry с exponential backoff защищает от временных сбоев API
- ✅ Цепочка ошибок через `cause` — детальная отладка без потери контекста
- ✅ Consistency: все идеи в БД всегда готовы к дедупликации, нет "битых" записей
- ✅ Переиспользование: embeddings инфраструктура, retry, pgvector паттерн — всё уже было готово
