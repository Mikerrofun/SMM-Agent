# /natalia_channel_post — генерация постов из главных идей канала + общий пайплайн

---

**Дата:** 20.09.2026
**Теги:** #features #natalia-channel-post #deduplication #shared-pipeline #refactoring

---

## 1. Зачем

Был только один источник постов — транскрипты встреч (`/transcript_post`). Но у канала Натальи есть своя тематическая карта: ~160 постов с `mainIdea`, и на их основе можно генерить новые посты без всяких транскриптов — дораскрыть существующую тему с нового ракурса или закрыть пробел, которого в канале не хватает.

Вторая проблема — фильтр релевантности. Дедупликация отбрасывала только **точные дубли** (similarity ≥ 0.75), но контент с similarity 0.6–0.74 проходил как «уникальный», хотя по сути это пересказ уже опубликованного. Нужен второй барьер: всё, что слишком близко к каналу Натальи (nataliaSimilarity < 0.5), отбраковывается даже если формально не дубль.

Третья — transcript-пайплайн был монолитом: цикл попыток, дедуп, статусы, кнопка «ещё» жили внутри `transcriptProcessingService`. Для второй команды пришлось бы копировать это всё. Поэтому заодно вынес общий пайплайн в shared.

## 2. Где/что уже было

Задача была не писать новое, а переиспользовать существующее:

- **Дедуп-ядро** — `resolveBestMatch` (`src/services/shared/similarityResolver.ts`), `getThreshold` (`thresholdResolver.ts`), пороги в `deduplication.config.ts`. Добавлены только новые записи в существующие структуры.
- **`generateAndCheckEmbedding`** (`src/services/transcript/deduplicationService.ts`) — embedding + проверка против всех источников одной функцией. Новая команда вызывает её же, просто с другим `targetSource`.
- **Паттерн transcript-команды** — `src/bot/commands/transcriptPost/` (command/renderer/moreButton/config) и `transcriptPostRepository.ts` (raw SQL для vector-операций). Скопированы и адаптированы.
- **Промпт** — `generate-transcript-post.md` (~440 строк стиля Натальи). Скопирован целиком, правки только в блоках задачи.
- **Регенерация** — `postRegenerationService` уже работал с PostType, добавлен третий тип.

## 3. Реализация

### 3.1 Фильтр релевантности (MIN_NATALIA_SIMILARITY = 0.5)

```ts
// src/services/shared/relevanceFilter.ts
export function isNataliaRelevanceRejected(
  nataliaSimilarity: number,
  isDuplicate: boolean
): boolean {
  return !isDuplicate && nataliaSimilarity < MIN_NATALIA_SIMILARITY;
}

export const NATALIA_RELEVANCE_REASON: RelevanceRejectionReason = 'natalia_relevance';
```

```ts
// src/services/shared/deduplication.config.ts
export const MIN_NATALIA_SIMILARITY = 0.5;
```

Ключевое: `nataliaSimilarity` считается **отдельно** от `maxSimilarity`. В `resolveBestMatch` это максимум по двум natalia-источникам (`nataliaPost`, `nataliaChannelPost`), независимо от того, какой источник выиграл по порогам:

```ts
// src/services/shared/similarityResolver.ts
const NATALIA_SOURCES: ReadonlySet<DuplicateSource> = new Set([
  'nataliaPost',
  'nataliaChannelPost',
]);
// в цикле: если источник natalia — обновляем nataliaSimilarity,
// даже если по порогам выиграл другой источник
```

Отбраковка пишется в БД как `duplicateOfType = 'natalia_relevance'`, `duplicateOfId = ''` (пустая строка — источника-дубля нет). Тип `DuplicateOfType = DuplicateSource | 'natalia_relevance'` — репозитории (`ideaRepository`, `transcriptPostRepository`, `nataliaChannelPostRepository`) принимают его в `markAsDuplicate`.

Фильтр встроен в **оба** dedup-сервиса: transcript (`checkPostDuplication` возвращает `relevanceRejected`) и idea (в цикле дедупликации идей добавлена ветка `else if (isNataliaRelevanceRejected(...))` — идея помечается дублем без счётчика источника).

### 3.2 Модель NataliaChannelPost

```prisma
// prisma/schema.prisma
model NataliaChannelPost {
  id              String                 @id @default(cuid())
  text            String
  mainIdea        String
  embedding       Unsupported("vector")?
  similarity      Float?
  duplicateOfType String?
  duplicateOfId   String?
  attemptNumber   Int                    @default(1)
  createdAt       DateTime               @default(now())
  status          TranscriptPostStatus   @default(REJECTED)

  @@index([status])
  @@index([duplicateOfId])
}
```

Это копия `TranscriptPost` минус `transcriptId` (источника-транскрипта нет). Enum статусов переиспользован — миграция: `prisma/migrations/20260920120000_add_natalia_channel_post/`. Внимание: из песочницы применить её не удалось (Supabase pooler отвечал «tenant not found»), SQL закоммичен, применяется через `npx prisma migrate dev` когда БД доступна.

### 3.3 Репозиторий

`src/repositories/nataliaChannelPostRepository.ts` — полный аналог transcript-репозитория: `createNataliaChannelPost`, `updateEmbedding` (raw SQL `::vector`), `updateSimilarity`, `updateStatus`, `markAsDuplicate`, `getSentPosts`, `findSimilarPosts` (raw SQL cosine similarity, сортировка DESC). Типы — `src/shared/types/nataliaChannelPost.types.ts`.

### 3.4 Четвёртый источник дедупликации

```ts
// src/services/shared/deduplication.config.ts
export const DEDUPLICATION_THRESHOLDS = {
  nataliaPost: 0.75,
  nataliaChannelPost: 0.75,
  crossContent: 0.80,
  sameType: 0.75,
  // пороги для natalia_channel_post (см. раздел 7)
  nataliaChannelPostVsNataliaPost: 0.85,
  nataliaChannelPostVsSelf: 0.85,
} as const;
```

В `thresholdResolver.ts` добавлен case для `nataliaChannelPost` (с итерации 21.09.2026 — пер-парные пороги 0.85, см. раздел 7). В оба dedup-сервиса добавлен четвёртый параллельный запрос `findSimilarNataliaChannelPosts(embedding, 0)` и четвёртый элемент в массиве источников `resolveBestMatch`. Теперь сгенерированный пост проверяется против: постов Натальи, **своих же сгенерированных постов канала**, transcript-постов и идей.

### 3.5 Общий пайплайн (главный рефакторинг)

Вынесен в `src/services/shared/postGeneration/`. Ядро — `generateUniquePost`, параметризованный объектом зависимостей:

```ts
// src/services/shared/postGeneration/postGeneration.types.ts
export interface PostGenerationDeps<TPost, TCreateInput> {
  repository: PostRepositoryAdapter<TPost, TCreateInput>; // create/updateEmbedding/updateSimilarity/updateStatus/markAsDuplicate
  config: PostGenerationConfig;                           // maxAttemptsPerPost, retryConfig, targetSource
  checkDuplication: DuplicationChecker;                   // mainIdea → embedding + результат проверки
  generateText: (usedMainIdeas: string[]) => Promise<string>; // контекст источника замыкается снаружи
  extractMainIdea: (postText: string) => Promise<string>;
  createInput: (params: { text; mainIdea; attemptNumber }) => TCreateInput;
  logPrefix: string;
  logContext?: Record<string, unknown>;
}
```

Цикл внутри `generateUniquePost` (`postGenerationPipeline.ts`): генерация → extractMainIdea → `repository.create` → `checkDuplication` → `updateEmbedding`/`updateSimilarity` → SENT, либо `markAsDuplicate` (дубль или `'natalia_relevance'`) → следующая попытка. Исчерпание `maxAttemptsPerPost` → `null`.

Рядом — `generateAdditionalPostShared` (логика кнопки «ещё»: взять раскрытые темы — mainIdea SENT- и DUPLICATE-постов — как usedMainIdeas → одна генерация → `'no_unique_topics'` при неудаче).

`transcriptProcessingService` переведён на этот пайплайн — публичный API (`processTranscriptPosts`) не изменился, монолитный `generateSinglePost` удалён.

### 3.6 Сборщик тематической карты канала

```ts
// src/repositories/nataliaPostRepository.ts
export async function getAllMainIdeas(): Promise<string[]> {
  const rows = await prisma.nataliaPost.findMany({
    where: { mainIdea: { not: '' } },
    select: { mainIdea: true },
    orderBy: { publishedAt: 'desc' },
  });
  return rows.map((row) => row.mainIdea);
}
```

```ts
// src/services/shared/postGeneration/nataliaChannelContext.ts
export function buildNataliaChannelContext(mainIdeas: string[]): string {
  if (mainIdeas.length === 0) return '';
  return mainIdeas.map((idea, index) => `${index + 1}. ${idea}`).join('\n');
}
```

Чистая функция без обращений к БД — данные приходят снаружи. Никаких файлов и кэшей: карта канала читается из БД заново при **каждом** вызове генерации (данные всегда свежие).

### 3.7 AI-модуль и промпт

```ts
// src/ai/nataliaChannelPostGenerator.ts
export async function generateNataliaChannelPost(
  channelContext: string,
  excludeMainIdeas: string[] = []
): Promise<string>
```

Структура user message: статичная часть (`<untrusted_source>` с картой канала + задача) + динамический блок «УЖЕ РАСКРЫТЫЕ ТЕМЫ» **строго в конце** — так статичный префикс не меняется между вызовами и работает prefix-кэш. Промпт `src/prompts/generate-natalia-channel-post.md` — копия transcript-промпта; изменены только: заголовок, блок «Особенности работы» (транскрипты → главные идеи канала), секция 15 (входные данные), чек-лист и напоминание. Весь стиль, структура, длина и запреты — без изменений.

### 3.8 Сервис-обёртка

`src/services/nataliaChannelPost/nataliaChannelPostService.ts` — собирает `PostGenerationDeps` (в этом и есть смысл shared-пайплайна: сервис только «скармливает» ему свои зависимости):

- `generateText`: `getAllMainIdeas()` → `buildNataliaChannelContext()` → `generateNataliaChannelPost(channelContext, usedMainIdeas)`
- `checkDuplication`: `generateAndCheckEmbedding(mainIdea, 'nataliaChannelPost')`
- `targetSource: 'nataliaChannelPost'` — пороги считаются относительно нового типа поста
- `repository`: функции из `nataliaChannelPostRepository`

Экспорт: `processNataliaChannelPosts()` (POSTS_PER_RUN постов за прогон, usedMainIdeas пополняется сгенерированными) и `generateAdditionalNataliaChannelPost()` (кнопка «ещё»). Конфиг — `nataliaChannelPost.config.ts`.

### 3.9 Регенерация

`postRegenerationService` расширен третьим PostType `'nataliaChannel'`: перегенерация и «с уточнением» работают через тот же `generateNataliaChannelPost` + `generateAndCheckEmbedding`. В `regeneratePost.ts` добавлены ветки парсинга callback `regenerate_natalia_channel_post:` / `..._feedback:`.

## 4. UI (bot-слой)

`src/bot/commands/nataliaChannelPost/` — command.ts / renderer.ts / moreButton.ts / config.ts / index.ts, паттерн скопирован с transcriptPost:

- `/natalia_channel_post` — запускается сразу, PDF не нужен. Защита от повторного запуска через `runningForUser` Map. Статус-сообщение «⏳ Генерирую посты...» удаляется после генерации.
- `finishAndShowButton` — посты списком + кнопка «📝 Найти ещё пост» (`natalia_channel_more:` callback).
- `handleNataliaChannelMoreCallback` — снимает клавиатуру, генерит один доп. пост; при `no_unique_topics` пишет «Больше уникальных тем не найдено», при ошибке — кнопку повторить.

Регистрация в `src/bot/index.ts`: команда + оба callback-префикса (в т.ч. расширены regex регенерации: `regenerate_(idea|transcript|natalia_channel)_post:`). Help дополнен строкой о команде.

## 5. Поток данных

### Основной прогон `/natalia_channel_post`

```
Пользователь: /natalia_channel_post
↓
bot/index.ts → handleNataliaChannelPostCommand (command.ts, защита от повторного запуска)
↓
processNataliaChannelPosts()                    [services/nataliaChannelPost/nataliaChannelPostService.ts]
↓  для postIndex = 1..POSTS_PER_RUN, usedMainIdeas = []
generateUniquePost(deps, usedMainIdeas, ...)    [shared/postGeneration/postGenerationPipeline.ts]
↓  цикл попыток (maxAttemptsPerPost):
deps.generateText(usedMainIdeas)
↓
getAllMainIdeas()                               [repositories/nataliaPostRepository.ts]
↓  SELECT mainIdea FROM NataliaPost (~160 строк, всегда свежие)
buildNataliaChannelContext(mainIdeas)           [shared/postGeneration/nataliaChannelContext.ts]
↓  "1. идея\n2. идея\n..."
generateNataliaChannelPost(channelContext, usedMainIdeas)  [ai/nataliaChannelPostGenerator.ts]
↓  system: generate-natalia-channel-post.md
   user: <untrusted_source>карта канала + задача</untrusted_source> + «УЖЕ РАСКРЫТЫЕ ТЕМЫ» (в конце, prefix-кэш)
   → текст поста
deps.extractMainIdea(postText)                  [ai/mainIdeaExtractor.ts]
↓
repository.create({ text, mainIdea, attemptNumber })       [nataliaChannelPostRepository.ts]
↓  INSERT NataliaChannelPost (status=REJECTED)
deps.checkDuplication(mainIdea)
↓
generateAndCheckEmbedding(mainIdea, 'nataliaChannelPost')  [transcript/deduplicationService.ts]
↓
createEmbedding(mainIdea) → checkPostDuplication(embedding, targetSource)
↓  Promise.all — 4 источника (пороги для targetSource=nataliaChannelPost, см. раздел 7):
   findSimilarNataliaPosts        (NataliaPost,        порог 0.85)
   findSimilarNataliaChannelPosts (NataliaChannelPost, порог 0.85)  ← 4-й источник, новый
   findSimilarPosts               (TranscriptPost,     порог 0.75)
   findSimilarIdeasForTranscript  (Ideas,              порог 0.80)
↓
resolveBestMatch('nataliaChannelPost', sources)  [shared/similarityResolver.ts]
↓  maxSimilarity, source, matchedId + nataliaSimilarity (max по natalia-источникам)
isNataliaRelevanceRejected(nataliaSimilarity, isDuplicate)  [shared/relevanceFilter.ts]
↓
┌─ уникален и релевантен → repository.updateStatus(SENT) → пост в результат
├─ дубль                → markAsDuplicate(id, source, matchedId, maxSimilarity) → след. попытка
└─ relevanceRejected    → markAsDuplicate(id, 'natalia_relevance', '', nataliaSimilarity) → след. попытка
↓
finishAndShowButton(ctx, posts)                 [renderer.ts]
↓  посты в чат + кнопка «📝 Найти ещё пост»
```

### Кнопка «ещё»

```
Клик «📝 Найти ещё пост» (callback natalia_channel_more:)
↓
handleNataliaChannelMoreCallback (moreButton.ts)
↓
generateAdditionalNataliaChannelPost()          [nataliaChannelPostService.ts]
↓
generateAdditionalPostShared                    [shared/postGeneration/postGenerationPipeline.ts]
↓
getUsedMainIdeas() → getRevealedMainIdeas() → mainIdea всех SENT- и DUPLICATE-постов
↓  (для transcript-флоу то же самое, но из TranscriptPost, скоуп по transcriptId)
generateUniquePost(...) — тот же цикл, что выше
↓
успех → sendSinglePost + новая кнопка «ещё»
неудачно → 'no_unique_topics' → «Больше уникальных тем не найдено»
```

### Куда встроен фильтр релевантности в существующих флоу

```
/transcript_post → generateAndCheckEmbedding(mainIdea)            [targetSource=transcriptPost]
                   → relevanceRejected → markAsDuplicate('natalia_relevance') → след. попытка
/run_pipeline (идеи) → idea deduplicationService
                   → relevanceRejected → markAsDuplicate('natalia_relevance')
```

## 6. Почему так, а не иначе

1. **Общий пайплайн через deps-объект, а не копирование transcript-сервиса.** Цикл попыток + дедуп + статусы — ~150 строк идентичной логики; копия означала бы чинить баги дважды. Параметризация зависимостями (репозиторий, generateText, targetSource) позволяет transcript-флоу и channel-флоу жить на одном коде, не зная друг о друге.
2. **nataliaSimilarity считается отдельно от maxSimilarity.** Если брать maxSimilarity, то при победе transcript-источника (0.9) схожесть с каналом (0.6) потерялась бы, и фильтр релевантности не сработал бы. Отдельная метрика = независимые барьеры: дубли по порогам, релевантность по natalia-максимуму.
3. **Тематическая карта из БД при каждом вызове, без кэша.** ~160 коротких строк — один дешёвый SELECT. Кэш/файл дал бы рассинхрон после добавления постов в канал, а выгода от кэша — миллисекунды на фоне 30-60 секунд генерации.
4. **'natalia_relevance' как значение duplicateOfType, а не отдельный статус.** Статус остаётся DUPLICATE — вся существующая аналитика/фильтрация по статусам работает без изменений; причина различается полем duplicateOfType, а отсутствие duplicateOfId ('') однозначно отделяет релевантность от дубля.

## 7. Итерация 21.09.2026 — пороги 0.85 для natalia_channel_post и «раскрытые» дубли

### Проблема

Первые прогоны `/natalia_channel_post` почти полностью отбраковывались: из всех попыток уникальным оказывался максимум один пост. Причина — врождённое противоречие флоу: пост генерируется ИЗ карты mainIdea канала, а дедуп проверяет его против этой же карты (NataliaPost). «Та же тема, новый ракурс» даёт embedding-схожесть 0.7–0.85 — порог 0.75 резал почти всё. Усугублял каскад: mainIdea отклонённой попытки нигде не запоминалась, и следующая попытка с высокой вероятностью снова брала ту же «сгоревшую» тему.

### Что изменено

1. **Пер-парные пороги** (`deduplication.config.ts` + `thresholdResolver.ts`): `nataliaChannelPost → nataliaPost = 0.85` и `nataliaChannelPost → nataliaChannelPost = 0.85`. Порог зависит от targetSource — ослаблен только для natalia_channel_post; transcript- и idea-флоу живут на прежних 0.75/0.80.
2. **Отклонённая тема = раскрытая тема** (`postGenerationPipeline.ts`): mainIdea попытки, отклонённой как дубль или по релевантности, добавляется в usedMainIdeas — блок «УЖЕ РАСКРЫТЫЕ ТЕМЫ» в промпте. Следующая попытка (и следующий пост прогона) получает её в списке исключений и выбирает другую тему. Работает в обоих флоу через общий пайплайн.
3. **getUsedMainIdeas включает дубли** (оба флоу): новые `getRevealedMainIdeas()` в `nataliaChannelPostRepository` / `transcriptPostRepository` возвращают mainIdea SENT- и DUPLICATE-постов (REJECTED-черновики раскрытыми не считаются). Кнопка «ещё» больше не предлагает темы, которые уже были сгенерированы и отклонены. `getSentPosts()` не тронут — используется для отображения.

## Преимущества

- ✅ Новый источник постов без транскриптов: карта канала → пост, всегда на свежих данных
- ✅ Двухбарьерная защита: дубли по порогам + релевантность (nataliaSimilarity < 0.5) — «почти-дубли» больше не проходят
- ✅ NataliaChannelPost сам участвует в дедупликации — сгенерированные посты не повторяют друг друга
- ✅ Один пайплайн на два флоу: багфикс в цикле попыток/дедупе чинит обе команды сразу
- ✅ Prefix-кэш промпта: статичная часть user message не меняется между вызовами
- ✅ Transcript-флоу и идеи получили фильтр релевантности без изменения своих API
- ✅ 17 тестов на новую логику (similarityResolver, relevanceFilter, nataliaChannelContext, thresholdResolver), `npm test`
