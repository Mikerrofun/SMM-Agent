---

**Дата:** 10.08.2026  
**Теги:** #features #post-generation #openai #telegram-bot

---

## 1. Зачем

Бот умел отправлять идеи для постов, но кнопка "✍️ Сгенерировать пост" показывала заглушку. Нужно было реализовать полный цикл: взять идею + пост конкурента, сгенерировать пост в стиле Натальи через OpenAI, сохранить в БД, отправить пользователю с возможностью перегенерации. Без этого идеи висели мёртвым грузом — пользователь всё равно писал посты вручную.

## 2. Где/что уже было

Переиспользуется вся инфраструктура из генерации идей:

```ts
// src/core/lib/openai.ts
export const openai = new OpenAI({ apiKey });
export const DEFAULT_MODEL = "gpt-4o-mini";
```

```ts
// src/shared/utils/retry.ts
export async function withRetry<T>(fn: () => Promise<T>, config: RetryConfig): Promise<T>
```

```ts
// src/shared/utils/promptLoader.ts
export function loadPrompt(filename: string): string
```

Схема БД уже включала таблицу `GeneratedPost` со связью на `Idea`:

```prisma
model GeneratedPost {
  id        String   @id @default(cuid())
  ideaId    String   @unique
  text      String
  mainIdea  String?  // Добавлено 19.08.2026 — для будущей экстракции главной идеи
  createdAt DateTime @default(now())
  idea Idea @relation(fields: [ideaId], references: [id], onDelete: Cascade)
}
```

Паттерн для AI модулей уже существовал в `src/ai/ideaExtractor.ts` — новый модуль `postGenerator.ts` следует той же структуре. Задача была не писать новое, а использовать существующие утилиты и добавить один новый AI вызов.

## 3. Реализация

### AI модуль

```ts
// src/ai/postGenerator.ts
export async function generatePost(input: GeneratePostInput): Promise<string> {
  const systemPrompt = loadPrompt(POST_PROMPT_PATH);
  
  const userMessage = `<untrusted_source>
ИДЕЯ:
Заголовок: ${idea.title}
Основная идея: ${idea.mainIdea}
Цель: ${idea.goal}

ПОСТ КОНКУРЕНТА:
${trimmedText}
</untrusted_source>`;
  
  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: POST_MAX_TOKENS,
    temperature: POST_TEMPERATURE,
  });
  
  return response.choices[0]?.message?.content.trim();
}
```

Конфиг вынесен отдельно:

```ts
// src/ai/postGenerator.config.ts
export const POST_MAX_TOKENS = 2000;
export const POST_TEMPERATURE = 0.7;
export const POST_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffFactor: 2,
};
```

### Repository

```ts
// src/repositories/generatedPostRepository.ts
export async function createGeneratedPost(data: { ideaId: string; text: string }) {
  return prisma.$transaction(async (tx) => {
    const generatedPost = await tx.generatedPost.create({ data });
    await tx.idea.update({
      where: { id: data.ideaId },
      data: { status: 'SELECTED' },
    });
    return generatedPost;
  });
}

export async function getIdeaWithCompetitorPost(ideaId: string) {
  return prisma.idea.findUnique({
    where: { id: ideaId },
    include: { competitorPost: true },
  });
}
```

Транзакция обязательна — пост и статус идеи меняются атомарно. Остальные функции repository (`deleteGeneratedPostAndResetIdea`, `getGeneratedPostByIdeaId`) добавлены для регенерации.

### Service

```ts
// src/services/post/postGenerationService.ts
export async function generatePostForIdea(ideaId: string): Promise<PostGenerationResult> {
  const idea = await getIdeaWithCompetitorPost(ideaId);
  
  if (idea.status === 'SELECTED') {
    const existingPost = await getGeneratedPostByIdeaId(ideaId);
    if (existingPost) {
      return { success: true, postText: existingPost.text, ideaId };
    }
  }
  
  const postText = await withRetry(
    async () => generatePost({ idea, competitorPostText: idea.competitorPost.text }),
    POST_RETRY_CONFIG
  );
  
  await createGeneratedPost({ ideaId, text: postText });
  
  return { success: true, postText, ideaId };
}
```

Если пост уже существует — возвращается сразу, без ошибки. Для перегенерации есть отдельная функция `regeneratePostForIdea()`, которая удаляет старый и создаёт новый.

## 4. UI

```ts
// src/bot/commands/ideas.ts
export async function handleGeneratePostCallback(ctx: Context) {
  const ideaId = callbackData.replace("generate_post:", "");
  
  await ctx.answerCallbackQuery({ text: "⏳ Генерирую пост..." });
  const statusMessage = await ctx.reply("⏳ Генерирую пост...");
  
  const result = await generatePostForIdea(ideaId);
  
  await ctx.api.deleteMessage(ctx.chat!.id, statusMessage.message_id);
  
  const keyboard = new InlineKeyboard().text("🔄 Перегенерировать", `regenerate_post:${ideaId}`);
  
  await ctx.reply(
    `✅ *Сгенерированный пост:*\n\n${escapeMarkdown(result.postText)}`,
    {
      parse_mode: "Markdown",
      reply_markup: keyboard,
      reply_to_message_id: messageId,
    }
  );
}
```

Кнопка "✍️ Сгенерировать пост" уже была на сообщениях с идеями. Handler заменил заглушку на реальный вызов. Пост отправляется как reply на оригинальное сообщение с идеей — для контекста.

## 5. Поток данных

```
Клик "✍️ Сгенерировать пост"
  ↓
handleGeneratePostCallback(ctx) извлекает ideaId
  ↓
generatePostForIdea(ideaId)
  ↓
getIdeaWithCompetitorPost() — JOIN с CompetitorPost
  ↓
Проверка existingPost → если есть, возврат сразу
  ↓
withRetry(generatePost()) → 3 попытки OpenAI API
  ↓
createGeneratedPost() — транзакция (insert + update status)
  ↓
Бот отправляет пост с reply + кнопка "🔄 Перегенерировать"
```

## 6. Почему так, а не иначе

1. **Промпт в отдельном файле (`generate-post.md`)** — стиль Натальи может меняться, и его правят без коммитов в код. Промпт ~2500 токенов, внутри кода это засорило бы.

2. **Транзакция на уровне repository** — статус идеи и пост должны меняться атомарно. Если сохранение поста упадёт после смены статуса, идея застрянет в `SELECTED` без реального поста.

3. **Возврат существующего поста при повторном вызове** — пользователь не всегда помнит, генерил ли он пост. Вместо ошибки просто возвращаем то, что есть. Для перегенерации — отдельная кнопка.

4. **Reply на сообщение с идеей** — в Telegram может быть несколько идей подряд. Reply даёт контекст, какой пост к какой идее относится. Без него — каша.

5. **Service как оркестратор** — repository только читает/пишет, AI модуль только генерирует. Service связывает: валидация → retry → сохранение. Паттерн взят из `ideaProcessor.ts`.

## Преимущества

- ✅ Повторное использование OpenAI клиента, retry, promptLoader — новый код минимален
- ✅ Транзакции Prisma гарантируют консистентность статуса идеи и поста
- ✅ 3 retry с backoff справляются с временными ошибками OpenAI
- ✅ Prompt injection защищён через `<untrusted_source>` — пост конкурента не может переопределить инструкции
- ✅ Reply на идею даёт контекст в Telegram без дополнительной логики
- ✅ Temperature=0.7 — баланс между креативностью и связностью текста
