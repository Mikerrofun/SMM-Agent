---

**Дата:** 13.08.2026  
**Теги:** #features #transcript-post #pdf #pgvector #openai #telegram-bot

---

## 1. Зачем

Раньше единственным источником контента были посты конкурентов: парсер собирал их, `ideaExtractor` вытаскивал идею, `postGenerator` писал пост в стиле Натальи. Но самый ценный материал — не чужие посты, а реальные встречи с клиентами: там живые боли, формулировки и возражения, которых нет ни у одного конкурента.

Транскрипции встреч уже существовали, но лежали в виде PDF-файлов и в контент не превращались — их читали вручную и вручную же придумывали посты. Нужен был путь `PDF → 2 готовых поста в Telegram`, при котором посты не повторяют ни уже опубликованные посты Натальи, ни друг друга.

## 2. Где/что уже было

Фича почти целиком собрана из существующих кусков:

```ts
// src/core/lib/openai.ts
export const openai = new OpenAI({ apiKey });
export const DEFAULT_MODEL = "gpt-4o-mini";

// src/shared/utils/retry.ts
export async function withRetry<T>(fn: () => Promise<T>, config: RetryConfig): Promise<T>

// src/shared/utils/promptLoader.ts
export function loadPrompt(filename: string): string

// src/ai/embeddings.ts
export async function createEmbedding(text: string): Promise<number[]>

// src/ai/mainIdeaExtractor.ts
export async function extractMainIdea(postText: string): Promise<string>
```

Переиспользуется и вся механика дедупликации из генерации идей:

```ts
// src/services/idea/deduplication.config.ts
export const SIMILARITY_THRESHOLD = 0.75;
export const DEDUPLICATION_RETRY_CONFIG: RetryConfig = { ... };

// src/repositories/nataliaPostRepository.ts
export async function findSimilarNataliaPosts(embedding: number[], threshold: number)
```

Промпт тоже не новый — используется тот же `src/prompts/generate-post.md`, что и в `postGenerator.ts`, стиль Натальи от источника не зависит. Новое здесь только три вещи: парсинг PDF, две таблицы в БД и оркестратор попыток.

Модели добавлены в `prisma/schema.prisma`:

```prisma
model ClientTranscript {
  id          String    @id @default(cuid())
  text        String
  fileName    String?
  uploadedAt  DateTime  @default(now())
  processedAt DateTime?
  posts       TranscriptPost[]
}

model TranscriptPost {
  id            String   @id @default(cuid())
  transcriptId  String
  text          String
  mainIdea      String
  embedding     Unsupported("vector(1536)")?
  similarity    Float?
  isDuplicate   Boolean  @default(false)
  attemptNumber Int      @default(1)
  createdAt     DateTime @default(now())
  transcript    ClientTranscript @relation(fields: [transcriptId], references: [id], onDelete: Cascade)
}
```

## 3. Реализация

### PDF парсер

```ts
// src/shared/utils/pdfParser.ts
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const result = await parser.getText();
    rawText = result.text ?? '';
  } catch (error) {
    if (name === 'PasswordException' || /password/i.test(message)) {
      throw new PasswordProtectedPdfError(undefined, err);
    }
    throw new InvalidPdfError(`Не удалось прочитать PDF: ${message}`, err);
  } finally {
    await parser.destroy().catch(() => undefined);
  }

  const text = normalizePdfText(rawText);

  if (text.length === 0) throw new EmptyPdfError();
  if (text.length < MIN_PDF_TEXT_LENGTH) throw new InsufficientContentError(...);

  return text;
}
```

`normalizePdfText()` схлопывает неразрывные пробелы, дубли пробелов и 3+ переносов строки до двух — абзацы сохраняются, мусор из PDF-верстки уходит. Все ошибки наследуют `PdfParserError` (`src/shared/utils/pdfParser.errors.ts`), поэтому бот одним `instanceof` отличает понятную пользователю ошибку от неожиданной.

### AI модуль

```ts
// src/ai/transcriptPostGenerator.ts
export async function generatePostFromTranscript(
  transcriptText: string,
  excludeMainIdeas: string[] = []
): Promise<string> {
  const preparedText = truncateTranscript(transcriptText.trim());
  const systemPrompt = loadPrompt(TRANSCRIPT_PROMPT_PATH);

  const avoidBlock = excludeMainIdeas.length > 0
    ? `\nУЖЕ РАСКРЫТЫЕ ТЕМЫ (не повторяй их, выбери другой инсайт):\n...`
    : '';

  const userMessage = `<untrusted_source>
ТРАНСКРИПЦИЯ ВСТРЕЧИ С КЛИЕНТОМ:

${preparedText}
${avoidBlock}
ЗАДАЧА:
Извлеки из транскрипции ключевой инсайт или проблему клиента.
Создай пост для Telegram-канала Натальи, раскрывающий эту тему.
</untrusted_source>`;

  const response = await openai.chat.completions.create({ ... });
}
```

`truncateTranscript()` при длине > 8000 символов берёт 6000 с начала и 2000 с конца:

```ts
return `${head}\n\n[...фрагмент транскрипции пропущен...]\n\n${tail}`;
```

### Repository

`clientTranscriptRepository.ts` — обычный CRUD (`createTranscript`, `getTranscriptById`, `markAsProcessed`). Вектора нет, поэтому Prisma хватает.

`transcriptPostRepository.ts` — вектор через raw SQL, как в `nataliaPostRepository.ts`:

```ts
export async function updateEmbedding(id: string, embedding: number[]): Promise<void> {
  const vectorLiteral = `[${embedding.join(',')}]`;
  await prisma.$executeRaw`
    UPDATE "TranscriptPost"
    SET embedding = ${vectorLiteral}::vector
    WHERE id = ${id}
  `;
}

export async function findSimilarPosts(
  embedding: number[],
  threshold: number,
  excludeIds: string[] = []
): Promise<SimilarityMatch[]> {
  await prisma.$queryRaw`
    SELECT id, (1 - (embedding <=> ${vectorLiteral}::vector)) AS similarity
    FROM "TranscriptPost"
    WHERE embedding IS NOT NULL
      AND id != ALL(${excludeIds}::text[])
      AND (1 - (embedding <=> ${vectorLiteral}::vector)) >= ${threshold}
    ORDER BY similarity DESC
  `;
}
```

### Deduplication service

```ts
// src/services/transcript/deduplicationService.ts
export async function checkPostDuplication(
  embedding: number[],
  excludePostIds: string[] = []
): Promise<DuplicationResult> {
  const [nataliaMatches, transcriptMatches] = await Promise.all([
    findSimilarNataliaPosts(embedding, 0),
    findSimilarPosts(embedding, 0, excludePostIds),
  ]);

  // берём максимум из двух источников
  const isDuplicate = maxSimilarity >= SIMILARITY_THRESHOLD;

  return { isDuplicate, maxSimilarity, source, matchedId };
}
```

Порог берётся не свой, а тот же `SIMILARITY_THRESHOLD = 0.75` из `services/idea/deduplication.config.ts`. `generateAndCheckEmbedding()` оборачивает `createEmbedding` + `checkPostDuplication` в `withRetry` и переупаковывает любую ошибку в `DeduplicationError`.

Порог сравнивается с максимумом по двум источникам, поэтому в результате остаётся `source: 'natalia' | 'transcript'` — видно, с чем именно совпал пост.

### Processing service

Основной оркестратор — 2 поста × до 3 попыток:

```ts
// src/services/transcript/transcriptProcessingService.ts
for (let postIndex = 1; postIndex <= POSTS_PER_TRANSCRIPT; postIndex++) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_POST; attempt++) {
    const postText = await withRetry(
      () => generatePostFromTranscript(transcript.text, acceptedMainIdeas),
      AI_RETRY_CONFIG
    );
    const mainIdea = await withRetry(() => extractMainIdea(postText), AI_RETRY_CONFIG);

    const post = await createTranscriptPost({ transcriptId, text: postText, mainIdea, attemptNumber: attempt });
    draftIds.push(post.id);

    const dedupResult = await generateAndCheckEmbedding(mainIdea, draftIds);
    await updateEmbedding(post.id, dedupResult.embedding);

    if (!dedupResult.isDuplicate) {
      accepted = { ...post, similarity: dedupResult.maxSimilarity };
      acceptedMainIdeas.push(mainIdea);
      stats.uniquePosts++;
      break;
    }

    if (bestCandidate === null || dedupResult.maxSimilarity < bestCandidate.similarity) {
      bestCandidate = { post, similarity: dedupResult.maxSimilarity };
    }
  }

  // все попытки — дубли: отдаём лучшую (минимальная similarity) с флагом
  if (accepted === null && bestCandidate !== null) {
    accepted = await markAsDuplicate(bestCandidate.post.id, bestCandidate.similarity);
    stats.duplicatePosts++;
  }
}
```

Ключевые детали:

- `acceptedMainIdeas` передаётся в следующую генерацию — второй пост знает тему первого и не дублирует её на уровне промпта, ещё до векторной проверки.
- `draftIds` — id постов текущей серии попыток, они исключаются из векторного поиска. Иначе пост сравнивался бы сам с собой (similarity = 1.0) и с собственной провалившейся попыткой.
- Пост пишется в БД **до** проверки на дубль: черновики нужны для аналитики (`attemptNumber`, `isDuplicate`), видно, сколько попыток стоил каждый пост.
- Ошибка одной попытки не рушит прогон — она пишется в `errors[]`, цикл продолжается.

### Bot

```ts
// src/bot/commands/transcriptPost.ts
const waitingForPdf = new Map<number, boolean>();

export async function handleTranscriptCommand(ctx: Context): Promise<void> {
  waitingForPdf.set(userId, true);
  await ctx.reply('📄 Отправь PDF файл с транскрипцией встречи с клиентом...');
}

export async function handlePdfDocument(ctx: Context): Promise<void> {
  if (!userId || !waitingForPdf.get(userId)) return; // не наш документ

  // валидация: mime_type / .pdf, file_size <= 10MB
  const file = await ctx.api.getFile(document.file_id);
  const buffer = Buffer.from(await (await fetch(fileUrl)).arrayBuffer());

  const text = await extractTextFromPdf(buffer);
  const transcript = await createTranscript({ text, fileName: document.file_name });

  const statusMessage = await ctx.reply('⏳ Генерирую посты... Это займет 30-60 секунд');
  const result = await processTranscript(transcript.id);

  await ctx.api.deleteMessage(ctx.chat.id, statusMessage.message_id);
  await sendTranscriptPosts(ctx, result.posts);
}
```

Регистрация в `src/bot/index.ts`:

```ts
bot.command("transcript_post", handleTranscriptCommand);

// Срабатывает на все документы; внутри проверяется, ждём ли мы PDF от юзера
bot.on("message:document", handlePdfDocument);
```

## 4. UI

Флоу в Telegram:

```
Юзер: /transcript_post
Бот:  📄 Отправь PDF файл с транскрипцией встречи с клиентом.
      После обработки я сгенерирую 2 поста в стиле Натальи.

Юзер: [meeting-2026-08-13.pdf]
Бот:  ⏳ Генерирую посты... Это займет 30-60 секунд     ← удаляется по завершении

Бот:  ✅ *Пост 1*
      [текст поста]

Бот:  ⚠️ *Пост 2* (похож на существующий, similarity: 0.81)
      [текст поста]

Бот:  ⚠️ Сгенерировано 2 поста, но 1 похож на существующие.
      Возможно, эта тема уже частично раскрыта.
```

Итоговое сообщение зависит от результата: все уникальны → `✅ Готово!`, часть дублей → предупреждение, все дубли → `⚠️ Все посты похожи на существующие (similarity > 0.75)`. Между постами 500 мс, чтобы Telegram не порезал сообщения по rate limit. Текст поста прогоняется через `escapeMarkdown()` — иначе символы вроде `_` и `*` из поста ломают `parse_mode: Markdown`.

Ошибки пользователь видит как готовое сообщение, без стектрейсов: `❌ Файл должен быть в формате PDF`, `❌ Файл слишком большой (max 10MB)`, `❌ PDF защищён паролем`, `❌ В PDF нет текстового слоя`.

## 5. Поток данных

```
/transcript_post
  ↓
waitingForPdf.set(userId, true)
  ↓
Юзер отправляет документ → bot.on("message:document") → handlePdfDocument()
  ↓
Валидация (PDF? <= 10MB?) → ctx.api.getFile() → fetch → Buffer
  ↓
extractTextFromPdf(buffer) → normalizePdfText() → проверка >= 100 символов
  ↓
createTranscript({ text, fileName }) → ClientTranscript
  ↓
processTranscript(transcriptId)
  │
  ├─ для каждого из 2 постов, до 3 попыток:
  │    generatePostFromTranscript(text, acceptedMainIdeas)   ← withRetry × 3
  │      ↓
  │    extractMainIdea(postText)                             ← withRetry × 3
  │      ↓
  │    createTranscriptPost() → TranscriptPost (черновик)
  │      ↓
  │    createEmbedding(mainIdea) → 1536-мерный вектор
  │      ↓
  │    Promise.all([findSimilarNataliaPosts, findSimilarPosts(excludeIds=draftIds)])
  │      ↓
  │    updateEmbedding(postId, embedding)   — pgvector через raw SQL
  │      ↓
  │    maxSimilarity < 0.75 ? принять и выйти : запомнить как bestCandidate
  │
  ├─ все попытки дубли → markAsDuplicate(bestCandidate) — минимальная similarity
  │
  └─ markAsProcessed(transcriptId) — если принят хотя бы один пост
  ↓
sendTranscriptPosts(ctx, posts) → 2 сообщения + сводка
```

## 6. Почему так, а не иначе

1. **Транскрипция сохраняется в БД до генерации.** PDF парсится один раз, дальше работаем с `ClientTranscript.id`. Если генерация упала, текст не потерян — можно перезапустить `processTranscript(transcriptId)` без повторной загрузки файла.

2. **`bot.on("message:document")` вместо conversation.** Grammy-conversations пришлось бы тащить как зависимость и хранить состояние диалога. Здесь состояние — один `Map<userId, boolean>`, который живёт до первого документа и чистится в `finally`. Сторонний документ (не после команды) просто игнорируется.

3. **Черновики пишутся в БД до проверки на дубль.** Альтернатива — держать попытки в памяти и сохранять только победителя. Но тогда исчезает статистика: с какой попытки получился пост, сколько дублей отбраковано, какие темы модель предлагает повторно. `attemptNumber` + `isDuplicate` дают эти данные бесплатно.

4. **`excludeIds` в векторном поиске.** Пост уже лежит в БД со своим embedding, поэтому без исключения он нашёл бы себя с similarity = 1.0 и всегда считался дублем. Исключаются и провалившиеся попытки текущего поста — они мусор, а не контент.

5. **`acceptedMainIdeas` в промпте.** Векторная проверка ловит дубль *после* генерации — это потраченный вызов LLM. Передача уже раскрытых тем в промпт снижает вероятность дубля заранее, поэтому второй пост обычно проходит с первой попытки.

6. **Дубль отдаётся пользователю, а не отбрасывается.** После 3 попыток лучше показать пост с честной пометкой `⚠️ similarity: 0.81`, чем `❌ ничего не вышло`. Человек сам решит: тема действительно исчерпана или формулировка достаточно другая. Выбирается кандидат с **минимальной** similarity — наименее похожий из плохих вариантов.

7. **Порог 0.75 переиспользован, а не задан свой.** Смысл дедупликации одинаковый: не повторять то, что уже написано. Два независимых порога рано или поздно разъехались бы, и одна и та же тема считалась бы дублем в одном флоу и уникальной в другом.

8. **Промпт `generate-post.md` общий с `postGenerator.ts`.** Стиль Натальи не зависит от источника контента. Адаптация под транскрипцию сделана не отдельным промптом, а user-message-ом (`ЗАДАЧА: извлеки ключевой инсайт...`) — стиль правится в одном файле.

9. **Обрезка «начало + конец», а не первые 8000 символов.** Во встрече начало — знакомство и постановка проблемы, конец — выводы и договорённости. Простая обрезка сверху выкинула бы самое ценное.

10. **`<untrusted_source>` вокруг транскрипции.** Транскрипция — внешний текст, в него может попасть что угодно, включая фразы, похожие на инструкции. Тег фиксирует границу данных, как в `postGenerator.ts`.

## Преимущества

- ✅ Новый источник контента без нового пайплайна — переиспользованы `openai`, `withRetry`, `promptLoader`, `createEmbedding`, `extractMainIdea`, `findSimilarNataliaPosts`
- ✅ Дедупликация сразу по двум источникам (`NataliaPost` + `TranscriptPost`) одним `Promise.all`
- ✅ Двухуровневая защита от повторов: темы в промпте (до генерации) + вектор (после)
- ✅ Единый порог 0.75 с флоу генерации идей — поведение системы предсказуемо
- ✅ Полная трассируемость: `attemptNumber`, `similarity`, `isDuplicate` по каждому черновику
- ✅ Отказоустойчивость: `withRetry` на каждом AI-вызове, ошибка попытки не рушит прогон, `errors[]` в результате
- ✅ Понятные ошибки в Telegram вместо стектрейсов — отдельные классы под каждый случай PDF
- ✅ Prompt injection закрыт через `<untrusted_source>` — транскрипция не переопределяет системный промпт
- ✅ `onDelete: Cascade` — удаление транскрипции чистит её посты, сирот в БД не остаётся
