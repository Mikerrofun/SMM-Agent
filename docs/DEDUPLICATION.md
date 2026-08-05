---

**Дата:** 06.08.2026  
**Теги:** #features #deduplication #pgvector #embeddings

---

## 1. Зачем

До этой фичи система генерировала идеи из постов конкурентов через LLM, но могла предложить Наталье дублирующиеся идеи — либо похожие друг на друга, либо уже опубликованные ею ранее. Без векторного поиска дедупликация была бы дорогой (каждое сравнение через LLM) или примитивной (текстовое сравнение пропускает семантические дубли). Нужен механизм, который один раз сравнивает embeddings через pgvector cosine similarity и помечает дубликаты до отправки пользователю. Эта же инфраструктура позже применится к другим модулям, где нужна проверка на уникальность контента.

## 2. Где/что уже было

Переиспользуется существующая инфраструктура:

- **Embeddings** — генерируются в `ideaProcessor.ts` при создании идеи (поле `Idea.embedding` уже заполнено)
- **Embeddings для постов Натальи** — созданы скриптом `generate:embeddings:natalia`, хранятся в `NataliaPost.embedding`
- **pgvector** — расширение PostgreSQL уже установлено, паттерн raw SQL для vector типа существует в `nataliaPostRepository.ts` (методы `updateEmbedding`, `getPostsWithoutEmbedding`)
- **ProgressBar** — переиспользован из `src/shared/utils/progressBar.ts`
- **Паттерн CLI скрипта** — скопирован из `competitorPostsToIdeas.ts` (статистика, graceful shutdown, детальный вывод)

Задача была не писать новую архитектуру для векторного поиска, а использовать существующие embeddings и raw SQL паттерн из репозитория постов Натальи.

## 3. Реализация

### Типы и конфиг

```ts
// src/shared/types/idea.types.ts
export interface IdeaWithEmbedding {
  id: string;
  embedding: string;    // PostgreSQL возвращает vector как строку
  createdAt: Date;
}

export type DuplicateOfType = 'idea' | 'nataliaPost';
```

```ts
// src/services/idea/deduplication.config.ts
export const SIMILARITY_THRESHOLD = 0.85;  // cosine similarity порог
export const DEDUPLICATION_STRATEGY = 'first' as const;  // оставляем самую старую
```

### Repository методы

```ts
// src/repositories/ideaRepository.ts (добавлено 3 метода)

// 1. Получить NEW идеи с embeddings
export async function getNewIdeasWithEmbeddings(): Promise<IdeaWithEmbedding[]> {
  const result = await prisma.$queryRaw<IdeaWithEmbedding[]>`
    SELECT id, embedding::text, "createdAt"
    FROM "Idea"
    WHERE status = 'NEW' AND embedding IS NOT NULL
    ORDER BY "createdAt" ASC
  `;
  return result;
}

// 2. Найти похожие идеи через pgvector (статусы NEW + SENT захардкожены в SQL)
export async function findSimilarIdeas(
  embedding: number[],
  threshold: number,
  excludeId: string
): Promise<SimilarityMatch[]> {
  const vectorLiteral = `[${embedding.join(',')}]`;
  
  const result = await prisma.$queryRaw<...>`
    SELECT 
      id,
      (1 - (embedding <=> ${vectorLiteral}::vector)) AS similarity,
      "createdAt"
    FROM "Idea"
    WHERE embedding IS NOT NULL
      AND status = ANY(ARRAY['NEW', 'SENT']::"IdeaStatus"[])
      AND id != ${excludeId}
      AND (1 - (embedding <=> ${vectorLiteral}::vector)) >= ${threshold}
    ORDER BY "createdAt" ASC
  `;
  
  return result.map(row => ({
    id: row.id,
    similarity: Number(row.similarity),
    createdAt: row.createdAt,
  }));
}

// 3. Пометить как дубликат
export async function markAsDuplicate(
  ideaId: string,
  duplicateOfType: DuplicateOfType,
  duplicateOfId: string,
  similarity: number
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Idea"
    SET status = 'DUPLICATE',
        "duplicateOfType" = ${duplicateOfType},
        "duplicateOfId" = ${duplicateOfId},
        similarity = ${similarity}
    WHERE id = ${ideaId}
  `;
}
```

```ts
// src/repositories/nataliaPostRepository.ts (добавлен 1 метод)

export async function findSimilarNataliaPosts(
  embedding: number[],
  threshold: number
): Promise<SimilarityMatch[]> {
  const vectorLiteral = `[${embedding.join(',')}]`;
  
  const result = await prisma.$queryRaw<...>`
    SELECT 
      id,
      (1 - (embedding <=> ${vectorLiteral}::vector)) AS similarity,
      "mainIdea"
    FROM "NataliaPost"
    WHERE embedding IS NOT NULL
      AND (1 - (embedding <=> ${vectorLiteral}::vector)) >= ${threshold}
    ORDER BY similarity DESC
    LIMIT 1
  `;
  
  return result.map(row => ({ id: row.id, similarity: Number(row.similarity) }));
}
```

### Сервис дедупликации

```ts
// src/services/idea/deduplicationService.ts
export async function deduplicateIdeas(
  options?: DeduplicateIdeasOptions
): Promise<DeduplicationStats> {
  const { onProgress } = options ?? {};
  const stats = { total: 0, unique: 0, duplicates: 0, ... };
  
  // 1. Получить NEW идеи с embeddings
  const ideas = await getNewIdeasWithEmbeddings();
  stats.total = ideas.length;
  
  // 2. Для каждой идеи последовательно
  for (let i = 0; i < ideas.length; i++) {
    const idea = ideas[i];
    const embeddingArray = parseEmbeddingString(idea.embedding);
    
    try {
      // 2a. Проверка Idea vs Idea
      const similarIdeas = await findSimilarIdeas(
        embeddingArray,
        SIMILARITY_THRESHOLD,
        idea.id
      );
      
      if (similarIdeas.length > 0) {
        const match = similarIdeas[0];  // самая старая по createdAt
        await markAsDuplicate(idea.id, 'idea', match.id, match.similarity);
        stats.duplicates++;
        stats.duplicatesWithIdeas++;
        onProgress?.(i + 1, ideas.length);
        continue;
      }
      
      // 2b. Проверка Idea vs NataliaPost
      const similarPosts = await findSimilarNataliaPosts(
        embeddingArray,
        SIMILARITY_THRESHOLD
      );
      
      if (similarPosts.length > 0) {
        const match = similarPosts[0];
        await markAsDuplicate(idea.id, 'nataliaPost', match.id, match.similarity);
        stats.duplicates++;
        stats.duplicatesWithNataliaPosts++;
        onProgress?.(i + 1, ideas.length);
        continue;
      }
      
      // 2c. Уникальна
      stats.unique++;
      
    } catch (error) {
      stats.failed++;
      stats.failedItems.push({ id: idea.id, error: error.message });
    }
    
    onProgress?.(i + 1, ideas.length);
  }
  
  return stats;
}
```

Остальная логика идей не изменилась — генерация через `ideaProcessor.ts` работает как прежде, дедупликация — отдельный этап после сохранения в БД.

## 4. Поток данных

```
npm run deduplicate:ideas
  ↓
run.ts (CLI, инициализирует ProgressBar)
  ↓
deduplicateIdeas({ onProgress: (current, total) => progress.update(current) })
  ↓
getNewIdeasWithEmbeddings() → массив NEW идей с embeddings
  ↓
for каждой идеи:
  ↓
  parseEmbeddingString(idea.embedding) → number[]
  ↓
  findSimilarIdeas(embedding, 0.85, idea.id)
    ↓
    PostgreSQL: SELECT ... WHERE (1 - (embedding <=> $vector)) >= 0.85
    ↓
    return SimilarityMatch[] (отсортировано по createdAt ASC)
  ↓
  if matches.length > 0:
    markAsDuplicate(idea.id, 'idea', match.id, similarity)
      ↓
      PostgreSQL: UPDATE "Idea" SET status='DUPLICATE', ...
    ↓
    stats.duplicates++
    ↓
    onProgress(current, total) → ProgressBar.update()
    ↓
    continue
  ↓
  findSimilarNataliaPosts(embedding, 0.85)
    ↓
    PostgreSQL: SELECT ... ORDER BY similarity DESC LIMIT 1
  ↓
  if matches.length > 0:
    markAsDuplicate(idea.id, 'nataliaPost', match.id, similarity)
    ↓
    stats.duplicates++
    ↓
    continue
  ↓
  stats.unique++
  ↓
return DeduplicationStats
  ↓
CLI выводит статистику (total, unique, duplicates, failed)
```

## 5. Почему так, а не иначе

1. **Raw SQL вместо Prisma Client** — Prisma не поддерживает `vector(1536)` тип нативно (в схеме это `Unsupported`). Через `$queryRaw`/`$executeRaw` работаем напрямую с PostgreSQL, передаём вектор как строку `[1.2,3.4,...]::vector`. Альтернатива (драйвер адаптер) требует дополнительных зависимостей, а паттерн raw SQL уже был в `nataliaPostRepository.ts`.

2. **Статусы NEW + SENT захардкожены в SQL, а не через параметр** — эти статусы фиксированы по бизнес-логике (NEW идеи проверяются против NEW + SENT). Параметр `statuses` был лишний — его убрали, конфигурация теперь в SQL запросе. В будущем, если понадобится гибкость, можно вернуть параметр, но сейчас это overengineering.

3. **Последовательная обработка, а не параллельная** — нет внешних API вызовов (только БД операции), поэтому worker pool не нужен. Упрощает код и избегает race conditions при множественных UPDATE одних и тех же идей.

4. **onProgress вынесен в типы** — используется для ProgressBar в CLI. Callback вызывается после проверки каждой идеи: `onProgress(current, total)` → `ProgressBar.update(current)`. Поток: CLI создаёт ProgressBar → передаёт callback в сервис → сервис дёргает после каждой итерации → ProgressBar обновляет визуальную полоску в терминале.

5. **`DuplicateOfType` в `idea.types.ts`, а не в `deduplication.types.ts`** — тип переиспользуется в repository методах (`markAsDuplicate`) и в схеме БД. Общий тип лежит в shared/types, специфичные для дедупликации (`SimilarityMatch`, `DeduplicationStats`) — в сервисном модуле.

6. **Два этапа проверки (Idea → NataliaPost), а не параллельный поиск** — приоритет: сначала ищем дубли среди идей (быстрее, меньше записей), потом — среди постов Натальи. Первый найденный дубликат прерывает проверку для идеи (continue). Это оптимизация: если идея — дубль другой идеи, нет смысла проверять посты Натальи.

## Преимущества

- ✅ Векторный поиск через pgvector — дешевле и быстрее, чем LLM для каждого сравнения
- ✅ Graceful error handling — одна ошибка не роняет весь батч (stats.failedItems)
- ✅ Переиспользуются embeddings из существующего pipeline (ничего заново не генерируется)
- ✅ Детальная статистика (unique, duplicates с разбивкой по типам, failed)
- ✅ Гибкая конфигурация (порог similarity, стратегия выбора "победителя")
- ✅ Прогресс-бар в CLI — видно, сколько обработано в реальном времени
- ✅ Репозиторий паттерн — логика векторного поиска инкапсулирована, легко протестировать
