---

**Дата:** 21.09.2026
**Теги:** #refactoring #deduplication #thresholds

---

# Дедупликация: два режима пула идей + пороги nataliaChannelPost

## Обзор изменений

- Разделены пулы статусов идей: полный дедуп при генерации идей (NEW + SENT + SELECTED), только опубликованный контент (SENT + SELECTED) при дедупе постов.
- Пары `nataliaChannelPost ↔ idea` и `nataliaChannelPost ↔ transcriptPost` выведены из fallback в явный crossContent 0.80 (обе стороны).
- Переименованы `findSimilar*`-методы репозиториев: имена теперь говорят, какой флоу они обслуживают.
- REJECTED не тронут: остался в схеме и флоу как статус черновика поста до прохождения дедуп-проверки.

---

## Часть 1: Статусные пулы идей в дедупликации

### Проблема(ы)

**Проблема 1:** Неотправленные идеи (NEW) участвовали в дедупликации постов. Идей генерируется больше всего, большинство никто не видел — и они навсегда занимали векторное пространство, отбраковывая посты как «дубли» несвязанного контента.
**Проблема 2:** Обратный риск: если бы NEW убрать и из генерации идей, батч принёс бы пользователю кучу похожих неотправленных идей.

### Решения

#### 1.1. Два режима дедупа идей вместо одного

**Файл:** `src/repositories/ideaRepository.ts`

```ts
// src/repositories/ideaRepository.ts
// Генерация идей — полный пул: батч не должен приносить похожие идеи,
// даже если предыдущие ещё не отправлены.
export async function findSimilarIdeasForGeneration(
  embedding: number[],
  threshold: number,
  excludeId: string
): Promise<SimilarityMatch[]> {
  // ...
  AND status = ANY(ARRAY['NEW', 'SENT', 'SELECTED']::"IdeaStatus"[])
```

```ts
// src/repositories/ideaRepository.ts
// Дедуп постов — только опубликованный контент: NEW-идею никто не видел,
// она не блокирует посты.
export async function findSimilarIdeasForPostDedup(
  embedding: number[],
  threshold: number
): Promise<SimilarityMatch[]> {
  // ...
  AND status = ANY(ARRAY['SENT', 'SELECTED']::"IdeaStatus"[])
```

**Логика:** SELECTED остаётся в постовом пуле — как только идею выбрали для производства, она снова защищает канал от дубля. Незащищённым остаётся только путь «NEW-идея, которую никто не видел» — это осознанное решение.

#### 1.2. Вызовы переведены на нужный режим

**Файл:** `src/services/idea/deduplicationService.ts`

```ts
// src/services/idea/deduplicationService.ts
findSimilarIdeasForGeneration(embeddingArray, 0, idea.id),
findSimilarNataliaPosts(embeddingArray, 0),
findSimilarNataliaChannelPosts(embeddingArray, 0),
findSimilarTranscriptPostsForIdeaDedup(embeddingArray, 0),
```

**Файл:** `src/services/transcript/deduplicationService.ts`

```ts
// src/services/transcript/deduplicationService.ts
findSimilarNataliaChannelPosts(embedding, 0),
findSimilarTranscriptPosts(embedding, 0),
findSimilarIdeasForPostDedup(embedding, 0),
```

**Логика:** Идеи дедупятся против полного пула, посты — против опубликованного. Сами вызовы не переписывались заново — переименованы импорты и функции.

---

## Часть 2: Пороги nataliaChannelPost

### Проблема(ы)

**Проблема 1:** Пара `nataliaChannelPost ↔ idea` не была прописана в резолвере и проваливалась в fallback `sameType` = 0.75 — строже, чем проверка обычных transcript-постов против тех же идей (0.80).
**Проблема 2:** Ранний catch-all `checkAgainstSource === 'nataliaChannelPost'` перехватывал обратные пары (idea ↔ nataliaChannelPost) на 0.75 и делал явные проверки недостижимыми.

### Решения

#### 2.1. Явные симметричные пары crossContent

**Файл:** `src/services/shared/thresholdResolver.ts`

```ts
// src/services/shared/thresholdResolver.ts
if (targetSource === 'nataliaChannelPost' && checkAgainstSource === 'idea') {
  return DEDUPLICATION_THRESHOLDS.crossContent;
}
if (targetSource === 'idea' && checkAgainstSource === 'nataliaChannelPost') {
  return DEDUPLICATION_THRESHOLDS.crossContent;
}
if (
  targetSource === 'nataliaChannelPost' &&
  checkAgainstSource === 'transcriptPost'
) {
  return DEDUPLICATION_THRESHOLDS.crossContent;
}
if (
  targetSource === 'transcriptPost' &&
  checkAgainstSource === 'nataliaChannelPost'
) {
  return DEDUPLICATION_THRESHOLDS.crossContent;
}
```

**Логика:** Все четыре направления прописаны явно — TS не даст паре «потеряться» в fallback: непокрытая комбинация теперь падает в `sameType`, а не в случайный ранний return.

#### 2.2. Удалён catch-all и мёртвый ключ конфига

**Файл:** `src/services/shared/thresholdResolver.ts`

```ts
// src/services/shared/thresholdResolver.ts
// Удалён ранний catch-all:
// if (checkAgainstSource === 'nataliaChannelPost') { return ...nataliaChannelPost; }
// nataliaChannelPost vs nataliaChannelPost теперь доходит до sameType (0.75) сам.
```

**Файл:** `src/services/shared/deduplication.config.ts`

```ts
// src/services/shared/deduplication.config.ts
export const DEDUPLICATION_THRESHOLDS = {
  nataliaPost: 0.75,
  crossContent: 0.80,
  sameType: 0.75,
  // natalia_channel_post генерируется из карты mainIdea канала, поэтому тема
  // наследуется из источника и схожесть с постами Натальи изначально выше.
  // Между собой посты канала сравниваются по базовому порогу (sameType, 0.75).
  nataliaChannelPostVsNataliaPost: 0.85,
} as const;
```

**Логика:** Ключ `nataliaChannelPost: 0.75` остался без единого референса — удалён. Порог 0.85 против постов Натальи не тронут: тема наследуется из карты канала, схожесть с источником изначально выше.

---

## Часть 3: Переименования findSimilar*

### Проблема(ы)

**Проблема 1:** `findSimilarIdeas` / `findSimilarIdeasForTranscript` / `findSimilarPosts` не говорят, какой флоу обслуживают, — в двух сервисах жили алиасы вида `findSimilarPosts as findSimilarNataliaChannelPosts`, в которых легко запутаться.

### Решения

#### 3.1. Имена по флоу, алиасы убраны

**Файл:** `src/repositories/ideaRepository.ts`, `src/repositories/transcriptPostRepository.ts`, `src/repositories/nataliaChannelPostRepository.ts`

```ts
// src/repositories/ideaRepository.ts
findSimilarIdeas              → findSimilarIdeasForGeneration   // полный пул
findSimilarIdeasForTranscript → findSimilarIdeasForPostDedup    // SENT + SELECTED

// src/repositories/transcriptPostRepository.ts
findSimilarPosts              → findSimilarTranscriptPosts
findSimilarPostsForIdeas      → findSimilarTranscriptPostsForIdeaDedup

// src/repositories/nataliaChannelPostRepository.ts
findSimilarPosts              → findSimilarNataliaChannelPosts
```

**Логика:** Поведение не менялось — только имена и импорты в `deduplicationService.ts` (оба). `getRevealedMainIdeas` оставлен как есть: имя честное.

---

## Итоги

### Изменённые файлы (8 шт)

**Статусные пулы:**
1. `src/repositories/ideaRepository.ts` — два режима: `findSimilarIdeasForGeneration` (NEW+SENT+SELECTED), `findSimilarIdeasForPostDedup` (SENT+SELECTED)
2. `src/services/idea/deduplicationService.ts` — вызов переведён на `findSimilarIdeasForGeneration`
3. `src/services/transcript/deduplicationService.ts` — вызов переведён на `findSimilarIdeasForPostDedup`

**Пороги:**
4. `src/services/shared/thresholdResolver.ts` — явные пары nataliaChannelPost ↔ idea/transcriptPost = 0.80, удалён catch-all
5. `src/services/shared/deduplication.config.ts` — удалён мёртвый ключ `nataliaChannelPost`, комментарии обновлены

**Переименования:**
6. `src/repositories/transcriptPostRepository.ts` — `findSimilarTranscriptPosts`, `findSimilarTranscriptPostsForIdeaDedup`
7. `src/repositories/nataliaChannelPostRepository.ts` — `findSimilarNataliaChannelPosts`

**Тесты:**
8. `tests/thresholdResolver.test.ts` — тест «idea против nataliaChannelPost = 0.75» заменён на пары 0.80 в обе стороны

### Результаты

- ✅ NEW-идеи больше не блокируют генерацию постов — пул постового дедупа: только SENT + SELECTED
- ✅ Батч генерации идей по-прежнему не приносит похожих идей — полный пул NEW + SENT + SELECTED
- ✅ nataliaChannelPost проверяется против идей и transcript-постов по 0.80, а не по случайному fallback 0.75
- ✅ Ни одной непокрытой комбинации в `getThreshold` — непопадание в явную пару видно по типам
- ✅ Имена методов соответствуют флоу, алиасы-импорты убраны
- ✅ REJECTED сохранён: это статус черновика поста до дедуп-проверки (default в схеме) и само-исключение из выборок

---

## Принципы, использованные при рефакторинге

**Surgical Changes** — точечные правки статусных фильтров и пар порогов без переписывания рабочего кода.
**Одна структура** — вместо изоляции natalia-флоу от общей дедупликации исправлен общий пул: все флоу живут по одной схеме.
**Явные пары вместо fallback** — порог каждой пары источников прописан явно, молчаливые провалы в `sameType` исключены.
