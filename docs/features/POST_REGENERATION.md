---

**Дата:** 20.08.2026  
**Теги:** #features #post-regeneration #openai #telegram-bot #feedback

---

## 1. Зачем

После генерации поста пользователь может быть недоволен результатом — текст не цепляет, структура не та, формулировки не подходят. Раньше приходилось генерировать весь пост заново через кнопку "✍️ Сгенерировать пост", что создавало дубли идей и засоряло БД. Нужна была кнопка "Перегенерировать" которая обновляет существующий пост, сохраняя основную идею (mainIdea) неизменной, но меняя подачу. Плюс возможность дать фидбек ("сделай короче", "добавь эмоций") чтобы AI учёл замечания при переписи.

## 2. Где/что уже было

Переиспользуется вся инфраструктура из генерации постов и транскриптов:

```ts
// src/ai/mainIdeaExtractor.ts — извлечение mainIdea для GeneratedPost
export async function extractMainIdea(postText: string): Promise<string>

// src/shared/utils/retry.ts — retry логика для AI вызовов
export async function withRetry<T>(fn: () => Promise<T>, config: RetryConfig): Promise<T>

// src/shared/utils/promptLoader.ts — загрузка промптов из файлов
export function loadPrompt(filename: string): string

// src/core/lib/openai.ts — OpenAI клиент
export const openai = new OpenAI({ apiKey });
export const DEFAULT_MODEL = "gpt-4o-mini";
```

Схема БД уже включала поле `mainIdea` в обеих таблицах постов:

```prisma
model GeneratedPost {
  id        String   @id @default(cuid())
  ideaId    String   @unique
  text      String
  mainIdea  String?  // nullable — извлекается при первой перегенерации
  createdAt DateTime @default(now())
}

model TranscriptPost {
  id           String   @id @default(cuid())
  transcriptId String
  text         String
  mainIdea     String   // всегда заполнено — извлекается при первой генерации
  // ...
}
```

Паттерн Map для хранения состояния ожидания ввода уже использовался в `documentHandler.ts`:

```ts
// src/bot/commands/transcriptPost/documentHandler.ts
export const waitingForPdf = new Map<number, boolean>();
```

Задача была не писать новую инфраструктуру, а использовать существующую — добавить AI модуль для перегенерации, service-обёртку и bot handlers.

## 3. Реализация

### AI модуль

```ts
// src/ai/postRegenerator.ts
import { openai, DEFAULT_MODEL } from '../core/lib/openai';
import { loadPrompt } from '../shared/utils/promptLoader';

export async function regeneratePost(input: RegeneratePostInput): Promise<string> {
  const { currentText, mainIdea, feedback } = input;

  const systemPrompt = loadPrompt(REGENERATE_PROMPT_PATH);

  const userMessage = `<untrusted_source>
ИСХОДНЫЙ ПОСТ (который надо переписать):
${currentText}

MAIN IDEA (обязательно сохрани эту суть):
${mainIdea}

ФИДБЕК ПОЛЬЗОВАТЕЛЯ:
${feedback || 'Перепиши пост, сохраняя основную идею, но измени стилистику и формулировки'}
</untrusted_source>`;

  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: REGENERATE_MAX_TOKENS,
    temperature: REGENERATE_TEMPERATURE,
  });

  return response.choices[0]?.message?.content.trim();
}
```

Конфиг вынесен в отдельный файл (паттерн из `postGenerator.config.ts`):

```ts
// src/ai/postRegenerator.config.ts
export const REGENERATE_MAX_TOKENS = 2000;
export const REGENERATE_TEMPERATURE = 0.7;
export const REGENERATE_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffFactor: 2,
};
```

### Repositories

Добавлены методы для работы с обоими типами постов:

```ts
// src/repositories/generatedPostRepository.ts
export async function getGeneratedPostById(id: string): Promise<GeneratedPostModel | null>
export async function updateGeneratedPostText(
  id: string, 
  text: string, 
  mainIdea?: string
): Promise<GeneratedPostModel>

// src/repositories/transcriptPostRepository.ts
export async function getTranscriptPostById(id: string): Promise<TranscriptPostData | null>
export async function updateTranscriptPostText(
  id: string, 
  text: string
): Promise<TranscriptPostData>
```

### Service — универсальная логика для обоих типов

```ts
// src/services/post/postRegenerationService.ts
export async function regeneratePostUniversal(
  postId: string,
  postType: PostType, // 'generated' | 'transcript'
  feedback?: string
): Promise<PostRegenerationResult> {
  const post = postType === 'generated'
    ? await getGeneratedPostById(postId)
    : await getTranscriptPostById(postId);

  let mainIdea = post.mainIdea;

  // Для GeneratedPost: извлечь mainIdea если его нет
  if (postType === 'generated' && !mainIdea) {
    mainIdea = await withRetry(
      async () => await extractMainIdea(post.text),
      REGENERATE_RETRY_CONFIG
    );
  }

  const newText = await withRetry(
    async () => regeneratePost({ currentText: post.text, mainIdea: mainIdea!, feedback }),
    REGENERATE_RETRY_CONFIG
  );

  // Обновить в БД
  if (postType === 'generated') {
    await updateGeneratedPostText(
      postId, 
      newText, 
      !post.mainIdea ? mainIdea : undefined // сохранить mainIdea если извлекли
    );
  } else {
    await updateTranscriptPostText(postId, newText);
  }

  return { success: true, postText: newText, postId };
}

// Wrapper-функции для удобства
export async function regenerateGeneratedPost(postId: string, feedback?: string)
export async function regenerateTranscriptPost(postId: string, feedback?: string)
```

**Ключевое отличие типов постов:**
- **GeneratedPost** — `mainIdea` nullable. Экономим токены при первичной генерации, извлекаем только при перегенерации если нужно. После извлечения сохраняем в БД для следующих перегенераций.
- **TranscriptPost** — `mainIdea` всегда есть (требование для дедупликации). Сразу извлекается при первой генерации транскрипта.

### Validation

```ts
// src/shared/utils/feedbackValidator.ts
const MAX_FEEDBACK_LENGTH = 1000;

export function validateFeedback(text: string): string {
  const trimmed = text.trim();
  
  if (trimmed.length === 0) {
    throw new Error('Фидбек не может быть пустым');
  }
  
  if (trimmed.length > MAX_FEEDBACK_LENGTH) {
    return trimmed.substring(0, MAX_FEEDBACK_LENGTH);
  }
  
  return trimmed;
}
```

## 4. UI

Кнопки добавлены под каждым сгенерированным постом. Для GeneratedPost:

```ts
// src/bot/commands/ideas.ts
const keyboard = new InlineKeyboard()
  .text("🔄 Перегенерировать", `regenerate_idea_post:${result.postId}`)
  .text("✏️ С уточнением", `regenerate_idea_post_feedback:${result.postId}`);
```

Для TranscriptPost:

```ts
// src/bot/commands/transcriptPost/renderer.ts
const keyboard = new InlineKeyboard()
  .text('🔄 Перегенерировать', `regenerate_transcript_post:${post.id}`)
  .text('✏️ С уточнением', `regenerate_transcript_post_feedback:${post.id}`);
```

### Handlers — 2 универсальные функции для обоих типов

```ts
// src/bot/commands/regeneratePost.ts
export const waitingForFeedback = new Map<number, WaitingForFeedbackState>();

// Автоматическая перегенерация
export async function handleRegeneratePostCallback(ctx: Context) {
  const callbackData = ctx.callbackQuery?.data;
  
  // Определяем тип по префиксу
  const isGenerated = callbackData.startsWith('regenerate_idea_post:');
  const isTranscript = callbackData.startsWith('regenerate_transcript_post:');
  const postType: PostType = isGenerated ? 'generated' : 'transcript';
  
  const prefix = isGenerated ? 'regenerate_idea_post:' : 'regenerate_transcript_post:';
  const postId = callbackData.replace(prefix, '');
  
  // Удаляем старое сообщение
  await ctx.api.deleteMessage(chatId, messageId);
  
  const statusMessage = await ctx.reply('⏳ Генерирую новый пост...');
  
  // Вызываем service
  const result = postType === 'generated'
    ? await regenerateGeneratedPost(postId)
    : await regenerateTranscriptPost(postId);
  
  await ctx.api.deleteMessage(ctx.chat!.id, statusMessage.message_id);
  
  // Отправляем новый пост с теми же кнопками
  const callbackPrefix = postType === 'generated' ? 'regenerate_idea_post' : 'regenerate_transcript_post';
  const keyboard = new InlineKeyboard()
    .text('🔄 Перегенерировать', `${callbackPrefix}:${postId}`)
    .text('✏️ С уточнением', `${callbackPrefix}_feedback:${postId}`);
  
  await ctx.reply(`✅ <b>Новый вариант поста:</b>\n\n${result.postText}`, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}

// Перегенерация с запросом фидбека
export async function handleRegeneratePostFeedbackCallback(ctx: Context) {
  const callbackData = ctx.callbackQuery?.data;
  
  const isGenerated = callbackData.startsWith('regenerate_idea_post_feedback:');
  const postType: PostType = isGenerated ? 'generated' : 'transcript';
  const prefix = isGenerated ? 'regenerate_idea_post_feedback:' : 'regenerate_transcript_post_feedback:';
  const postId = callbackData.replace(prefix, '');
  
  await ctx.api.deleteMessage(chatId, messageId);
  
  // Сохраняем состояние ожидания
  waitingForFeedback.set(userId, { postId, postType, originalMessageId: messageId ?? 0 });
  
  await ctx.reply('✏️ <b>Напишите что не понравилось в посте</b>\n\nОпишите свои замечания (максимум 1000 символов).');
}

// Обработка текста фидбека
export async function handleFeedbackMessage(ctx: Context) {
  const state = waitingForFeedback.get(userId);
  if (!state) return; // не ждём фидбек от этого пользователя
  
  const { postId, postType } = state;
  const feedbackText = ctx.message?.text;
  
  try {
    const validatedFeedback = validateFeedback(feedbackText);
    
    const statusMessage = await ctx.reply('⏳ Генерирую с учётом ваших замечаний...');
    
    const result = postType === 'generated'
      ? await regenerateGeneratedPost(postId, validatedFeedback)
      : await regenerateTranscriptPost(postId, validatedFeedback);
    
    await ctx.api.deleteMessage(ctx.chat.id, statusMessage.message_id);
    
    // Отправляем новый пост с кнопками
    const callbackPrefix = postType === 'generated' ? 'regenerate_idea_post' : 'regenerate_transcript_post';
    const keyboard = new InlineKeyboard()
      .text('🔄 Перегенерировать', `${callbackPrefix}:${postId}`)
      .text('✏️ С уточнением', `${callbackPrefix}_feedback:${postId}`);
    
    await ctx.reply(`✅ <b>Новый вариант поста:</b>\n\n${result.postText}`, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } finally {
    waitingForFeedback.delete(userId); // всегда очищаем состояние
  }
}
```

Регистрация в bot:

```ts
// src/bot/index.ts
bot.callbackQuery(/^regenerate_(idea|transcript)_post:/, handleRegeneratePostCallback);
bot.callbackQuery(/^regenerate_(idea|transcript)_post_feedback:/, handleRegeneratePostFeedbackCallback);

// ВАЖНО: handler для фидбека должен быть последним, чтобы не перехватывать команды
bot.on("message:text", handleFeedbackMessage);
```

## 5. Поток данных

### Автоматическая перегенерация (кнопка "🔄")

```
Клик "🔄 Перегенерировать"
  ↓
handleRegeneratePostCallback(ctx)
  ↓
Извлечь postType из callbackData (regenerate_idea_post: vs regenerate_transcript_post:)
  ↓
Удалить старое сообщение с постом (ctx.api.deleteMessage)
  ↓
Показать статус "⏳ Генерирую новый пост..."
  ↓
Вызвать regenerateGeneratedPost(postId) или regenerateTranscriptPost(postId)
  ↓
regeneratePostUniversal(postId, postType, null)
  ↓
getGeneratedPostById(postId) или getTranscriptPostById(postId) → post
  ↓
[Только для GeneratedPost] Если post.mainIdea === null:
  withRetry(extractMainIdea(post.text)) → mainIdea
  ↓
withRetry(regeneratePost({ currentText: post.text, mainIdea, feedback: null }))
  ↓
OpenAI API (model: gpt-4o-mini, temperature: 0.7, max_tokens: 2000)
  ↓
newText
  ↓
updateGeneratedPostText(postId, newText, mainIdea?) или updateTranscriptPostText(postId, newText)
  ↓
Удалить статус сообщение
  ↓
Отправить новый пост с теми же кнопками (🔄 + ✏️)
```

### Перегенерация с фидбеком (кнопка "✏️")

```
Клик "✏️ С уточнением"
  ↓
handleRegeneratePostFeedbackCallback(ctx)
  ↓
Извлечь postType из callbackData
  ↓
Удалить старое сообщение
  ↓
waitingForFeedback.set(userId, { postId, postType })
  ↓
Отправить: "✏️ Напишите что не понравилось в посте"
  ↓
[Ожидание текстового сообщения от пользователя]
  ↓
Пользователь отправляет текст
  ↓
handleFeedbackMessage(ctx)
  ↓
waitingForFeedback.get(userId) → state
  ↓
validateFeedback(feedbackText) → trimmed, max 1000 символов
  ↓
Показать статус "⏳ Генерирую с учётом ваших замечаний..."
  ↓
Вызвать regenerateGeneratedPost(postId, feedback) или regenerateTranscriptPost(postId, feedback)
  ↓
regeneratePostUniversal(postId, postType, feedback)
  ↓
[Далее как в автоматической перегенерации, но с feedback в промпт]
  ↓
waitingForFeedback.delete(userId) в finally
  ↓
Отправить новый пост с кнопками
```

**Критический момент:** `waitingForFeedback.delete(userId)` всегда в `finally` — даже если генерация упала, состояние очищается. Иначе пользователь застрянет в режиме ожидания и все его сообщения будут обрабатываться как фидбек.

## 6. Почему так, а не иначе

1. **Универсальная функция `regeneratePostUniversal` для обоих типов постов вместо дублирования кода.**  
   GeneratedPost и TranscriptPost различаются только способом получения `mainIdea` (извлечение vs уже есть) и методами repository (update). Всё остальное идентично — промпт, AI вызов, retry логика. Одна функция с параметром `postType` сокращает код в 2 раза и упрощает поддержку.

2. **mainIdea извлекается при первой перегенерации (для GeneratedPost), а не при первичной генерации.**  
   Экономим токены — не все посты будут перегенерироваться, зачем платить за извлечение mainIdea сразу. При первой перегенерации извлекаем и сохраняем в БД, все следующие перегенерации используют сохранённое значение.

3. **Map для состояния ожидания фидбека вместо БД.**  
   Паттерн из `documentHandler.ts` — простое временное состояние не требует персистентности. Если бот перезагрузится, пользователю придётся нажать кнопку заново, что не критично. Альтернатива (запись в БД) — overengineering для такого простого кейса.

4. **Удаление старого сообщения перед перегенерацией вместо редактирования.**  
   Telegram API не позволяет редактировать сообщения с кнопками после изменения текста (ограничение API). Удаление + новое сообщение — единственный способ обновить пост с кнопками. Плюс пользователь видит чёткую границу между версиями.

5. **Статус сообщение "⏳ Генерирую..." вместо тихой обработки.**  
   OpenAI может отвечать 5-10 секунд. Без статуса пользователь думает что бот завис. Статус сообщение удаляется сразу после завершения генерации.

6. **Фидбек в `<untrusted_source>` и лимит 1000 символов.**  
   Защита от prompt injection — пользовательский текст не может переопределить инструкции системы. Лимит защищает от слишком длинных текстов (экономия токенов + адекватность ожиданий).

7. **Те же кнопки (🔄 + ✏️) под новым постом.**  
   Пользователь может перегенерировать сколько угодно раз. Нет ограничений на количество попыток — если не понравилось, нажми ещё раз. Это экспериментальная функция для поиска лучшей формулировки.

8. **2 универсальные handler-функции вместо 4 специализированных.**  
   Логика для GeneratedPost и TranscriptPost идентична, меняется только `postType` который извлекается из `callbackData` по префиксу (`regenerate_idea_post:` vs `regenerate_transcript_post:`). DRY принцип — меньше дублирования, проще поддержка.

## Преимущества

- ✅ Максимальное переиспользование существующей инфраструктуры (AI клиент, retry, promptLoader, extractMainIdea)
- ✅ Универсальный service для обоих типов постов — DRY, один путь обновления
- ✅ mainIdea гарантирует сохранение сути при любой перегенерации
- ✅ Экономия токенов — mainIdea для GeneratedPost извлекается только при первой перегенерации
- ✅ Защита от prompt injection через `<untrusted_source>` и лимит фидбека
- ✅ Map паттерн для состояния — просто, не требует БД, автоматическая очистка в finally
- ✅ Retry логика (3 попытки с backoff) справляется с временными ошибками OpenAI
- ✅ Статус сообщения показывают прогресс пользователю
- ✅ Неограниченное количество перегенераций — можно экспериментировать
- ✅ 2 handler-функции вместо 4 — меньше кода, тип поста определяется автоматически по callback_data
