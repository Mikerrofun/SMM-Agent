Заметка — по проекту **SMM-Agent** (в шаблоне было «CorporateVPN» — поправил, остальное структура та же).

---

**Дата:** 04.10.2026
**Теги:** #features #ideas #inline-кнопки #рассылка #shared #state

---

## 1. Зачем

Было три проблемы, связанные одной корневой — рассылка была «размазана» по коду.

1. **Дубли чтения `SUBSCRIBER_CHAT_IDS`.** Список подписчиков читался в четырёх местах: `ideas.ts` (свой парсер env), `lastRun.ts`, `scheduler.ts` (через общий хелпер, но с ручным `slice(1)`), плюс общий `broadcastToSubscribers`. Любая правка «кому и что слать» требовала обхода четырёх файлов.
2. **Инициатор не всегда получал результат.** `/run_pipeline` слал отчёт только себе через `ctx`; остальные подписчики узнавали об успехе только из крона. `/ideas` работал наоборот — инициатор, не подписанный на `SUBSCRIBER_CHAT_IDS`, вообще не видел идей (кроме пустого `SUBSCRIBER_CHAT_IDS`).
3. **`/ideas` отдавал один и тот же пул всем.** Пользователь не мог выбрать, что получить: новые, старые или «свежие» — кнопок выбора не было. Плюс рассылка 10 идей × N подписчиков шла без пауз и упиралась в rate limit.

Побочно: `ideas.ts` импортировал `bot` из `bot/index.ts`, а тот — `commands/index.ts` → `ideas.ts`. Циклический импорт.

## 2. Где/что уже было

Задача была не писать новое, а свести существующее к одному месту.

Готовый образец «папочной» структуры — модуль `transcriptPost` (`command.ts`, `config.ts`, `moreButton.ts`, `index.ts`): состояние ожидания в `Map` + конфиг с константами + разбор callback_data в одном файле.

Единая точка формата callback_data уже была готова как паттерн — `cancelButton.ts`:

```ts
// src/shared/utils/CommandManager/cancelButton.ts
export const CANCEL_CALLBACK_PREFIX = 'cancel:';
export function parseCancelCallbackData(data: string | undefined): string | null {
  if (!data || !data.startsWith(CANCEL_CALLBACK_PREFIX)) return null;
  const commandId = data.slice(CANCEL_CALLBACK_PREFIX.length);
  return commandId.length > 0 ? commandId : null;
}
```

Уже были: `getSubscriberChatIds()`, `broadcastToSubscribers()`, `countIdeasByStatus()`, `markIdeasAsSent()`, `CommandManager` (для долгих команд с отменой), `sleep()` для троттлинга. Всё это переиспользовано; **нового кода рассылки с нуля не писалось** — новым был только `resolveRecipientChatIds`.

`CommandManager` для `/ideas` **не использовался осознанно** (см. §6).

## 3. Реализация

### 3.1 Единое место получения получателей — `shared`

`broadcastToSubscribers` удалён, вместо него два хелпера. Ключевая идея — инвариант списка получателей:

```ts
// src/shared/telegram/subscribers.ts
export function resolveRecipientChatIds(
  options: ResolveRecipientOptions = {}
): string[] {
  const { initiatorChatId, excludeChatId } = options;

  const recipients = getSubscriberChatIds();          // единственное чтение env

  if (initiatorChatId && !recipients.includes(initiatorChatId)) {
    recipients.push(initiatorChatId);                 // инициатор не остался без результата
  }

  if (excludeChatId) {
    return recipients.filter((id) => id !== excludeChatId);  // результат уже ушёл через ctx
  }

  return recipients;
}

export async function sendMessageToChats(
  api: Api,
  chatIds: string[],
  text: string,
  options?: SendMessageOptions
): Promise<BroadcastResult> {
  let sent = 0, failed = 0;
  for (const chatId of chatIds) {
    try {
      await api.sendMessage(chatId, text, options);
      sent++;
    } catch (error) {
      failed++;                                        // ошибка одного чата не рвёт рассылку
      console.error(`[broadcast] ❌ Ошибка отправки в ${chatId}:`, error);
    }
  }
  return { sent, failed };
}
```

Формула: **подписчики + инициатор (если его нет) − чат, получивший результат через `ctx`**. Пустой `SUBSCRIBER_CHAT_IDS` — не ошибка, вернётся `[initiatorChatId]`.

Типы — отдельно, без логики: `BroadcastResult`, `ResolveRecipientOptions`, `SendMessageOptions` в `src/shared/telegram/subscribers.types.ts`.

### 3.2 Выборка идей по режиму — репозиторий

Три функции вместо одной. Репозиторий **не знает про UI** — режим маппится в боевом слое (`IDEAS_FETCHERS` в `command.ts`), репозиторий остался не знающим про кнопки, как и до этого.

```ts
// src/repositories/ideaRepository.ts
export async function getNewIdeasForSending(limit: number): Promise<IdeaModel[]> {
  return prisma.idea.findMany({
    where: { status: 'NEW' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
}

export async function getOldestIdeasForSending(limit: number): Promise<IdeaModel[]> {
  return prisma.idea.findMany({
    where: { status: 'NEW' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });
}

export async function getFreshIdeasForSending(limit: number): Promise<IdeaModel[]> {
  const total = await countIdeasByStatus('NEW');        // 1 запрос — размер пула

  if (total <= limit) {                                // пул меньше порции — отдаём целиком
    return prisma.idea.findMany({ where: { status: 'NEW' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  }

  const skip = Math.floor((total - limit) / 2);        // окно из середины
  return prisma.idea.findMany({
    where: { status: 'NEW' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip, take: limit,
  });
}
```

Важно: тай-брейкер по `id` добавлен не для красоты. Без него при одинаковых `createdAt` (идеи массово падают в базу пайплайном) окно со `skip` «плавает» между запросами и повторный выбор отдаёт пересекающиеся идеи.

Дефолт `limit = 10` убран — значение приходит из конфига модуля.

### 3.3 `/ideas` в два шага + состояние

Модуль `src/bot/commands/ideas/` вместо одного файла.

**Где хранится состояние** — в памяти процесса, `Map` в модуле. Без БД, без TTL-таймера. Два независимых набора:

```ts
// src/bot/commands/ideas/state.ts
const selectionStates = new Map<number, IdeasSelectionState>();  // ждёт нажатия
const sendingUserIds = new Set<number>();                        // рассылка идёт

export function saveSelection(userId: number): void {
  selectionStates.set(userId, { createdAt: new Date() });
}

// Синхронно читает И удаляет — до любого await
export function takeSelection(userId: number): IdeasSelectionState | null {
  const state = selectionStates.get(userId);
  if (!state) return null;
  selectionStates.delete(userId);

  if (isExpired(state, Date.now())) return null;   // ленивая TTL-проверка
  return state;
}

export function startSending(userId: number): boolean {
  if (sendingUserIds.has(userId)) return false;      // атомарная проверка
  sendingUserIds.add(userId);
  return true;
}
```

Ключ — `userId` (`ctx.from.id`), состояние одноразовое. TTL 10 минут (`SELECTION_TTL_MS`), проверяется при чтении и записи — отдельный `setInterval` не нужен, зависшие записи просто не выдаются.

**Формат callback_data — в одном файле**, и отправка, и приём:

```ts
// src/bot/commands/ideas/selectionKeyboard.ts
export function buildIdeasSelectionKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const button of SELECTION_BUTTONS) {
    keyboard.text(button.text, `${IDEAS_SELECTION_CALLBACK_PREFIX}${button.mode}`).row();
  }
  return keyboard;
}

export function parseIdeasSelectionCallbackData(
  data: string | undefined
): IdeasSelectionMode | null {
  if (!data || !data.startsWith(IDEAS_SELECTION_CALLBACK_PREFIX)) return null;
  const mode = data.slice(IDEAS_SELECTION_CALLBACK_PREFIX.length);
  const isKnownMode = SELECTION_BUTTONS.some((button) => button.mode === mode);
  return isKnownMode ? (mode as IdeasSelectionMode) : null;
}
```

Режимы и тексты — в `config.ts`: `new` → «🆕 Самые новые», `fresh` → «🕐 Свежие», `old` → «📜 Старые». Prefix `ideas_select:`, размер порции 10, пауза 500 мс.

**Обработчик нажатия** — порядок шагов важен:

```ts
// src/bot/commands/ideas/command.ts
export async function handleIdeasSelectionCallback(ctx: Context): Promise<void> {
  const mode = parseIdeasSelectionCallbackData(ctx.callbackQuery?.data);
  if (!mode) { await ctx.answerCallbackQuery({ text: INVALID_CALLBACK_TEXT }); return; }

  await ctx.answerCallbackQuery({ text: SENDING_TOAST_TEXT });      // гасим «часики»

  try { await ctx.editMessageReplyMarkup({ reply_markup: undefined }); }  // снимаем клавиатуру
  catch (error) { console.error('[Ideas] Failed to remove selection keyboard:', error); }

  const selection = takeSelection(userId);          // ← атомарно, ДО await
  if (!selection) {
    await ctx.answerCallbackQuery({ text: SELECTION_EXPIRED_TEXT });   // TTL истёк / двойной клик
    return;
  }
  if (!startSending(userId)) { await ctx.reply(SEND_IN_PROGRESS_TEXT); return; }

  try {
    const ideas = await IDEAS_FETCHERS[mode](IDEAS_BATCH_SIZE);
    if (ideas.length === 0) {
      await ctx.reply(NO_IDEAS_TEXT, { reply_markup: buildRunPipelineKeyboard() });
      return;
    }
    const result = await sendIdeasBatch(ctx.api, ideas, chatId.toString());
    console.log('[Ideas] Порция отправлена', { mode, ...result });
  } finally {
    clearSelection(userId);                          // страховка
    finishSending(userId);
  }
}
```

Именно синхронный `takeSelection` закрывает гонку: `waitingForFeedback` в `regeneratePost.ts` состояние **не удаляет** до `await`, поэтому 10 быстрых сообщений запускают 10 параллельных регенераций. Здесь забор идёт первым.

### 3.4 Рассылка порции — `sender.ts`

```ts
// src/bot/commands/ideas/sender.ts
export async function sendIdeasBatch(
  api: Api, ideas: IdeaModel[], initiatorChatId: string
): Promise<IdeasBatchResult> {
  const recipients = resolveRecipientChatIds({ initiatorChatId });

  for (const chatId of recipients) {
    let firstInChat = true;
    for (const idea of ideas) {
      if (!firstInChat) await sleep(DELAY_BETWEEN_IDEAS_MS);  // троттлинг
      firstInChat = false;
      try {
        await api.sendMessage(chatId, formatIdeaCard(idea), {
          parse_mode: 'HTML',
          reply_markup: buildGeneratePostKeyboard(idea.id),  // generate_post:<id>
        });
        if (!sentIdeaIds.includes(idea.id)) sentIdeaIds.push(idea.id);
      } catch (error) { failedIdeas++; console.error(...); }
    }
    await sleep(DELAY_BETWEEN_IDEAS_MS);
    const { sent } = await sendMessageToChats(api, [chatId], formatBatchSummary(ideas.length));
    summarySent += sent;
  }

  if (sentIdeaIds.length > 0) await markIdeasAsSent(sentIdeaIds);   // → статус SENT
  ...
}
```

`markIdeasAsSent` — **после** рассылки, по фактически отправленным ID. Повторный выбор той же категории даёт пустую порцию (текущая модель статусов, `NEW` → `SENT`).

### 3.5 Рассылка отчёта переехала в `runPipeline`

Раньше: крон слал финальный отчёт сам (`scheduler.ts`, цикл по `SUBSCRIBER_CHAT_IDS.slice(1)`), а ручной `/run_pipeline` — только инициатору. Два разных пути доставки → двойное сообщение при любой попытке добавить рассылку в хендлер.

Стало: финальный текст формируется внутри `execute` (там, где он идёт в чат), но сохраняется наружу и рассылается после:

```ts
// src/bot/commands/runPipeline.ts
let finalText: string | null = null;
let finalOptions: { parse_mode?: "HTML" } | undefined;

const execution = await commandManager.execute(ctx, "run_pipeline", {...}, async (_ctx, { statusMessage }) => {
  const finalMessage = formatPipelineReport(result, duration);
  finalText = finalMessage;                        // ← вынесли наружу
  finalOptions = { parse_mode: "HTML" };
  await editOrSend(ctx, statusMessage, finalMessage, { parse_mode: "HTML" });
  ...
});

let result: PipelineCommandResult;
switch (execution?.status) {
  case "completed":    result = execution.value; break;
  case "cancelled":    finalText = "🚫 Прогон пайплайна отменён."; result = {...}; break;
  case "already_running": result = {...}; break;          // рассылки нет — она у идущего прогона
  default:             result = {...}; break;
}

if (finalText) {
  const initiatorChatId = ctx.chat?.id?.toString();
  const targets = resolveRecipientChatIds({ initiatorChatId, excludeChatId: initiatorChatId });
  if (targets.length > 0) {
    const { sent, failed } = await sendMessageToChats(ctx.api, targets, finalText, finalOptions);
    console.log(`[run_pipeline] Отчёт отправлен подписчикам: ${sent} успешно, ${failed} с ошибкой`);
  }
}
return result;
```

В кроне `ctx` — это админ (`createCronContext(ADMIN_CHAT_ID)`), поэтому админ исключается, остальные получают отчёт из того же места. Из `scheduler.ts` удалены: цикл финального отчёта, оба цикла «Автоматический прогон пайплайна был отменён», импорт `formatPipelineReport`. Остались старт-уведомление и блок критической ошибки (этот бросок летит **вне** `execute`, сам `execute` её не видит — поэтому там рассылка всем, включая админа).

`lastRun.ts` — тот же хелпер, ручной `filter(id => id !== requesterChatId)` удалён.

## 4. UI

Клавиатура выбора — одна кнопка на строку, прикреплена к сообщению бота:

```ts
// src/bot/commands/ideas/config.ts
export const SELECTION_BUTTONS = [
  { mode: 'new',   text: '🆕 Самые новые' },
  { mode: 'fresh', text: '🕐 Свежие' },
  { mode: 'old',   text: '📜 Старые' },
];
```

Регистрация в `bot/index.ts` — префикс берётся из модуля, а не захардкожен:

```ts
bot.callbackQuery(
  new RegExp(`^${IDEAS_SELECTION_CALLBACK_PREFIX}`),
  handleIdeasSelectionCallback
);
bot.callbackQuery(/^generate_post:/, handleGeneratePostCallback);
```

Пустая порция — сообщение + кнопка «🚀 Запустить генерацию» (callback `run_pipeline`, зарегистрирован раньше). Порядок middleware не менялся: это `callbackQuery`, конфликта с `message:text` (фидбек) и `message:document` (PDF) нет.

## 5. Поток данных

```
/ideas ↓ handleIdeasCommand → saveSelection(userId) → сообщение + buildIdeasSelectionKeyboard()
        ↓ клик «🕐 Свежие» → callback_data "ideas_select:fresh"
bot.callbackQuery(/^ideas_select:/) ↓ handleIdeasSelectionCallback
        ↓ parseIdeasSelectionCallbackData → "fresh"
        ↓ answerCallbackQuery (тост) + editMessageReplyMarkup (клавиатура снята)
        ↓ takeSelection(userId) ← синхронно: get + delete, TTL-проверка
        ↓ startSending(userId) ← атомарно
        ↓ IDEAS_FETCHERS["fresh"](10) = getFreshIdeasForSending(10)
        ↓ countIdeasByStatus('NEW') → skip = (N-limit)/2 → prisma.idea.findMany
        ↓ идеи.length === 0 ? ctx.reply(NO_IDEAS, «Запустить генерацию»)
        ↓ sendIdeasBatch(ctx.api, ideas, chatId)
             ↓ resolveRecipientChatIds({initiatorChatId}) = подписчики + инициатор
             ↓ цикл: чат × идея → formatIdeaCard → sendMessage(HTML, generate_post:<id>) → sleep(500ms)
             ↓ итог: «✅ Отправлено N идей» в каждый чат
             ↓ markIdeasAsSent(ids) → статус SENT
        ↓ finally → clearSelection + finishSending
```

Отчёт пайплайна:

```
/run_pipeline или крон ↓ commandManager.execute → status-сообщение
        ↓ пайплайн → finalText = formatPipelineReport(result, duration)
        ↓ editOrSend(ctx, statusMessage, finalText)  ← инициатор
        ↓ execute вернул {status} → switch → finalText (в т.ч. «🚫 отменён»)
        ↓ resolveRecipientChatIds({initiatorChatId, excludeChatId: initiatorChatId})
        ↓ sendMessageToChats(ctx.api, targets, finalText)  ← все, кроме инициатора
```

## 6. Почему так, а не иначе

1. **`resolveRecipientChatIds` вместо «фильтр в каждом файле».** Формула «подписчики + инициатор − уже получивший» повторялась в трёх местах и в каждом была написана чуть иначе. Один хелпер = один инвариант, который нельзя случайно сломать в кроне.
2. **Рассылка отчёта в `runPipeline`, а не в кроне.** Крон — это просто другой вызов того же хендлера. Если доставку отчёта делает хендлер, у ручного запуска и крона идентичное поведение, а дублей быть не может физически (крон-циклы удалены, а не «отключены флагом»).
3. **Свой флаг `sendingUserIds`, а не `CommandManager`.** `CommandManager.execute()` шлёт статус-сообщение с кнопкой «Отменить» и поднимает `AbortController` — для флоу на 5 секунд без реальной отмены это лишний UX-шум. Плюс флоу настолько быстрый, что гонки в `finally` не бывает: состояние забирается синхронно до `await`.
4. **TTL ленивый, без `setInterval`.** Протухшая запись не выдаётся при чтении — отдельный таймер только добавил бы ручки к процессу (как `unref` в `CommandManager`).
5. **Снятие клавиатуры до обработки.** Повторное нажатие становится физически невозможно, а не просто игнорируется.
6. **Циклический импорт убран.** `ideas` больше не импортирует `bot` из `bot/index.ts` — рассылка идёт через `ctx.api`, тот же экземпляр API.

## 7. Граничные случаи

- Пул `NEW` ≤ 10 → все три режима отдают весь пул (кнопка «Запустить генерацию» не появляется).
- Выбранная категория пустая, другие непустые → «📭 Нет новых идей» + кнопка запуска генерации, состояние очищено.
- Инициатор не в `SUBSCRIBER_CHAT_IDS` → всё равно получает порцию (`resolveRecipientChatIds` добавляет его).
- `SUBSCRIBER_CHAT_IDS` пустой → порция уходит только инициатору; крон по-прежнему пишет предупреждение и не запускается.
- Двойной клик / протухший TTL → тост «⏳ Дождись окончания предыдущего запроса», к БД не идём.
- Ошибка отправки одному чату → рассылка продолжается, в лог падает чат и текст ошибки.
- `/run_pipeline`, когда пайплайн уже идёт → `already_running`, рассылки нет (отчёт придёт от идущего).

## 8. Известные риски

- **Инициатор «съедает» порцию.** Идеи уходят всем подписчикам и сразу становятся `SENT` — второй участник получит другую порцию (или пустую). Это текущая модель статусов, сохранили осознанно; после реализации стоит пересмотреть (например, `SENT` не выставлять, а вести счётчик показов).
- **Троттлинг 500 мс подобран на глаз.** 10 идей × 3 подписчика ≈ 15 с на рассылку. При большем числе подписчиков константу в `config.ts` надо поднимать.
- **Состояние в памяти процесса.** При рестарте/реплое пользователь потеряет невыбранную клавиатуру — придётся вызвать `/ideas` заново.
- **Доступ не ограничен.** Аккаунт без allowlist может выбрать категорию и отобрать порцию у подписчиков; антифлуд и контроль доступа — вне этой задачи.

## Преимущества

- ✅ Одно место чтения `SUBSCRIBER_CHAT_IDS` и один инвариант списка получателей.
- ✅ Инициатор любого действия гарантированно получает результат.
- ✅ `/ideas` даёт выбор категории; выбор одноразовый — двойной клик физически невозможен.
- ✅ Rate limit закрыт паузой между отправками вместо надежды на лимиты Telegram.
- ✅ Ручной `/run_pipeline` и крон отправляют отчёт подписчикам одинаково, дублей нет.
- ✅ Циклический импорт `bot/index.ts → commands → ideas → bot/index.ts` разорван.

---

**Валидация:** `npm run type-check` — чисто; `npx eslint src/bot src/cron src/shared src/repositories` — единственная ошибка предсуществующая (`cancelCommand.ts:34`, `no-explicit-any`, проверено на чистом дереве через `git stash`); `npm test` — 21/21.