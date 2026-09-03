---

**Дата:** 02.09.2026
**Теги:** #deduplication #embeddings #pgvector

---

## 1. Зачем

В системе жили две независимые системы дедупликации: `Idea` и `TranscriptPost`. У них были разные поля в БД (`Idea` — `duplicateOfType/duplicateOfId/similarity/status=DUPLICATE`, `TranscriptPost` — `isDuplicate:Boolean`), разные типы источников (`'idea'|'nataliaPost'` vs `'natalia'|'transcript'`), разные конфиги (`services/idea/deduplication.config.ts` с хардкодом `0.75`). Проверка была двухсторонней: идеи против идей+Натальи, транскрипты против Натальи+транскриптов. Это не позволяло ловить пересечения Ideas ↔ TranscriptPosts и требовало держать два набора типов. Задача — унифицировать поля БД, пороги и типы в один shared-слой и добавить тройную проверку с дифференцированным порогом `0.80` для кросс-контента.

## 2. Где/что уже было

Использовалась готовая инфраструктура без переписывания:

- `services/shared/similarityResolver.ts` — выбор лучшего совпадения среди источников (уже общий, переиспользован).
- `repositories/*Repository.ts` — pgvector-паттерн через `$queryRaw` с `(1 - (embedding <=> vector))`, ретраи через `withRetry`.
- `ai/embeddings.ts:createEmbedding` + `services/shared/deduplication.config.ts:DEDUPLICATION_RETRY_CONFIG` — ретраи и эмбеддинги.
- `prisma/schema.prisma` — миграция `20260831205400_unify_deduplication_fields` уже выполнена: `TranscriptPost` получил `duplicateOfType/duplicateOfId`, удалён `isDuplicate`, `TranscriptPostStatus` получил `DUPLICATE`.

Задача была не писать новое с нуля, а связать существующие куски через общий конфиг/типы/пороги и добавить недостающие репозиторий-методы.

Ключевой reused-кусок до рефактора — `resolveBestMatch` просто брал максимум без порогов:

```ts
// src/services/shared/similarityResolver.ts — было
export function resolveBestMatch<TSource extends string>(
  sources: Array<SimilaritySource<TSource>>
): ResolvedSimilarity<TSource> { /* сравнивает matches[0] */ }
```

## 3. Реализация

### 3.1 Единый файл типов

Удалены дубли `src/services/idea/deduplication.types.ts` и `src/services/transcript/deduplication.types.ts`. Всё схлопнуто в один источник истины:

```ts
// src/services/shared/deduplication.types.ts
export type DuplicateSource = 'idea' | 'nataliaPost' | 'transcriptPost';
export interface SimilarityMatch { readonly id: string; readonly similarity: number; readonly createdAt?: Date; }
export interface BaseDuplicationResult { isDuplicate: boolean; maxSimilarity: number; source: DuplicateSource | null; matchedId: string | null; }
export type DuplicationResult = BaseDuplicationResult;
export interface EmbeddingCheckResult extends BaseDuplicationResult { embedding: number[]; }
export interface DeduplicationStats { total: number; unique: number; duplicates: number; duplicatesWithIdeas: number; duplicatesWithNataliaPosts: number; duplicatesWithTranscriptPosts: number; failed: number; failedItems: Array<{id: string; error: string}>; }
export interface DeduplicateIdeasOptions { onProgress?: (current: number, total: number) => void; }

// src/shared/types/transcript.types.ts
export type TranscriptPostStatus = 'SENT' | 'REJECTED' | 'DUPLICATE';
```

Все импорты переключены: `idea/deduplicationService.ts`, `transcript/deduplicationService.ts`, `pipelineService.types.ts`, `ideaRepository.ts`, `nataliaPostRepository.ts` теперь тянут типы из `shared/deduplication.types.ts`. `TranscriptPostStatus` перенесён в `shared/types/transcript.types.ts`. Остальная логика pipeline/бота не изменилась.

Типизация статуса централизована:

```ts
// src/repositories/transcriptPostRepository.ts
import type { SimilarityMatch, DuplicateSource } from '../services/shared/deduplication.types';
import type { TranscriptPostStatus } from '../shared/types/transcript.types';
export async function updateStatus(id: string, status: TranscriptPostStatus): Promise<void> { ... }

// src/shared/types/transcript.types.ts
export type TranscriptPostStatus = 'SENT' | 'REJECTED' | 'DUPLICATE';
export interface TranscriptPostData { status: TranscriptPostStatus; duplicateOfType?: string | null; duplicateOfId?: string | null; }
```

Старый файл `src/services/idea/deduplication.config.ts` удалён.

### 3.2 Единый конфиг порогов

```ts
// src/services/shared/deduplication.config.ts
export const DEDUPLICATION_THRESHOLDS = { nataliaPost: 0.75, crossContent: 0.80, sameType: 0.75 } as const;
export const DEDUPLICATION_RETRY_CONFIG: RetryConfig = { maxAttempts: 3, delayMs: 1000, backoffFactor: 2 };
```

### 3.3 Резолвер порогов

```ts
// src/services/shared/thresholdResolver.ts
export function getThreshold(targetSource: DuplicateSource, checkAgainstSource: DuplicateSource): number {
  if (checkAgainstSource === 'nataliaPost') return DEDUPLICATION_THRESHOLDS.nataliaPost;
  if (targetSource === 'idea' && checkAgainstSource === 'transcriptPost') return DEDUPLICATION_THRESHOLDS.crossContent;
  if (targetSource === 'transcriptPost' && checkAgainstSource === 'idea') return DEDUPLICATION_THRESHOLDS.crossContent;
  return DEDUPLICATION_THRESHOLDS.sameType;
}
```

### 3.4 SimilarityResolver с дифференцированными порогами

Теперь принимает `targetSource` и фильтрует по порогу до выбора максимума:

```ts
// src/services/shared/similarityResolver.ts — стало
export function resolveBestMatch(targetSource: DuplicateSource, sources: Array<SimilaritySource>): ResolvedSimilarity {
  let maxSimilarity = 0; let source: DuplicateSource | null = null; let matchedId: string | null = null;
  for (const candidate of sources) {
    const best = candidate.matches[0]; if (!best) continue;
    const threshold = getThreshold(targetSource, candidate.source);
    if (best.similarity >= threshold && best.similarity > maxSimilarity) { maxSimilarity = best.similarity; source = candidate.source; matchedId = best.id; }
  }
  return { maxSimilarity, source, matchedId };
}
```

```ts
// src/services/shared/similarityResolver.types.ts
import type { SimilarityMatch, DuplicateSource } from './deduplication.types';
export interface SimilaritySource<TSource extends DuplicateSource = DuplicateSource> { source: TSource; matches: SimilarityMatch[]; }
export interface ResolvedSimilarity<TSource extends DuplicateSource = DuplicateSource> { maxSimilarity: number; source: TSource | null; matchedId: string | null; }
```

### 3.5 Репозитории — кросс-проверка

Добавлены два метода, SQL-паттерн без изменений:

```ts
// src/repositories/ideaRepository.ts
export async function findSimilarIdeasForTranscript(embedding: number[], threshold: number): Promise<SimilarityMatch[]> {
  // SELECT id, (1 - (embedding <=> vector)) FROM "Idea" WHERE status = ANY(['NEW','SENT','SELECTED']) AND similarity >= threshold ORDER BY similarity DESC
}
```

```ts
// src/repositories/transcriptPostRepository.ts
export async function findSimilarPostsForIdeas(embedding: number[], threshold: number): Promise<SimilarityMatch[]> {
  // SELECT id, similarity FROM "TranscriptPost" WHERE status='SENT' AND similarity >= threshold ORDER BY similarity DESC
}
export async function markAsDuplicate(id: string, duplicateOfType: DuplicateSource, duplicateOfId: string, similarity: number): Promise<void> {
  // UPDATE SET status='DUPLICATE', duplicateOfType, duplicateOfId, similarity — вместо isDuplicate
}
```

### 3.6 Сервисы дедупликации — тройная проверка

```ts
// src/services/idea/deduplicationService.ts
const [ideaMatches, nataliaMatches, transcriptMatches] = await Promise.all([
  findSimilarIdeas(embeddingArray, 0, idea.id),           // Ideas
  findSimilarNataliaPosts(embeddingArray, 0),             // NataliaPosts
  findSimilarPostsForIdeas(embeddingArray, 0),            // TranscriptPosts
]);
const { maxSimilarity, source, matchedId } = resolveBestMatch('idea', [
  { source: 'idea', matches: ideaMatches },
  { source: 'nataliaPost', matches: nataliaMatches },
  { source: 'transcriptPost', matches: transcriptMatches },
]);
const isDuplicate = source !== null && matchedId !== null;
// + новая ветка stats.duplicatesWithTranscriptPosts
```

```ts
// src/services/transcript/deduplicationService.ts
export async function checkPostDuplication(embedding: number[]): Promise<DuplicationResult> {
  const [nataliaMatches, transcriptMatches, ideaMatches] = await Promise.all([
    findSimilarNataliaPosts(embedding, 0),
    findSimilarPosts(embedding, 0),
    findSimilarIdeasForTranscript(embedding, 0),
  ]);
  const { maxSimilarity, source, matchedId } = resolveBestMatch('transcriptPost', [
    { source: 'nataliaPost', matches: nataliaMatches },
    { source: 'transcriptPost', matches: transcriptMatches },
    { source: 'idea', matches: ideaMatches },
  ]);
  const isDuplicate = source !== null && matchedId !== null;
  return { isDuplicate, maxSimilarity, source: isDuplicate ? source : null, matchedId: isDuplicate ? matchedId : null };
}
export async function generateAndCheckEmbedding(mainIdea: string): Promise<EmbeddingCheckResult> {
  // withRetry(() => createEmbedding(mainIdea)) → withRetry(() => checkPostDuplication(embedding)) → { ...result, embedding }
}
```

`transcriptProcessingService.ts:generateSinglePost` теперь помечает дубль через `markAsDuplicate(post.id, dedupResult.source, dedupResult.matchedId, dedupResult.maxSimilarity)` вместо оставления `REJECTED`, пишет `status='DUPLICATE'` и логирует `source/matchedId`.

Остальная логика `pipelineService.ts:runFullPipeline` (parsing→ideas→deduplication→GenerationRun) не менялась — новый `deduplicateIdeas` просто встаёт на место старого.

## 4. UI

UI не затронут. `bot/commands` не читают `isDuplicate` напрямую и рендерят уже присланные `status/similarity` — работают с новой схемой без изменений.

## 5. Поток данных

Идеи (батч, через pipeline):

```
getNewIdeasWithEmbeddings()
↓parseEmbeddingString(idea.embedding)
↓Promise.all(findSimilarIdeas(embedding,0,excludeId) + findSimilarNataliaPosts(embedding,0) + findSimilarPostsForIdeas(embedding,0))
↓resolveBestMatch('idea', sources) → getThreshold(target, source) → best.similarity >= threshold
↓isDuplicate=(source!==null) ? markAsDuplicate(source,matchedId,maxSimilarity) : updateMaxSimilarity(maxSimilarity) → DeduplicationStats
```

Транскрипты (на лету, POSTS_PER_TRANSCRIPT × MAX_ATTEMPTS):

```
generatePostFromTranscript(text, usedMainIdeas)
↓extractMainIdea(postText) → mainIdea
↓createTranscriptPost(transcriptId,text,mainIdea,attemptNumber)
↓generateAndCheckEmbedding(mainIdea) → createEmbedding(mainIdea)↓checkPostDuplication(embedding) → Promise.all(Natalia+Transcript+Ideas)↓resolveBestMatch('transcriptPost') → {isDuplicate,maxSimilarity,source,matchedId} → {…result,embedding}
↓updateEmbedding + updateSimilarity
↓!isDuplicate ? updateStatus(SENT) → return post : markAsDuplicate(source,matchedId) → следующая попытка
```

Pipeline:

```
runFullPipeline(onProgress)↓createGenerationRun(RUNNING)↓parseCompetitorsChannels↓processIdeaBatch↓deduplicateIdeas(onProgress) → DeduplicationStats↓countAcceptedIdeasFromRun↓updateGenerationRunSuccess
```

## 6. Почему так, а не иначе

1. **Один файл типов вместо трёх.** `DuplicationResult`/`EmbeddingCheckResult` были идентичны — держать три файла ради разных имён типов источников умножает рассинхрон. Единый `DuplicateSource` + `TranscriptPostStatus` в `shared/deduplication.types.ts` делает `thresholdResolver` типобезопасным (принимает `DuplicateSource`, не `string`).
2. **Пороги в `thresholdResolver`, а не хардкод.** Дифференцированный `0.80` для Ideas ↔ TranscriptPosts — отдельное правило; вынести в `getThreshold(target,source)` дешевле, чем дублировать `if` в каждом сервисе.
3. **Фильтрация по порогу в JS, а не в SQL.** SQL всегда `threshold=0`, порог в `resolveBestMatch` — держит SQL простым и всю логику порогов в одном месте без БД.
4. **Raw SQL оставлен.** Prisma не поддерживает `vector` — новые методы скопировали существующий pgvector-паттерн.

## Преимущества

- ✅ Тройная дедупликация Ideas ↔ NataliaPost ↔ TranscriptPosts, пороги 0.75/0.80.
- ✅ Единые поля БД: TranscriptPost с duplicateOfType/duplicateOfId/status=DUPLICATE, isDuplicate удалён.
- ✅ Единый источник типов: один shared/deduplication.types.ts, TranscriptPostStatus типизирован в repository и shared/types.
- ✅ Пороги централизованы в DEDUPLICATION_THRESHOLDS + thresholdResolver.
- ✅ Новый код — только 2 репозиторий-метода + thresholdResolver; остальное переиспользовано.
- ✅ npx tsc --noEmit чистый после удаления обоих дублирующих файлов.

## 7. Bugfix (03.09.2026)

### Проблема
После рефакторинга в `deduplicationService.ts` были перепутаны имена переменных при деструктуризации результатов Promise.all:

```ts
// Было (неправильно):
const [nataliaMatches, transcriptMatches, ideaMatches] = await Promise.all([
   findSimilarIdeas(...),           // возвращает Ideas, но присваивается в nataliaMatches
   findSimilarNataliaPosts(...),    // возвращает Natalia, но присваивается в transcriptMatches
   findSimilarPostsForIdeas(...),   // возвращает Transcript, но присваивается в ideaMatches
]);

const { maxSimilarity, source, matchedId } = resolveBestMatch('idea', [
  { source: 'idea', matches: nataliaMatches },           // передавались Ideas как Natalia
  { source: 'nataliaPost', matches: transcriptMatches }, // передавались Natalia как Transcript
  { source: 'transcriptPost', matches: ideaMatches },    // передавались Transcript как Ideas
]);
```

Это приводило к:
- Неправильному применению порогов (0.75/0.80 применялись к неверным источникам)
- Неправильной записи `duplicateOfType` в БД
- Некорректной статистике дубликатов

### Решение
Исправлены имена переменных — теперь они соответствуют порядку вызовов:

```ts
// Стало (правильно):
const [ideaMatches, nataliaMatches, transcriptMatches] = await Promise.all([
  findSimilarIdeas(...),           // Ideas → ideaMatches
  findSimilarNataliaPosts(...),    // Natalia → nataliaMatches  
  findSimilarPostsForIdeas(...),   // Transcript → transcriptMatches
]);

const { maxSimilarity, source, matchedId } = resolveBestMatch('idea', [
  { source: 'idea', matches: ideaMatches },
  { source: 'nataliaPost', matches: nataliaMatches },
  { source: 'transcriptPost', matches: transcriptMatches },
]);
```

