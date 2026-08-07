```markdown
---

**Дата:** 06.08.2026  
**Теги:** #telegram-bot #pipeline #ideas

---

## 1. Зачем

Пайплайн генерации идей (парсинг → AI → дедупликация) запускался только через npm-скрипты вручную. Результаты лежали в БД, но не было способа их просмотреть и получить для работы. Нужен интерфейс через Telegram бота: запустить пайплайн одной командой, получить идеи со статусом NEW, пометить их как отправленные. Это закрывает цикл от парсинга до получения готовых идей пользователем.

## 2. Где/что уже было

Вся бизнес-логика пайплайна существовала:
- Парсинг: `parseCompetitorsChannels()` из `src/parser/competitors/parser.ts`
- Генерация идей: `processIdeaBatch()` из `src/services/idea/ideaProcessor.ts`
- Дедупликация: `deduplicateIdeas()` из `src/services/idea/deduplicationService.ts`
- Репозиторий идей: `getNewIdeasForSending()`, `getUnprocessedCompetitorPosts()` из `src/repositories/ideaRepository.ts`

Telegram бот уже был инициализирован (grammy), но имел только приветствие `/start` и заглушку `/help`. Задача была не писать новую логику генерации, а оркестрировать существующие функции и дать к ним доступ через бота.

## 3. Реализация

### Добавлен метод для смены статуса идей

```ts
// src/repositories/ideaRepository.ts
export async function markIdeasAsSent(ideaIds: string[]): Promise<number> {
  if (ideaIds.length === 0) return 0;

  const result = await prisma.idea.updateMany({
    where: {
      id: { in: ideaIds },
      status: 'NEW',
    },
    data: {
      status: 'SENT',
    },
  });

  return result.count;
}
```

### Создан сервис пайплайна

```ts
// src/services/pipeline/pipelineService.ts
export async function runFullPipeline(
  onProgress: PipelineProgressCallback
): Promise<PipelineResult> {
  let client;
  let generationRun;

  try {
    generationRun = await createGenerationRun();
    client = await initializeTelegramClient();

    const parsingStats = await parseCompetitorsChannels(client, ...);
    const posts = await getUnprocessedCompetitorPosts();
    const ideasStats = await processIdeaBatch({ items: posts, ... });
    const deduplicationStats = await deduplicateIdeas(...);

    await updateGenerationRunSuccess(generationRun.id, {
      processedPosts: parsingStats.savedPosts,
      generatedIdeas: ideasStats.succeeded,
      acceptedIdeas: deduplicationStats.unique,
    });

    return { parsing: parsingStats, ideas: ideasStats, deduplication: deduplicationStats };
  } catch (error) {
    if (generationRun) await updateGenerationRunFailed(generationRun.id);
    throw new Error(`Ошибка выполнения пайплайна: ${errorMessage}`);
  } finally {
    if (client) await disconnectClient(client);
  }
}
```

Сервис не содержит бизнес-логики — только последовательный вызов существующих функций с callback'ами для прогресса и записью в `GenerationRun`.

### Расширен репозиторий GenerationRun

```ts
// src/repositories/generationRunRepository.ts
export async function createGenerationRun(): Promise<GenerationRun> {
  return prisma.generationRun.create({
    data: { status: RunStatus.RUNNING },
  });
}

export async function updateGenerationRunSuccess(
  runId: string,
  stats: { processedPosts: number; generatedIdeas: number; acceptedIdeas: number; }
): Promise<void> {
  await prisma.generationRun.update({
    where: { id: runId },
    data: {
      finishedAt: new Date(),
      status: RunStatus.SUCCESS,
      ...stats,
    },
  });
}
```

Добавлены методы для создания и финализации прогона. Статистика записывается в БД для истории.

## 4. UI

### Команда /ideas

```ts
// src/bot/commands/ideas.ts
export async function handleIdeasCommand(ctx: Context): Promise<void> {
  const ideas = await getNewIdeasForSending(10);

  if (ideas.length === 0) {
    const keyboard = new InlineKeyboard().text("🚀 Запустить генерацию", "run_pipeline");
    await ctx.reply("📭 Нет новых идей...", { reply_markup: keyboard });
    return;
  }

  const sentIdeaIds: string[] = [];
  for (const idea of ideas) {
    const keyboard = new InlineKeyboard().text("✍️ Сгенерировать пост", `generate_post:${idea.id}`);
    await ctx.reply(
      `💡 *${escapeMarkdown(idea.title)}*\n\n` +
      `📝 *Идея:*\n${escapeMarkdown(idea.mainIdea)}\n\n` +
      `🎯 *Цель:*\n${escapeMarkdown(idea.goal)}`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
    sentIdeaIds.push(idea.id);
  }

  await markIdeasAsSent(sentIdeaIds);
  await ctx.reply(`✅ Отправлено ${sentIdeaIds.length} ${pluralizeIdea(sentIdeaIds.length)}!`);
}
```

Каждая идея — отдельное сообщение с кнопкой. После отправки статус меняется на SENT.

### Команда /run_pipeline

```ts
// src/bot/commands/runPipeline.ts
export async function handleRunPipelineCommand(ctx: Context): Promise<void> {
  if (isPipelineRunning) {
    await ctx.reply("⚠️ Пайплайн уже выполняется...");
    return;
  }

  isPipelineRunning = true;
  const statusMessage = await ctx.reply("🚀 Запуск пайплайна...");

  const result = await Promise.race([
    runFullPipeline(async (stage, status) => {
      await ctx.api.editMessageText(statusMessage.chat.id, statusMessage.message_id, status);
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 30 * 60 * 1000))
  ]);

  // формируем финальное сообщение со статистикой
  await ctx.api.editMessageText(statusMessage.chat.id, statusMessage.message_id, finalMessage);
}
```

Статус обновляется в реальном времени через `editMessageText`. Защита от параллельных запусков через флаг `isPipelineRunning`.

### Регистрация в боте

```ts
// src/bot/index.ts
import { handleIdeasCommand, handleGeneratePostCallback, handleRunPipelineCommand, handleRunPipelineCallback } from "./commands";

bot.command("ideas", handleIdeasCommand);
bot.command("run_pipeline", handleRunPipelineCommand);

bot.callbackQuery(/^generate_post:/, handleGeneratePostCallback);
bot.callbackQuery("run_pipeline", handleRunPipelineCallback);
```

## 5. Поток данных

### Запуск пайплайна

```
/run_pipeline → handleRunPipelineCommand
  ↓
createGenerationRun (status: RUNNING)
  ↓
runFullPipeline(onProgress) → parseCompetitorsChannels
  ↓
save CompetitorPost (isProcessed: false)
  ↓
getUnprocessedCompetitorPosts → processIdeaBatch
  ↓
OpenAI GPT-4o → create Idea (status: NEW) + embedding
  ↓
deduplicateIdeas → pgvector similarity search
  ↓
mark duplicates (status: DUPLICATE)
  ↓
updateGenerationRunSuccess → return PipelineResult
  ↓
editMessageText (финальная статистика)
```

### Получение идей

```
/ideas → getNewIdeasForSending (status: NEW)
  ↓
reply (каждая идея отдельным сообщением + inline кнопка)
  ↓
markIdeasAsSent (status: NEW → SENT)
  ↓
reply (итоговое подтверждение)
```

### Inline кнопка из /ideas

```
Клик "🚀 Запустить генерацию"
  ↓
callbackQuery("run_pipeline") → handleRunPipelineCallback
  ↓
answerCallbackQuery → handleRunPipelineCommand
  ↓
[стандартный flow запуска пайплайна]
```

## 6. Почему так, а не иначе

1. **Оркестрирующий сервис вместо прямого вызова в боте**  
   `pipelineService.ts` изолирует последовательность вызовов от Telegram API. Можно будет переиспользовать для cron-задач без дублирования логики.

2. **Запись GenerationRun в БД**  
   История запусков нужна для аналитики и определения cutoff date при инкрементальном парсинге. Без этого каждый запуск парсил бы все посты заново.

3. **Статус SENT вместо немедленного SELECTED/REJECTED**  
   Пользователь сначала получает идеи в Telegram, потом решает что с ними делать. Статус SENT фиксирует факт отправки и предотвращает повторную отправку тех же идей.

4. **Promise.race с timeout**  
   Парсинг + AI + векторный поиск может занять >10 минут. Timeout 30 минут предотвращает зависание бота при проблемах с API.

5. **handleRunPipelineCallback как обертка**  
   Inline кнопка не может напрямую вызвать команду. Callback нужен для `answerCallbackQuery` (иначе Telegram показывает часы загрузки) и для переиспользования логики команды.

## Преимущества

- ✅ Запуск пайплайна одной командой вместо трёх npm-скриптов
- ✅ Реал-тайм прогресс в Telegram (парсинг 2/5, генерация 15/23)
- ✅ История прогонов в БД для аналитики и cutoff date
- ✅ Защита от параллельных запусков (флаг isPipelineRunning)
- ✅ Переиспользование всей существующей логики без дублирования
- ✅ Статусы идей (NEW → SENT) предотвращают повторную отправку
- ✅ Timeout защита 30 минут для долгих операций
- ✅ Inline кнопки для запуска пайплайна из сообщения "нет идей"