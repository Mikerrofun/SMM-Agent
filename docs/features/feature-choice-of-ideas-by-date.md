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

Уже были: `getSubscriberChatIds()`, `countIdeasByStatus()`, `markIdeasAsSent()`, `CommandManager` (для долгих команд с отменой), `sleep()` для троттлинга. Всё это переиспользовано; **нового кода рассылки с нуля не писалось** — новыми были только два хелпера в `shared`.

`CommandManager` для `/ideas` **не использовался осознанно** (см. §6).

## 3. Реализация

### 3.1 Единое место получения получателей — `shared`

`broadcastToSubscribers` удалён. Вместо него два хелпера с чётким разделением ответственности: один строит список чатов, второй сам отправляет.

```ts
// src/shared/telegram/subscribers.ts
export function getSubscriberChatIds(): string[] {
  return (
    process.env.SUBSCRIBER_CHAT_IDS?.split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0) ?? []
  );
}

export function getRecipientChatIds(initiatorChatId?: string): string[] {
  const recipients = getSubscriberChatIds();      // единственное чтение env

  if (initiatorChatId && !recipients.includes(initiatorChatId)) {
    recipients.push(initiatorChatId);             // инициатор тоже получает результат
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
      failed++;                                    // ошибка одного чата не рвёт рассылку
      console.error(`[broadcast] ❌ Ошибка отправки в ${chatId}:`, error);
    }
  }
  return { sent, failed };
}
```

Формула списка получателей: **подписчики + инициатор (если его нет среди подписчиков)**.

Ключевое отличие от первой версии рефакторинга: здесь **нет опции «исключить чат, которому уже ушло»**. Она исчезла вместе с `ctx`-доставкой результата — результат теперь всегда уходит одним циклом рассылки, и инициатору в том числе. Значит проверять «кому уже отправляли» не нужно: второй доставки не существует. Пустой `SUBSCRIBER_CHAT_IDS` — не ошибка, вернётся `[initiatorChatId]`.

Типы — отдельно, без логики: `BroadcastResult` и `SendMessageOptions` в `src/shared/telegram/subscribers.types.ts`.

Кто и что рассылает через эти хелперы:

| Место | Что уходит | Кому |
|---|---|---|
| `ideas/sender.ts` | карточки идей + «Отправлено N идей» | подписчики + инициатор |
| `runPipeline.ts` | финальный отчёт / текст ошибки / «отменён» | подписчики + инициатор |
| `lastRun.ts` | отчёт по последнему прогону | подписчики + инициатор |
| `cron/scheduler.ts` | «Автоматический запуск pipeline» | подписчики **без** админа |
| `cron/scheduler.ts` | «Критическая ошибка автоматического запуска» | все подписчики |

Исключение админа в кроне — локальный факт крона (`getSubscriberChatIds().filter(id => id !== ADMIN_CHAT_ID)`), а не опция общего хелпера: стартовое сообщение админу отправляет `CommandManager.execute`, и это знает только крон.

### 3.2 Выборка идей по режиму — репозиторий

Три функции вместо одной, по одной на режим кнопки. Репозиторий **не знает про UI** — режим раскладывается в боевом слое модуля (`IDEAS_FETCHERS` в `config.ts`), репозиторий остался не знающим про кнопки, как и до этого.

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
  const total = await countIdeasByStatus('NEW');        // один запрос — размер пула

  if (total <= limit) {                                 // пул меньше порции — отдаём целиком
    return prisma.idea.findMany({
      where: { status: 'NEW' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  const skip = Math.floor((total - limit) / 2);         // окно из середины
  return prisma.idea.findMany({
    where: { status: 'NEW' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip,
    take: limit,
  });
}
```

Три режима — три разных окна одного и того же пула `NEW`: `new` — самые свежие (`createdAt desc`), `old` — самые старые (`createdAt asc`), `fresh` — середина (`skip` из середины). «Свежие» существует именно ради повторных показов: если новые уже разобрали, а старые никто не хочет, сдвиг окна отдаёт другую часть пула.

Важно: тай-брейкер по `id` добавлен не для красоты. Без него при одинаковых `createdAt` (идеи массово падают в базу пайплайном) окно со `skip` «плавает» между запросами и повторный выбор отдаёт пересекающиеся идеи.

Дефолт `limit = 10` убран — значение приходит из конфига модуля.

### 3.3 `/ideas` в два шага + состояние

Модуль `src/bot/commands/ideas/` вместо одного файла. Файлы: `command.ts` (оба хендлера), `selectionKeyboard.ts` (формат callback_data), `state.ts` (состояние), `sender.ts` (рассылка порции), `config.ts` (константы и тексты), `utils.ts` (тексты карточки и склонения), `generatePostButton.ts` (перенесённый хендлер «Сгенерировать пост»), `ideas.types.ts`, `index.ts`.

#### Где хранится состояние

В памяти процесса, в модуле — без БД и без таймера. Два независимых набора с разным смыслом:

```ts
// src/bot/commands/ideas/state.ts
const selectionStates = new Map<number, IdeasSelectionState>();
const sendingUserIds = new Set<number>();

function isExpired(state: IdeasSelectionState, now: number): boolean {
  return now - state.createdAt.getTime() > SELECTION_TTL_MS;
}
```

- `selectionStates: Map<userId, { createdAt }>` — «пользователю показали клавиатуру, он ещё не нажал». Значение хранит **время создания**, а не `true`, как в `waitingForPdf` из `transcriptPost`: нужно знать, когда состояние протухло.
- `sendingUserIds: Set<userId>` — «рассылка идёт прямо сейчас». Отдельный набор от `selectionStates`, потому что у них разный жизненный цикл: состояние выбора живёт до нажатия, флаг отправки — только пока идёт рассылка.

Что делает каждая функция:

```ts
// src/bot/commands/ideas/state.ts
export function saveSelection(userId: number): void {
  selectionStates.set(userId, { createdAt: new Date() });
}

export function takeSelection(userId: number): IdeasSelectionState | null {
  const state = selectionStates.get(userId);

  if (!state) {
    return null;
  }

  selectionStates.delete(userId);

  if (isExpired(state, Date.now())) {
    return null;
  }

  return state;
}

export function clearSelection(userId: number): void {
  selectionStates.delete(userId);
}

export function isSending(userId: number): boolean {
  return sendingUserIds.has(userId);
}

export function startSending(userId: number): boolean {
  if (sendingUserIds.has(userId)) {
    return false;
  }

  sendingUserIds.add(userId);
  return true;
}

export function finishSending(userId: number): void {
  sendingUserIds.delete(userId);
}
```

| Функция | Зачем |
|---|---|
| `saveSelection` | вызывается в `handleIdeasCommand` после проверки `isSending` — пользователю показали кнопки, значит состояние можно создать (повторный `/ideas` просто перезапишет `createdAt` и обновит TTL) |
| `takeSelection` | **главная функция модуля.** Синхронно читает и удаляет запись. Возвращает `null`, если её нет (уже забрали) или TTL истёк. Одноразовость: состояние нельзя забрать дважды, поэтому второй клик физически не запустит вторую рассылку |
| `clearSelection` | страховка в `finally` — если флоу упал до `takeSelection`, запись не остаётся висеть до конца TTL |
| `isSending` | проверка в `handleIdeasCommand`: если у человека уже идёт рассылка, новый `/ideas` не показывает ещё одну клавиатуру, а отвечает «⏳ Предыдущая отправка ещё выполняется» |
| `startSending` | атомарная проверка «занято или нет»: возвращает `false`, если рассылка уже идёт. Синхронность критична — между проверкой и записью нет `await`, гонки не возникает |
| `finishSending` | снимает флаг в `finally`, чтобы пользователь мог выбрать категорию снова |

Почему `takeSelection` синхронный — главный момент. Он вызывается **до** любого `await` в хендлере. Контраст: `waitingForFeedback` в `regeneratePost.ts` состояние только читает, а удаляет в `finally` — поэтому 10 быстрых сообщений проходят проверку и запускают 10 параллельных регенераций. Здесь второй обработчик увидит уже пустой `Map` и выйдет с тостом.

Ключ — `userId` (`ctx.from.id`), состояние одноразовое. TTL 10 минут (`SELECTION_TTL_MS`), проверяется лениво при чтении — отдельный `setInterval` не нужен, зависшие записи просто не выдаются.

#### Формат callback_data — в одном файле

И отправка, и приём в `selectionKeyboard.ts`, чтобы формат не мог разъехаться. Режимы и тексты кнопок — в `config.ts`.

```ts
// src/bot/commands/ideas/selectionKeyboard.ts
export function buildIdeasSelectionKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const button of SELECTION_BUTTONS) {
    keyboard.text(button.text, `${IDEAS_SELECTION_CALLBACK_PREFIX}${button.mode}`).row();
  }

  return keyboard;
}

export function buildRunPipelineKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(RUN_PIPELINE_BUTTON_TEXT, RUN_PIPELINE_CALLBACK);
}

export function parseIdeasSelectionCallbackData(
  data: string | undefined
): IdeasSelectionMode | null {
  if (!data || !data.startsWith(IDEAS_SELECTION_CALLBACK_PREFIX)) {
    return null;
  }

  const mode = data.slice(IDEAS_SELECTION_CALLBACK_PREFIX.length);

  const isKnownMode = SELECTION_BUTTONS.some((button) => button.mode === mode);
  return isKnownMode ? (mode as IdeasSelectionMode) : null;
}
```

Парсер отдаёт не строку, а тип `IdeasSelectionMode | null`: неизвестный режим (`ideas_select:hack`) отсекается здесь же, до обращения к БД.

#### Обработчики

```ts
// src/bot/commands/ideas/command.ts
export async function handleIdeasCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    return;
  }

  if (isSending(userId)) {
    await ctx.reply(SEND_IN_PROGRESS_TEXT);
    return;
  }

  saveSelection(userId);

  await ctx.reply(SELECTION_PROMPT_TEXT, {
    reply_markup: buildIdeasSelectionKeyboard(),
  });
}

export async function handleIdeasSelectionCallback(ctx: Context): Promise<void> {
  const mode = parseIdeasSelectionCallbackData(ctx.callbackQuery?.data);

  if (!mode) {
    await ctx.answerCallbackQuery({ text: INVALID_CALLBACK_TEXT });
    return;
  }

  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) {
    await ctx.answerCallbackQuery({ text: INVALID_CALLBACK_TEXT });
    return;
  }

  await ctx.answerCallbackQuery({ text: SENDING_TOAST_TEXT });

  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch (error) {
    console.error('[Ideas] Failed to remove selection keyboard:', error);
  }

  const selection = takeSelection(userId);

  if (!selection) {
    await ctx.answerCallbackQuery({ text: SELECTION_EXPIRED_TEXT });
    return;
  }

  if (!startSending(userId)) {
    await ctx.reply(SEND_IN_PROGRESS_TEXT);
    return;
  }

  try {
    const ideas = await IDEAS_FETCHERS[mode](IDEAS_BATCH_SIZE);

    if (ideas.length === 0) {
      await ctx.reply(NO_IDEAS_TEXT, { reply_markup: buildRunPipelineKeyboard() });
      return;
    }

    const result = await sendIdeasBatch(ctx.api, ideas, chatId.toString());
    console.log('[Ideas] Порция отправлена', { mode, ...result });
  } catch (error) {
    // текст ошибки / подсказка про DATABASE_URL — в ctx.reply, это не результат
  } finally {
    clearSelection(userId);
    finishSending(userId);
  }
}
```

Порядок шагов в колбэке важен: тост → снятие клавиатуры → **забор состояния** → проверка «рассылка уже идёт» → БД → рассылка. Всё, что может отправить сообщение в чат пользователя (тосты, «нет идей», текст ошибки), идёт через `ctx` — это UI конкретного человека, а не результат. Результат — только через `sendIdeasBatch`.

`generatePostButton.ts` — перенесённый без изменений логики хендлер кнопки «✍️ Сгенерировать пост» из старого `ideas.ts`. Он идёт через `commandManager.execute`, то есть у генерации поста есть кнопка «Отменить»: `execute` ставит `AbortController`, шлёт статус-сообщение с `buildCancelKeyboard`, а `checkCancelled()` внутри `generatePostForIdea` бросает `CommandCancelledError` и генерация реально прерывается.

### 3.4 Рассылка порции — `sender.ts`

Единственное место, где порция идей уходит наружу. Всё, что «получили подписчики», собрано здесь.

```ts
// src/bot/commands/ideas/sender.ts
export async function sendIdeasBatch(
  api: Api,
  ideas: IdeaModel[],
  initiatorChatId: string
): Promise<IdeasBatchResult> {
  const recipients = getRecipientChatIds(initiatorChatId);

  console.log(
    `[Ideas] 📤 Отправка ${ideas.length} идей для ${recipients.length} получателей`
  );

  const sentIdeaIds: string[] = [];
  let failedIdeas = 0;
  let summarySent = 0;

  for (const chatId of recipients) {
    let firstInChat = true;

    for (const idea of ideas) {
      // Пауза между отправками, чтобы не упереться в rate limit Telegram
      if (!firstInChat) {
        await sleep(DELAY_BETWEEN_IDEAS_MS);
      }
      firstInChat = false;

      try {
        await api.sendMessage(chatId, formatIdeaCard(idea), {
          parse_mode: 'HTML',
          reply_markup: buildGeneratePostKeyboard(idea.id),
        });

        if (!sentIdeaIds.includes(idea.id)) {
          sentIdeaIds.push(idea.id);
        }
      } catch (error) {
        failedIdeas++;
        console.error(
          `[Ideas] ❌ Не удалось отправить идею ${idea.id} в ${chatId}:`,
          error
        );
      }
    }

    await sleep(DELAY_BETWEEN_IDEAS_MS);

    const { sent } = await sendMessageToChats(
      api,
      [chatId],
      formatBatchSummary(ideas.length)
    );
    summarySent += sent;
  }

  if (sentIdeaIds.length > 0) {
    try {
      const marked = await markIdeasAsSent(sentIdeaIds);
      console.log(`[Ideas] ✅ Marked ${marked} ideas as SENT`);
    } catch (error) {
      console.error('[Ideas] Failed to mark ideas as SENT:', error);
    }
  }

  return { sentIdeas: sentIdeaIds.length, failedIdeas, recipients: recipients.length, summarySent };
}
```

Пошагово:

1. **Список получателей** — `getRecipientChatIds(initiatorChatId)`: подписчики из env + чат того, кто нажал кнопку. Через `ctx` инициатор в этой точке получил только тост и снятую клавиатуру, сами идеи ещё никуда не уходили, поэтому его чат включается явно.
2. **Вложенный цикл «чат → идея»** — каждому получателю уходит полная порция. Снаружи — список чатов, внутри — идеи, чтобы каждый чат получил свою копию.
3. **Карточка идеи** — `formatIdeaCard` (HTML, `escapeHtml` по всем полям) + кнопка «✍️ Сгенерировать пост» с `callback_data` `generate_post:<id>`. Кнопка персональная: у каждого получателя своя идея в своём чате.
4. **Троттлинг** — `sleep(DELAY_BETWEEN_IDEAS_MS)` между отправками внутри чата и перед итоговой строкой. Без этого 10 идей × N подписчиков = десятки запросов подряд и 429 от Telegram.
5. **Итоговая строка** — «✅ Отправлено N идей!» со склонением (`pluralizeIdea`) уходит в каждый чат после его порции, чтобы человек видел, что всё пришло.
6. **`markIdeasAsSent`** — **после** рассылки и только по фактически отправленным ID (`sentIdeaIds`, собирается через `includes`, чтобы не дублировать при нескольких чатах). Ошибка отправки не мешает пометке, а ошибка `markIdeasAsSent` не откатывает уже отправленные идеи.
7. **Возврат счётчиков** — `sentIdeas`, `failedIdeas`, `recipients`, `summarySent` уходят в лог хендлера, чтобы по логу видеть, сколько чатов реально получило порцию.

Про `SENT`: повторный выбор той же категории даёт пустую порцию — это текущая модель статусов (`NEW` → `SENT`), менять её в этой задаче нельзя.

### 3.5 Доставка результата — одна функция, без `ctx`

Принцип, к которому привели все три команды: **результат не доставляется через `ctx` вообще**. `ctx` используется только для статусов и UI конкретного человека (тосты, статус-сообщение, «запустить генерацию»), а сам результат всегда уходит циклом по `getRecipientChatIds()` + `sendMessageToChats()`.

#### `/run_pipeline` — отчёт уходит всем

Раньше было два пути доставки: ручной запуск слал отчёт только инициатору через `editOrSend`, а крон слал его же отдельно всем остальным подписчикам. Стоило добавить рассылку в хендлер — и крон-прогоны начали бы слать отчёт дважды.

Стало: статус-сообщение стало **UI, а не носителем отчёта**. Хендлер `CommandManager` по-прежнему нужен (прогресс, кнопка отмены, таймаут), но в финале он закрывается коротким текстом, а полный отчёт уходит всем получателям.

```ts
// src/bot/commands/runPipeline.ts
const PIPELINE_DONE_STATUS_TEXT = "✅ Готово, полный отчёт ниже.";
const PIPELINE_ERROR_STATUS_TEXT = "❌ Пайплайн завершился с ошибкой, подробности ниже.";

let finalText: string | null = null;
let finalOptions: { parse_mode?: "HTML" } | undefined;

const execution = await commandManager.execute(ctx, "run_pipeline", { ... }, async (_ctx, { statusMessage }) => {
  try {
    const result = await pipelinePromise;
    const duration = Math.round((Date.now() - startTime) / 1000);

    logPipelineStats(result, duration);

    finalText = formatPipelineReport(result, duration);
    finalOptions = { parse_mode: "HTML" };

    await editOrSend(ctx, statusMessage, PIPELINE_DONE_STATUS_TEXT);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof CommandCancelledError) {
      throw error;
    }

    // finalText = текст ошибки; статус-сообщение закрываем коротким текстом
    await editOrSend(ctx, statusMessage, PIPELINE_ERROR_STATUS_TEXT);
    return { success: false, error: errorMessage };
  } finally {
    clearTimeout(timeoutHandle);
  }
});

let result: PipelineCommandResult;

switch (execution?.status) {
  case "completed":
    result = execution.value;
    break;
  case "cancelled":
    finalText = PIPELINE_CANCELLED_TEXT;      // "🚫 Прогон пайплайна отменён."
    finalOptions = undefined;
    result = { success: false, cancelled: true, error: "Pipeline cancelled" };
    break;
  case "already_running":
    result = { success: false, error: "Pipeline already running" };
    break;
  default:
    result = { success: false, error: "Command context is missing user/chat ids" };
    break;
}

if (finalText) {
  const targets = getRecipientChatIds(ctx.chat?.id?.toString());

  if (targets.length > 0) {
    const { sent, failed } = await sendMessageToChats(ctx.api, targets, finalText, finalOptions);
    console.log(`[run_pipeline] Отчёт отправлен: ${sent} успешно, ${failed} с ошибкой`);
  }
}

return result;
```

Ключевой приём — `finalText` объявлен **до** `execute` и заполняется внутри хендлера. Раньше финальный текст строился внутри и там же терялся: наружу отдавался только `PipelineCommandResult` без текста, поэтому рассылка после `execute` была невозможна.

По веткам `switch`:

- `completed` — `finalText` уже заполнен внутри хендлера;
- `cancelled` — текст собирается здесь: отмену внутри хендлера бросает `execute`, сама она правит статус-сообщение на «❌ Команда отменена», а подписчикам нужно отдельное сообщение;
- `already_running` — рассылки нет: ответ «⏳ Эта команда уже выполняется» это статус, а не результат; отчёт придёт от идущего прогона;
- `default` — `execute` не нашёл `userId`/`chatId`, отправлять нечего.

#### `cron/scheduler.ts` — этот паттерн убран

Удалено из крона:

- цикл финального отчёта по `SUBSCRIBER_CHAT_IDS.slice(1)` (и сам импорт `formatPipelineReport`) — отчёт уходит из `runPipeline`;
- оба цикла «Автоматический прогон пайплайна был отменён» — текст отмены уходит из `runPipeline` (текст поменялся: было «Автоматический прогон пайплайна был отменён», стало «Прогон пайплайна отменён»);
- ручные циклы рассылки заменены на `getRecipientChatIds` / `sendMessageToChats`.

Осталось в кроне:

- **старт-уведомление** — `getSubscriberChatIds().filter(id => id !== ADMIN_CHAT_ID)`: админ получает статус-сообщение с прогрессом и кнопкой отмены от `execute`, остальным нужно отдельное сообщение;
- **блок критической ошибки** — `getSubscriberChatIds()` всем, включая админа. Этот бросок летит **вне** `execute` (сам `execute` её не видит), поэтому `runPipeline` о нём не знает и переслать не может.

#### `/last_run`

`ctx.reply(report)` удалён полностью, отчёт уходит одним циклом — тем же кодом, что и у пайплайна:

```ts
// src/bot/commands/lastRun.ts
const report = formatLastRunReport(run);

const targets = getRecipientChatIds(ctx.chat?.id?.toString());

if (targets.length > 0) {
  const { sent, failed } = await sendMessageToChats(ctx.api, targets, report, { parse_mode: "HTML" });
  console.log(`[last_run] Отчёт отправлен: ${sent} успешно, ${failed} с ошибкой`);
}
```

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

Тексты и префикс — в конфиге модуля, поэтому регистрация в `bot/index.ts` собирает регулярное выражение из константы, а не хардкодит его в двух местах:

```ts
bot.callbackQuery(
  new RegExp(`^${IDEAS_SELECTION_CALLBACK_PREFIX}`),
  handleIdeasSelectionCallback
);
bot.callbackQuery(/^generate_post:/, handleGeneratePostCallback);
bot.callbackQuery("run_pipeline", handleRunPipelineCallback);
```

Пустая порция — сообщение «📭 Нет новых идей для постов.» + кнопка «🚀 Запустить генерацию» (callback `run_pipeline`, зарегистрирован отдельно). Порядок middleware не менялся: это `callbackQuery`, конфликта с `message:text` (фидбек) и `message:document` (PDF) нет.

Плашка статуса пайплайна после рефакторинга не содержит отчёта — только короткое «✅ Готово, полный отчёт ниже.» Отчёт приходит отдельным сообщением всем, включая инициатора.

## 5. Поток данных

Выбор категории идей:

```
/ideas ↓ handleIdeasCommand → isSending(userId)? → да: «⏳ Предыдущая отправка ещё выполняется», выход
        ↓ нет → saveSelection(userId) = { createdAt }
        ↓ сообщение + buildIdeasSelectionKeyboard() (ideas_select:new | :fresh | :old)
        ↓ клик «🕐 Свежие» → callback_data "ideas_select:fresh"
bot.callbackQuery(/^ideas_select:/) ↓ handleIdeasSelectionCallback
        ↓ parseIdeasSelectionCallbackData → 'fresh' | null (null → тост «❌ Неверные данные»)
        ↓ answerCallbackQuery «⏳ Отправляю идеи...» + editMessageReplyMarkup (клавиатура снята)
        ↓ takeSelection(userId) ← синхронно get + delete + TTL-проверка
        ↓   null → тост «⏳ Дождись окончания предыдущего запроса», к БД не идём
        ↓ startSending(userId) ← атомарно; false → «⏳ Предыдущая отправка ещё выполняется»
        ↓ IDEAS_FETCHERS['fresh'](IDEAS_BATCH_SIZE=10) = getFreshIdeasForSending(10)
        ↓   countIdeasByStatus('NEW') → total <= 10 ? весь пул : skip = (total-10)/2 + take 10
        ↓ идеи.length === 0 → ctx.reply(«📭 Нет новых идей», кнопка «🚀 Запустить генерацию»)
        ↓ sendIdeasBatch(ctx.api, идеи, chatId)
             ↓ getRecipientChatIds(chatId) = подписчики из env + инициатор
             ↓ для каждого чата: для каждой идеи
             ↓     formatIdeaCard → sendMessage(HTML, generate_post:<id>) → sleep(500 мс)
             ↓     ошибка → failedIdeas++, лог, цикл продолжается
             ↓ sleep(500 мс) → «✅ Отправлено 10 идей!» в этот чат
             ↓ после всех чатов → markIdeasAsSent(sentIdeaIds) → статус SENT
        ↓ finally → clearSelection + finishSending
```

Отчёт пайплайна (ручной запуск и крон — один и тот же путь):

```
/run_pipeline или крон ↓ commandManager.execute → статус-сообщение + кнопка «Отменить»
        ↓ прогресс: editMessageText по стадиям (троттлинг STATUS_EDIT_INTERVAL_MS)
        ↓ пайплайн → finalText = formatPipelineReport(result, duration)
        ↓ editOrSend(статус, «✅ Готово, полный отчёт ниже.»)   ← UI, не отчёт
        ↓ ошибка → finalText = «❌ Ошибка выполнения пайплайна…», статус = «❌ Пайплайн завершился с ошибкой…»
        ↓ отмена → execute правит статус на «❌ Команда отменена», finalText = «🚫 Прогон пайплайна отменён.»
        ↓ уже выполняется → «⏳ Эта команда уже выполняется», рассылки нет
        ↓ getRecipientChatIds(ctx.chat.id) = подписчики + инициатор
        ↓ sendMessageToChats(api, targets, finalText, parse_mode)  ← всем, по одному разу
```

Крон отдельно (только то, что `runPipeline` узнать не может):

```
старт прогона ↓ getSubscriberChatIds().filter(id => id !== ADMIN_CHAT_ID)
             ↓ «🤖 Автоматический запуск pipeline» (Markdown) — админ получает статус от execute
ошибка вне execute ↓ getSubscriberChatIds()
                  ↓ «❌ Критическая ошибка автоматического запуска» — всем, включая админа
```

## 6. Почему так, а не иначе

1. **Результат всегда через рассылку, а не через `ctx`.** Пока у инициатора и у подписчиков два разных пути доставки, приходится держать в коде «кому уже ушло», иначе дубли. Когда путь один, проверок не нужно в принципе: дубль физически невозможен, пока никто не добавит вторую отправку того же текста.
2. **Единая формула получателей вместо фильтра в каждом файле.** Список подписчиков читался в четырёх местах, каждый раз чуть иначе. Теперь чтение env и сборка списка — одна функция, её результат видно на вызывающей стороне: `getRecipientChatIds(инициатор)` читается как «кому уходит результат».
3. **Рассылка отчёта в `runPipeline`, а не в кроне.** Крон — это просто другой вызов того же хендлера. Если доставку делает хендлер, у ручного запуска и крона идентичное поведение, а дубли невозможны: крон-циклы удалены, а не отключены флагом.
4. **Статус-сообщение — UI, а не носитель отчёта.** Иначе нельзя убрать `ctx`-доставку: пришлось бы либо оставить отчёт в двух местах, либо оставить в чате инициатора сообщение «Запуск пайплайна…» с мёртвой кнопкой отмены.
5. **Свой флаг `sendingUserIds`, а не `CommandManager`.** `CommandManager.execute()` шлёт статус-сообщение с кнопкой «Отменить» и поднимает `AbortController` — для флоу на несколько секунд без реальной отмены это лишний UX-шум. Плюс флоу настолько быстрый, что гонки в `finally` не бывает: состояние забирается синхронно до `await`. А вот кнопка «Сгенерировать пост» идёт через `CommandManager` — там генерация реально долгая, и отмена полезна.
6. **TTL ленивый, без `setInterval`.** Протухшая запись не выдаётся при чтении — отдельный таймер только добавил бы ручки к процессу (как `unref` в `CommandManager`).
7. **Снятие клавиатуры до обработки.** Повторное нажатие становится физически невозможно, а не просто игнорируется.
8. **Циклический импорт убран.** `ideas` больше не импортирует `bot` из `bot/index.ts` — рассылка идёт через `ctx.api`, тот же экземпляр API.

## 7. Граничные случаи

- Пул `NEW` ≤ 10 → все три режима отдают весь пул (кнопка «Запустить генерацию» не появляется).
- Выбранная категория пустая, другие непустые → «📭 Нет новых идей» + кнопка запуска генерации, состояние очищено, для следующего выбора нужен новый `/ideas`.
- Инициатор не в `SUBSCRIBER_CHAT_IDS` → всё равно получает результат: `getRecipientChatIds` добавляет его чат.
- `SUBSCRIBER_CHAT_IDS` пустой → результат уходит только инициатору; крон по-прежнему пишет предупреждение и не запускается.
- Инициатор подписан → в списке получателей он один раз, второй копии нет (проверка `includes`).
- Двойной клик / протухший TTL → тост «⏳ Дождись окончания предыдущего запроса», к БД не идём.
- Ошибка отправки одному чату → рассылка продолжается, в лог падает чат и текст ошибки, идея в этом чате не помечается `SENT` только если не ушла хотя бы одному.
- `/run_pipeline`, когда пайплайн уже идёт → `already_running`, рассылки нет (отчёт придёт от идущего прогона, инициатор получит его один раз).
- `/last_run` без запусков → «📭 Запусков ещё не было» остаётся через `ctx.reply`: это ответ конкретному человеку, а не результат для рассылки.

## 8. Известные риски

- **Инициатор «съедает» порцию.** Идеи уходят всем подписчикам и сразу становятся `SENT` — второй участник получит другую порцию (или пустую). Это текущая модель статусов, сохранили осознанно; после реализации стоит пересмотреть (например, `SENT` не выставлять, а вести счётчик показов).
- **Троттлинг 500 мс подобран на глаз.** 10 идей × 3 подписчика ≈ 15 с на рассылку. При большем числе подписчиков константу в `config.ts` надо поднимать.
- **Отчёт инициатору приходит вторым сообщением и последним в очереди.** Он видит в чате статус «✅ Готово…», а сам отчёт — в цикле рассылки после подписчиков. Взамен мы потеряли для инициатора `withRetry` из `editOrSend` и видимость ошибки: `sendMessageToChats` ошибку только логирует, до `bot.catch` она не дойдёт.
- **Состояние в памяти процесса.** При рестарте/реплое пользователь потеряет невыбранную клавиатуру — придётся вызвать `/ideas` заново.
- **Доступ не ограничен.** Аккаунт без allowlist может выбрать категорию и отобрать порцию у подписчиков; антифлуд и контроль доступа — вне этой задачи.

## Преимущества

- ✅ Одно место чтения `SUBSCRIBER_CHAT_IDS` и одна формула списка получателей.
- ✅ Результат нигде не доставляется через `ctx` — дублей быть не может, а «кому уже ушло» проверять не нужно.
- ✅ Инициатор любого действия гарантированно получает результат: `/ideas`, `/run_pipeline`, `/last_run`, крон.
- ✅ `/ideas` даёт выбор категории; выбор одноразовый — двойной клик физически невозможен.
- ✅ Rate limit закрыт паузой между отправками вместо надежды на лимиты Telegram.
- ✅ Ручной `/run_pipeline` и крон отправляют отчёт одинаково; в кроне осталось только то, чего хендлер узнать не может.
- ✅ Циклический импорт `bot/index.ts → commands → ideas → bot/index.ts` разорван.

---

**Валидация:** `npm run type-check` — чисто; `npx eslint src/bot src/cron src/shared src/repositories` — единственная ошибка предсуществующая (`cancelCommand.ts:34`, `no-explicit-any`, проверено на чистом дереве через `git stash`); `npm test` — 21/21.
