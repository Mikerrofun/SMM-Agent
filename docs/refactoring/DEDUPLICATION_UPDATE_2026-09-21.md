# Изменения дедупликации — 21.09.2026

## Проблема

Неотправленные идеи (статус NEW) участвовали в дедупликации постов. Идей генерируется
больше всего, большинство никто не видел — и они навсегда занимали векторное
пространство и отбраковывали посты как «дубли» несвязанного контента.

Дополнительно: пара `nataliaChannelPost ↔ idea` не была прописана в
`thresholdResolver` и проваливалась в fallback `sameType` = 0.75 — строже, чем
проверка обычных transcript-постов против тех же идей (0.80).

## Решение

Два режима дедупликации идей:

| Режим | Функция | Пул статусов |
|---|---|---|
| Генерация идей (полный дедуп) | `findSimilarIdeasForGeneration` | NEW + SENT + SELECTED |
| Дедупликация постов | `findSimilarIdeasForPostDedup` | SENT + SELECTED |

Логика: при генерации идей батч не должен приносить пользователю похожие идеи —
поэтому проверка против всех живых идей, включая неотправленные NEW. При генерации
постов проверяются только идеи, которые реально «жили» (SENT — отправлены в Telegram,
SELECTED — выбраны для производства). NEW-идею никто не видел — она не блокирует посты.

## Изменённые файлы

### `src/repositories/ideaRepository.ts`
- `findSimilarIdeas` → **`findSimilarIdeasForGeneration`**: пул расширен до
  NEW + SENT + SELECTED (добавлен SELECTED).
- `findSimilarIdeasForTranscript` → **`findSimilarIdeasForPostDedup`**: пул сокращён
  до SENT + SELECTED (убран NEW).

### `src/services/shared/thresholdResolver.ts`
Добавлены явные пары (раньше проваливались в `sameType` = 0.75):
- `nataliaChannelPost ↔ idea` = crossContent **0.80**
- `nataliaChannelPost ↔ transcriptPost` = crossContent **0.80**

Обе пары симметричны (работают в обе стороны: посты против идей и идеи против постов).

### `src/services/shared/deduplication.config.ts`
Комментарий к `crossContent` дополнен новыми парами. Значения не менялись.

### Переименования (понятные имена, поведение то же)
- `transcriptPostRepository.findSimilarPosts` → `findSimilarTranscriptPosts`
- `transcriptPostRepository.findSimilarPostsForIdeas` → `findSimilarTranscriptPostsForIdeaDedup`
- `nataliaChannelPostRepository.findSimilarPosts` → `findSimilarNataliaChannelPosts`
- Обновлены импорты и вызовы в `src/services/transcript/deduplicationService.ts`
  и `src/services/idea/deduplicationService.ts` (алиасы `findSimilarPosts as ...` убраны).

### `tests/thresholdResolver.test.ts`
Тест `idea против nataliaChannelPost — 0.75` заменён на тесты новых пар (0.80 в обе стороны).

## Что НЕ менялось

- Порог `nataliaChannelPost ↔ nataliaPost` = **0.85** (тема наследуется из карты канала).
- `getRevealedMainIdeas`: SENT + DUPLICATE за всё время, без окна.
- Статус REJECTED: остался — используется как статус черновика поста до прохождения
  дедуп-проверки (default в схеме) и как само-исключение из выборок.
- Проверка идей против REJECTED/DUPLICATE: не добавлялась (REJECTED недостижим в текущем флоу).

## Известное следствие (осознанный trade-off)

NEW-идеи, которые никогда не будут отправлены, остаются источниками в дедупе
**генерации идей** (`findSimilarIdeasForGeneration`). Если генератор идей со временем
«упрётся» и всё будет дублировать — причина в зависших NEW; лечение — чистка таких идей.
