

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

**ВАЖНО (обновлено 03.09.2026):** После рефакторинга унификации типы переехали в `shared/deduplication.types.ts`, а пороги в `shared/deduplication.config.ts`. См. документ `UPDATE_DEDUPLICATION.md` для деталей.

```ts
// src/shared/deduplication.types.ts
export type DuplicateSource = 'idea' | 'nataliaPost' | 'transcriptPost';

// SimilarityMatch — формат данных, который возвращают все repository функции
export interface SimilarityMatch {
  readonly id: string;           // ID найденного похожего контента
  readonly similarity: number;   // Значение cosine similarity (от 0 до 1)
  readonly createdAt?: Date;     // Дата создания (опционально, для сортировки)
}

// SimilaritySource — wrapper для передачи в resolver
export interface SimilaritySource {
  source: DuplicateSource;       // Тип источника данных
  matches: SimilarityMatch[];    // Массив совпадений (отсортированы по similarity DESC)
}

// ResolvedSimilarity — результат работы resolver
export interface ResolvedSimilarity {
  maxSimilarity: number;         // Максимальная similarity среди всех источников
  source: DuplicateSource | null; // Источник с максимальной similarity (null если нет дублей)
  matchedId: string | null;      // ID контента-дубля (null если нет дублей)
}
```

```ts
// src/shared/deduplication.config.ts
export const DEDUPLICATION_THRESHOLDS = {
  nataliaPost: 0.75,      // Проверка против постов Натальи
  crossContent: 0.80,     // Проверка Ideas ↔ TranscriptPosts
  sameType: 0.75,         // Проверка внутри одного типа (Idea vs Idea)
} as const;
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

  

// 4. Записать максимальную similarity для уникальной идеи

export async function updateMaxSimilarity(

ideaId: string,

similarity: number

): Promise<void> {

await prisma.$executeRaw`

UPDATE "Idea"

SET similarity = ${similarity}

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

**КЛЮЧЕВАЯ ЛОГИКА:** Как работает проверка на дубли с несколькими источниками данных

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
      await withRetry(async () => {
        // ═══════════════════════════════════════════════════════════
        // ШАГ 1: Запросить совпадения из ВСЕХ источников (threshold=0)
        // ═══════════════════════════════════════════════════════════
        // ВАЖНО: передаём threshold=0, чтобы получить ВСЕ совпадения
        // Фильтрация по реальному порогу будет в resolveBestMatch
        
        const [ideaMatches, nataliaMatches, transcriptMatches] = await Promise.all([
          findSimilarIdeas(embeddingArray, 0, idea.id),
          // ↑ Возвращает SimilarityMatch[] — похожие ИДЕИ
          // Формат: [{ id: 'uuid', similarity: 0.92, createdAt: Date }, ...]
          // SQL: WHERE status IN ('NEW','SENT') AND id != excludeId
          
          findSimilarNataliaPosts(embeddingArray, 0),
          // ↑ Возвращает SimilarityMatch[] — похожие ПОСТЫ НАТАЛЬИ
          // Формат: [{ id: 'uuid', similarity: 0.87 }, ...]
          // SQL: все записи из NataliaPost с embedding
          
          findSimilarPostsForIdeas(embeddingArray, 0),
          // ↑ Возвращает SimilarityMatch[] — похожие ТРАНСКРИПТ-ПОСТЫ
          // Формат: [{ id: 'uuid', similarity: 0.78 }, ...]
          // SQL: WHERE status='SENT' (только опубликованные)
        ]);

        // ═══════════════════════════════════════════════════════════
        // ШАГ 2: Обернуть результаты в SimilaritySource
        // ═══════════════════════════════════════════════════════════
        // Каждый массив матчей нужно связать с типом источника
        // Это нужно resolver'у для применения правильных порогов
        
        const { maxSimilarity, source, matchedId } = resolveBestMatch('idea', [
          { source: 'idea', matches: ideaMatches },
          // ↑ ПРАВИЛЬНО: ideaMatches содержит результаты findSimilarIdeas
          
          { source: 'nataliaPost', matches: nataliaMatches },
          // ↑ ПРАВИЛЬНО: nataliaMatches содержит результаты findSimilarNataliaPosts
          
          { source: 'transcriptPost', matches: transcriptMatches },
          // ↑ ПРАВИЛЬНО: transcriptMatches содержит результаты findSimilarPostsForIdeas
        ]);

        // ═══════════════════════════════════════════════════════════
        // ШАГ 3: Что делает resolveBestMatch?
        // ═══════════════════════════════════════════════════════════
        // 1. Проходит по ВСЕМ источникам (idea, nataliaPost, transcriptPost)
        // 2. Для каждого источника берёт matches[0] (лучшее совпадение)
        // 3. Через getThreshold(targetSource='idea', checkAgainstSource) 
        //    определяет нужный порог:
        //    - 'idea' vs 'nataliaPost'      → 0.75 (nataliaPost)
        //    - 'idea' vs 'transcriptPost'   → 0.80 (crossContent)
        //    - 'idea' vs 'idea'             → 0.75 (sameType)
        // 4. Если similarity >= порога И больше текущего максимума:
        //    - Обновляет maxSimilarity
        //    - Запоминает source и matchedId
        // 5. Возвращает результат:
        //    - maxSimilarity: 0.92 (максимальное значение среди всех)
        //    - source: 'idea' (откуда пришло максимальное совпадение)
        //    - matchedId: 'uuid-123' (ID контента-дубля)
        //    - ЕСЛИ ничего не прошло порог → source=null, matchedId=null

        // ═══════════════════════════════════════════════════════════
        // ШАГ 4: Принять решение — дубликат или уникальный контент
        // ═══════════════════════════════════════════════════════════
        const isDuplicate = source !== null && matchedId !== null;

        if (isDuplicate && source && matchedId) {
          // Найден дубль выше порога → помечаем как DUPLICATE
          await markAsDuplicate(idea.id, source, matchedId, maxSimilarity);
          stats.duplicates++;
          
          if (source === 'idea') {
            stats.duplicatesWithIdeas++;
          } else if (source === 'nataliaPost') {
            stats.duplicatesWithNataliaPosts++;
          } else if (source === 'transcriptPost') {
            stats.duplicatesWithTranscriptPosts++;
          }
        } else {
          // Дубль НЕ найден, но записываем maxSimilarity для аналитики
          // Это позволит увидеть "почти дубли" (например, similarity=0.73)
          if (maxSimilarity > 0) {
            await updateMaxSimilarity(idea.id, maxSimilarity);
          }
          stats.unique++;
        }
      }, DEDUPLICATION_RETRY_CONFIG);

    } catch (error) {
      stats.failed++;
      stats.failedItems.push({ id: idea.id, error: error.message });
    }

    onProgress?.(i + 1, ideas.length);
  }

  return stats;
}
```

### Детально: Как работает resolveBestMatch

```ts
// src/services/shared/similarityResolver.ts
export function resolveBestMatch(
  targetSource: DuplicateSource,  // 'idea' — что проверяем
  sources: Array<SimilaritySource> // Массив источников для проверки
): ResolvedSimilarity {
  let maxSimilarity = 0;
  let source: DuplicateSource | null = null;
  let matchedId: string | null = null;

  // Проходим по всем источникам
  for (const candidate of sources) {
    // Берём ЛУЧШЕЕ совпадение из массива (первое, т.к. отсортировано DESC)
    const best = candidate.matches[0];
    
    if (!best) {
      continue; // Нет совпадений в этом источнике
    }

    // ═══════════════════════════════════════════════════════════════
    // ШАГ 1: Обновляем maxSimilarity для ВСЕХ совпадений (для аналитики)
    // ═══════════════════════════════════════════════════════════════
    // Даже если similarity ниже порога, записываем её для аналитики
    if (best.similarity > maxSimilarity) {
      maxSimilarity = best.similarity;
    }

    // ═══════════════════════════════════════════════════════════════
    // ШАГ 2: Проверяем порог для определения дубликата
    // ═══════════════════════════════════════════════════════════════
    const threshold = getThreshold(targetSource, candidate.source);
    // Пример:
    // targetSource='idea', candidate.source='nataliaPost' → threshold=0.75
    // targetSource='idea', candidate.source='transcriptPost' → threshold=0.80
    // targetSource='idea', candidate.source='idea' → threshold=0.75

    // Только если >= порога — считаем это дублем
    if (best.similarity >= threshold && best.similarity > 0) {
      source = candidate.source;
      matchedId = best.id;
    }
  }

  return { maxSimilarity, source, matchedId };
}
```

**Пример работы:**

Допустим, проверяем идею с embedding = [0.1, 0.2, ..., 0.9]

**1. SQL запросы возвращают:**
```
ideaMatches = [
  { id: 'idea-123', similarity: 0.60 },  // ниже порога 0.75
]

nataliaMatches = [
  { id: 'natalia-789', similarity: 0.73 }  // ниже порога 0.75
]

transcriptMatches = [
  { id: 'transcript-321', similarity: 0.68 }  // ниже порога 0.80
]
```

**2. Вызываем resolver:**
```ts
resolveBestMatch('idea', [
  { source: 'idea', matches: ideaMatches },
  { source: 'nataliaPost', matches: nataliaMatches },
  { source: 'transcriptPost', matches: transcriptMatches },
])
```

**3. Resolver проходит по источникам:**

**Итерация 1:** `candidate.source = 'idea'`
- `best = ideaMatches[0]` → `{ id: 'idea-123', similarity: 0.60 }`
- **ШАГ 1:** `0.60 > 0` → обновляем `maxSimilarity=0.60`
- **ШАГ 2:** `threshold = getThreshold('idea', 'idea')` → `0.75`
- `0.60 >= 0.75` → **❌ FALSE** (не дубль)
- `source` и `matchedId` остаются `null`

**Итерация 2:** `candidate.source = 'nataliaPost'`
- `best = nataliaMatches[0]` → `{ id: 'natalia-789', similarity: 0.73 }`
- **ШАГ 1:** `0.73 > 0.60` → обновляем `maxSimilarity=0.73`
- **ШАГ 2:** `threshold = getThreshold('idea', 'nataliaPost')` → `0.75`
- `0.73 >= 0.75` → **❌ FALSE** (не дубль)
- `source` и `matchedId` остаются `null`

**Итерация 3:** `candidate.source = 'transcriptPost'`
- `best = transcriptMatches[0]` → `{ id: 'transcript-321', similarity: 0.68 }`
- **ШАГ 1:** `0.68 > 0.73` → **❌ FALSE** (не обновляем, т.к. меньше текущего макс)
- **ШАГ 2:** `threshold = getThreshold('idea', 'transcriptPost')` → `0.80`
- `0.68 >= 0.80` → **❌ FALSE** (не дубль)
- `source` и `matchedId` остаются `null`

**4. Результат:**
```ts
{
  maxSimilarity: 0.73,   // Максимальное значение среди всех источников
  source: null,          // Нет дублей (все ниже порогов)
  matchedId: null
}
```

**5. Принятие решения:**
- `isDuplicate = false` (source === null)
- Вызываем `updateMaxSimilarity(currentIdeaId, 0.73)` ← **записывается для аналитики!**
- `stats.unique++`

**Важно:** Теперь даже если все similarity ниже порогов, `maxSimilarity` всё равно записывается в БД. Это позволяет анализировать "почти дубли" и корректировать пороги.

  

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

2. **Threshold=0 в SQL, фильтрация по порогу в JS** — Все repository функции (`findSimilarIdeas`, `findSimilarNataliaPosts`, `findSimilarPostsForIdeas`) получают `threshold=0` и возвращают ВСЕ совпадения. Реальный порог применяется в `resolveBestMatch` через `getThreshold()`. Причины:
   - **Дифференцированные пороги:** разные пары источников требуют разные пороги (Ideas ↔ TranscriptPosts = 0.80, Ideas ↔ Ideas = 0.75)
   - **Аналитика:** записываем `maxSimilarity` даже для уникального контента (similarity < порога), чтобы видеть "почти дубли"
   - **Единое место логики:** все пороги живут в `DEDUPLICATION_THRESHOLDS` + `thresholdResolver`, а не размазаны по SQL запросам

3. **Последовательная обработка, а не параллельная** — нет внешних API вызовов (только БД операции), поэтому worker pool не нужен. Упрощает код и избегает race conditions при множественных UPDATE одних и тех же идей.

4. **onProgress вынесен в типы** — используется для ProgressBar в CLI. Callback вызывается после проверки каждой идеи: `onProgress(current, total)` → `ProgressBar.update(current)`. Поток: CLI создаёт ProgressBar → передаёт callback в сервис → сервис дёргает после каждой итерации → ProgressBar обновляет визуальную полоску в терминале.

5. **Правильный порядок переменных при деструктуризации** — `[ideaMatches, nataliaMatches, transcriptMatches]` ДОЛЖНЫ совпадать с порядком вызовов `[findSimilarIdeas, findSimilarNataliaPosts, findSimilarPostsForIdeas]`. Иначе типы источников перепутаются и пороги применятся к неправильным данным (см. bugfix 03.09.2026 в `UPDATE_DEDUPLICATION.md`).

6. **resolveBestMatch принимает targetSource** — нужен для `getThreshold(target, source)`, чтобы определить правильный порог для каждой пары источников. Например, проверка `'idea'` против `'transcriptPost'` использует порог 0.80, а против `'nataliaPost'` — 0.75.

  

## Преимущества

- ✅ Векторный поиск через pgvector — дешевле и быстрее, чем LLM для каждого сравнения
- ✅ Graceful error handling — одна ошибка не роняет весь батч (stats.failedItems)
- ✅ Переиспользуются embeddings из существующего pipeline (ничего заново не генерируется)
- ✅ Детальная статистика (unique, duplicates с разбивкой по типам, failed)
- ✅ Гибкая конфигурация (дифференцированные пороги через `thresholdResolver`)
- ✅ Прогресс-бар в CLI — видно, сколько обработано в реальном времени
- ✅ Репозиторий паттерн — логика векторного поиска инкапсулирована, легко протестировать
- ✅ **Записывается максимальная similarity для ВСЕХ идей** — даже уникальные идеи получают поле similarity (максимальное значение среди проверенных источников). Это позволяет анализировать "почти дубликаты" и корректировать порог дедупликации на основе реальных данных
- ✅ **Тройная проверка** — Ideas проверяются против Ideas, NataliaPosts и TranscriptPosts с дифференцированными порогами (см. `UPDATE_DEDUPLICATION.md`)
- ✅ **Типобезопасность** — единый источник типов в `shared/deduplication.types.ts`, правильный маппинг переменных между repository и resolver

## История изменений

**03.09.2026** — Рефакторинг унификации типов и 2 багфикса (см. `UPDATE_DEDUPLICATION.md`):
- Типы объединены в `shared/deduplication.types.ts`
- Добавлена тройная проверка Ideas ↔ NataliaPosts ↔ TranscriptPosts
- **Bugfix #1:** Исправлены перепутанные переменные в `deduplicationService.ts`
- **Bugfix #2:** `maxSimilarity` теперь записывается даже если все совпадения ниже порога (разделена логика аналитики и определения дублей)
- Дифференцированные пороги через `thresholdResolver` (0.75/0.80)

**06.08.2026** — Первая версия системы дедупликации для Ideas