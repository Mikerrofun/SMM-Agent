# CommandManager: обёртка долгоживущих команд и отмена по кнопке

---

**Дата:** 27.09.2026
**Теги:** #features #command-manager #cancellation #telegram-bot #cron #timeout

---

## 1. Зачем

Долгие команды бота (`/run_pipeline` — до 30 минут, генерация постов — минуты) работали «вслепую»: пользователь видел только статичное статус-сообщение и никак не мог остановить прогон. Захотел отменить — жди, пока отработает, а параллельный запуск всё это время заблокирован флагом `isPipelineRunning`.

Отдельная боль — таймаут пайплайна: он был сделан через `Promise.race`, то есть по таймауту падал только `await`, а сам пайплайн **продолжал крутиться в фоне**, тратя OpenAI-токены и держа флаг занятости.

Плюс cron-запуск не имел никакого отношения к пользовательским сессиям: админ не мог отменить ночной автозапуск.

## 2. Что уже было

На ветке уже лежала заготовка `src/shared/utils/CommandMaganer/` (с опечаткой в имени папки и файлом ` CommandManager.ts` с ведущим пробелом): singleton-класс с `activeCommands: Map`, `AbortController` на команду и `AsyncLocalStorage`. Задача была не писать менеджер заново, а **довести существующий до рабочего состояния** и раскатить на команды:

- переименовать папку/файл, вынести типы, добавить типизированные ошибки;
- обернуть хендлеры в `execute()`;
- добавить callback отмены, точки `checkCancelled()` в сервисах, статус `CANCELLED` в БД и интеграцию с кроном.

## 3. Реализация

### 3.1 Ядро менеджера

```ts
// src/shared/utils/CommandManager/CommandManager.ts

class CommandManager {
  private activeCommands = new Map<string, CommandState>();
  private commandContext = new AsyncLocalStorage<string>();

  async execute<T>(ctx, commandName, options, handler): Promise<CommandExecuteResult<T> | null> {
    const commandId = this.makeId(userId, commandName); // `${userId}_${commandName}`

    // per-user блокировка, с singleton — глобальная по имени команды
    if (this.isRunning(userId, commandName) ||
        (options.singleton && this.isCommandNameRunning(commandName))) {
      await ctx.reply('⏳ Эта команда уже выполняется. Дождись завершения или отмени её.');
      return { status: 'already_running' };
    }

    const controller = new AbortController();
    this.activeCommands.set(commandId, { controller, userId, commandName, startedAt: new Date(), chatId });

    // стартовое статус-сообщение сразу с кнопкой «Отменить»
    statusMessage = await ctx.reply(options.statusText, { reply_markup: buildCancelKeyboard(commandId) });

    // хендлер выполняется внутри AsyncLocalStorage с commandId
    const result = await this.commandContext.run(commandId, () => handler(ctx, { statusMessage }));
    // ...
    } catch (error) {
      if (error instanceof CommandCancelledError) {
        // редактируем статус-сообщение в «❌ Команда отменена» (+ reason, если есть)
        return { status: 'cancelled' };
      }
      // обычная ошибка → «❌ Ошибка: ...»
      return null;
    } finally {
      this.activeCommands.delete(commandId); // cleanup всегда
    }
  }
```

Ключевая пара методов — отмена и проверка:

```ts
// src/shared/utils/CommandManager/CommandManager.ts

// из callback: abort БЕЗ удаления записи — checkCancelled должен увидеть abort
cancel(commandId: string): boolean {
  const state = this.activeCommands.get(commandId);
  if (state && !state.controller.signal.aborted) {
    state.controller.abort();
    return true;
  }
  return false;
}

// изнутри команды (таймаут): берёт commandId из AsyncLocalStorage
cancelCurrent(reason?: string): boolean { /* abort(reason) той же записи */ }

checkCancelled(): void {
  const commandId = this.commandContext.getStore();
  if (!commandId) return;                    // вне бота (npm-скрипты) — no-op

  const state = this.activeCommands.get(commandId);
  if (state?.controller.signal.aborted) {
    throw new CommandCancelledError(
      typeof state.controller.signal.reason === 'string' ? state.controller.signal.reason : undefined
    );
  }
}
```

Важный нюанс, из-за которого `cancel()` не удаляет запись сразу: `checkCancelled()` читает состояние из `activeCommands`, поэтому запись обязана дожить до `finally` в `execute` — иначе отмена после `abort()` была бы невидима.

### 3.2 Кнопка отмены — единая точка

```ts
// src/shared/utils/CommandManager/cancelButton.ts

export const CANCEL_CALLBACK_PREFIX = 'cancel:';

export function buildCommandId(userId: number, commandName: string): string {
  return `${userId}_${commandName}`;
}

export function buildCancelKeyboard(commandId: string): CancelKeyboard {
  return { inline_keyboard: [[
    { text: '❌ Отменить', callback_data: `${CANCEL_CALLBACK_PREFIX}${commandId}` },
  ]]};
}

export function parseCancelCallbackData(data: string | undefined): string | null { /* ... */ }
```

Создание клавиатуры и парсинг callback_data живут в одном файле — формат `cancel:<commandId>` не может разъехаться между отправкой и приёмом.

### 3.3 Обёртывание команд

Все долгоживущие хендлеры завёрнуты в `execute` — на примере самого сложного, `/run_pipeline`:

```ts
// src/bot/commands/runPipeline.ts

export async function handleRunPipelineCommand(ctx: Context): Promise<PipelineCommandResult> {
  const execution = await commandManager.execute(
    ctx,
    "run_pipeline",
    {
      statusText: "🚀 Запуск пайплайна генерации идей...",
      // глобальный запрет параллельного пайплайна (включая крон) —
      // заменяет прежний флаг isPipelineRunning
      singleton: true,
    },
    async (_ctx, { statusMessage }) => {
      const pipelinePromise = runFullPipeline(async (_stage, status) => {
        // после отмены отложенный edit не должен перезаписать «Команда отменена»
        if (commandManager.isCurrentCancelled()) return;
        // ...троттлинг editMessageText раз в 3 сек (анти-429, было раньше)
        await editStatusMessageWithRetry(ctx, statusMessage, `🚀 Пайплайн генерации идей\n\n${status}`);
      });

      // таймаут не бросает исключение, а отменяет текущую команду (см. п. 6)
      const timeoutHandle = setTimeout(() => {
        commandManager.cancelCurrent("Превышено время выполнения (30 минут)");
      }, PIPELINE_TIMEOUT_MS);

      try {
        const result = await pipelinePromise;
        await editOrSend(ctx, statusMessage, formatPipelineReport(result, duration), { parse_mode: "HTML" });
        return { success: true, data: result };
      } catch (error) {
        // отмену (кнопка или таймаут) обрабатывает execute — прокидываем дальше
        if (error instanceof CommandCancelledError) throw error;
        // ...обычная ошибка → editOrSend с текстом ошибки
        return { success: false, error: errorMessage };
      } finally {
        clearTimeout(timeoutHandle);
      }
    }
  );

  switch (execution?.status) {
    case "completed":       return execution.value;
    case "cancelled":       return { success: false, cancelled: true, error: "Pipeline cancelled" };
    case "already_running": return { success: false, error: "Pipeline already running" };
    default:                return { success: false, error: "Command context is missing user/chat ids" };
  }
}
```

Так же завёрнуты: `natalia_channel_post` (вместо удалённого `runningForUser`), PDF-обработчик transcript, `generate_post`, `regenerate_post`. Быстрые хендлеры и флаги `waitingForPdf`/`waitingForFeedback` не тронуты — им отмена не нужна.

### 3.4 Callback отмены

```ts
// src/bot/commands/cancelCommand.ts

export async function handleCancelCallback(ctx: Context): Promise<void> {
  const commandId = parseCancelCallbackData(ctx.callbackQuery?.data);
  if (!commandId) { await ctx.answerCallbackQuery({ text: '❌ Неверные данные' }); return; }

  // валидация прав: commandId = `${userId}_${commandName}` —
  // отменить может только владелец (защита от подделки callback_data)
  const userId = ctx.from?.id;
  if (userId === undefined || !commandId.startsWith(`${userId}_`)) {
    await ctx.answerCallbackQuery({ text: '❌ Нельзя отменить чужую команду' });
    return;
  }

  const cancelled = commandManager.cancel(commandId);
  await ctx.answerCallbackQuery({ text: cancelled ? 'Отменяю…' : 'Команда уже завершена' });
}
```

Регистрация: `bot.callbackQuery(/^cancel:/, handleCancelCallback)` в `src/bot/index.ts`.

### 3.5 Точки checkCancelled в сервисах

Сервисы не знают про грамматику и Telegram — они просто периодически вызывают `checkCancelled()`. Точки расставлены **строго до** долгих операций и записей в БД:

```ts
// src/services/pipeline/pipelineService.ts

parsingStats = await parseCompetitorsChannels(client, (channelName, current, total) => {
  checkCancelled(); // отмена проверяется по каналу (точка невозврата — запись в БД, не здесь)
  void onProgress('parsing', `...Прогресс: ${current}/${total}`);
});

// ...перед processIdeaBatch, перед deduplicateIdeas, перед updateGenerationRunSuccess — checkCancelled()

} catch (error) {
  if (error instanceof CommandCancelledError) {
    // частичная статистика сохраняется той, что уже посчитана — без затирания нулями
    if (generationRun) {
      await updateGenerationRunCancelled(generationRun.id, {
        ...(parsingStats && { processedPosts: parsingStats.savedPosts }),
        ...(ideasStats && { generatedIdeas: ideasStats.succeeded }),
        ...(deduplicationStats && { acceptedIdeas: deduplicationStats.unique }),
      });
    }
    throw error; // прокидываем как есть — execute различает отмену по классу
  }
  // ...обычная ошибка → updateGenerationRunFailed
}
```

Аналогично в `ideaProcessor` (перед LLM-вызовом и строго перед записью идеи в БД), `deduplicationService` (перед векторным поиском каждой идеи), `postGenerationPipeline` (перед генерацией, перед `repository.create`, перед точкой невозврата `updateStatus(SENT)`), `transcriptProcessingService` и `nataliaChannelPostService` (перед генерацией каждого следующего поста).

Два правила, соблюдённые везде:

- **проверки вне `withRetry`** — отмена не должна ретраиться как обычная ошибка;
- **отмена не считается ошибкой элемента** — `catch` в батч-обработках прокидывает `CommandCancelledError` вверх, а не инкрементирует `stats.failed`.

### 3.6 Статус CANCELLED в БД

```ts
// prisma/schema.prisma
enum RunStatus { RUNNING  SUCCESS  FAILED  CANCELLED }

// src/repositories/generationRunRepository.ts
export async function updateGenerationRunCancelled(runId, partialStats?) {
  await prisma.generationRun.update({
    where: { id: runId },
    data: {
      finishedAt: new Date(),
      status: RunStatus.CANCELLED,
      // отсутствующие значения НЕ затираются нулями
      ...(partialStats?.processedPosts !== undefined && { processedPosts: partialStats.processedPosts }),
      // ...
    },
  });
}
```

Миграция `20260927000000_add_cancelled_run_status` создана, но **не применялась** — накатить вручную. `/last_run` показывает отменённый прогон отдельной пометкой («🚫 Последний прогон был отменён»).

## 4. UI

UI — это сама инлайн-кнопка: `execute` отправляет стартовое статус-сообщение с `buildCancelKeyboard(commandId)`, после завершения/отмены редактирует его же (`successText` / «❌ Команда отменена»). Отдельных компонентов нет.

## 5. Поток данных

### Обычный запуск и отмена по кнопке

```
Пользователь: /run_pipeline
  ↓
handleRunPipelineCommand → commandManager.execute(ctx, "run_pipeline", { singleton: true }, handler)
  ↓
already running? → «⏳ Эта команда уже выполняется…» (стоп)
  ↓
AbortController → activeCommands.set("123456_run_pipeline", state)
  ↓
ctx.reply(statusText, cancelKeyboard) → статус-сообщение с кнопкой
  ↓
AsyncLocalStorage.run(commandId) → handler → runFullPipeline
  ↓ (на каждой точке)
checkCancelled() → AsyncLocalStorage пуст/не aborted → no-op → сервис продолжает
  ↓
[Пользователь жмёт «❌ Отменить»]
  ↓
callback "cancel:123456_run_pipeline" → handleCancelCallback
  ↓
commandId.startsWith(`${ctx.from.id}_`)? → нет: «Нельзя отменить чужую команду» (стоп)
  ↓
commandManager.cancel(commandId) → controller.abort()
  ↓
следующий checkCancelled() в сервисе → throw CommandCancelledError
  ↓
прокидывается через батч-обработки (не ретраится, не считается stats.failed)
  ↓
pipelineService catch → updateGenerationRunCancelled(частичная статистика)
  ↓
execute catch → editMessageText «❌ Команда отменена» → { status: 'cancelled' }
  ↓
finally → activeCommands.delete → блокировка снята
```

### Крон

```
node-cron (вт/чт 9:50 MSK) → runScheduledPipeline()
  ↓
createCronContext(ADMIN_CHAT_ID)   ← фейковый ctx с from/chat = ID админа
  ↓
handleRunPipelineCommand(ctx)      ← тот же execute: singleton + кнопка отмены
  ↓
админ получает статус-сообщение с кнопкой → может отменить ночной прогон как свой
  ↓
рассылка «начинаю обработку» — остальным подписчикам (slice(1)), админу дубликат не нужен
  ↓
pipelineResult.cancelled? → подписчикам «🚫 Автоматический прогон пайплайна был отменён.»
  ↓ (иначе)
успех → финальный отчёт остальным подписчикам
```

## 6. Таймаут — что смутило и как переделано

Старая реализация выглядела так:

```ts
// БЫЛО: Promise.race — гонка, а не остановка
const result = await Promise.race([
  pipelinePromise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30 * 60 * 1000)),
]);
```

Проблемы:

1. **Пайплайн не останавливался.** `Promise.race` завершает только `await` — сам `pipelinePromise` продолжал выполняться в фоне: LLM-вызовы, записи в БД, токены. При этом `isPipelineRunning` оставался поднятым до реального завершения — следующий запуск блокировался «призраком».
2. **Таймаут выглядел как ошибка.** Прогон падал в `updateGenerationRunFailed`, хотя это штатная ситуация «слишком долго».
3. **Никакой связи с отменой.** Механизм таймаута и механизм (отсутствующей) отмены были двумя разными мирами.

Новое решение — таймаут **переиспользует отмену**:

```ts
// src/bot/commands/runPipeline.ts
const timeoutHandle = setTimeout(() => {
  commandManager.cancelCurrent("Превышено время выполнения (30 минут)");
}, PIPELINE_TIMEOUT_MS);
```

`cancelCurrent` берёт commandId из `AsyncLocalStorage` (мы внутри хендлера — контекст есть) и делает тот же `abort(reason)`. Дальше всё идёт по уже существующему пути отмены: `checkCancelled` в сервисах → `CommandCancelledError` → `updateGenerationRunCancelled` → execute редактирует статус в «❌ Команда отменена: Превышено время выполнения (30 минут)». Отдельный код обработки таймаута не пишется вообще — таймаут стал частным случаем отмены. `clearTimeout` в `finally` снимает таймер при нормальном завершении.

## 7. Тесты

`tests/commandManager.test.ts` (node:test, добавлен в `npm test`) — три сценария на механику менеджера, без глубокого мока Telegram API (фейковый ctx в духе `createCronContext`: только `from/chat/reply/api`):

1. **Регистрация и cleanup** — `execute` регистрирует команду, после завершения `isCommandRunning('1_generate_post') === false`.
2. **Отмена** — хендлер висит на промисе-шлюзе, тест вызывает `cancel()`, отпускает хендлер; `checkCancelled()` внутри бросает `CommandCancelledError`, `execute` возвращает `{ status: 'cancelled' }`, запись снята с учёта.
3. **Блокировки** — повторный `execute` того же пользователя → `already_running`; другой пользователь без `singleton` → выполняется; с `singleton` → `already_running`.

## 8. Ограничения

- Отмена кооперативная: реальная остановка происходит в ближайшей точке `checkCancelled()`. Долгий LLM-вызов (десятки секунд) не прерывается посреди — отмену он «заметит» на следующей проверке.
- `commandId` кодируется в `callback_data` как есть; лимит Telegram в 64 байта для callback_data не нарушается (`userId_commandName` — десятки байт), но при добавлении новых длинных имён команд стоит помнить про лимит.
- Миграция `CANCELLED` создана, но не применена — до накатки `updateGenerationRunCancelled` упадёт на проде.
- `cleanupStaleCommands` (раз в 30 мин, записи старше часа) чистит только учёт — сами «зависшие» хендлеры он остановить не может.

## Преимущества

- ✅ Любую долгую команду можно отменить одной кнопкой — без ожидания и рестартов.
- ✅ Таймаут перестал быть фиктивным: пайплайн реально останавливается, а не продолжает жечь токены в фоне.
- ✅ Отменённый прогон фиксируется в БД (`CANCELLED`) с частичной статистикой — `/last_run` показывает честную картину.
- ✅ Крон-прогон управляем: админ отменяет его той же кнопкой, подписчики получают нейтральное уведомление вместо «критической ошибки».
- ✅ Сервисы не зависят от Telegram: `checkCancelled()` вне бота — no-op, отмена не ретраится и не портит статистику.
- ✅ Per-user и singleton-блокировки заменили разрозненные флаги (`isPipelineRunning`, `runningForUser`) одним механизмом.
