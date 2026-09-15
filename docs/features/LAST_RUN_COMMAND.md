# Команда `/last_run` и фикс потери отчёта из-за Telegram 429

---

**Дата:** 16.09.2026
**Теги:** #features #last-run #telegram-bot #rate-limit #429 #broadcast

---

## 1. Для чего

Две связанные задачи, закрытые одной веткой:

### 1.1 Команда `/last_run`

Отчёт о прогоне пайплайна приходит только в момент завершения `/run_pipeline` или cron-запуска. Если в момент отправки что-то багнулось (см. п. 2 — именно так и случилось на Railway: run записался в БД как SUCCESS, а отчёт в чат не пришёл), статистика теряется — хотя данные о прогоне **всегда есть в БД** в таблице `GenerationRun`.

`/last_run` — ручная команда, которая достаёт самый новый `GenerationRun` из БД и отправляет отчёт по нему. Работает в двух режимах:

- **восстановление** — отчёт не пришёл, смотрим последний прогон вручную;
- **история** — просто посмотреть статистику прошлого запуска в любой момент.

### 1.2 Фикс 429 (потеря отчёта)

Во время прогона на 297 постах бот спамил `editMessageText` на **каждую** идею (177/297, 192/297, ...). Telegram ограничивает частоту редактирования сообщения (~1 раз в 2–3 секунды), поэтому API начал отдавать `429 Too Many Requests: retry after 5`. Промежуточные обновления статуса были обёрнуты в try/catch, но **финальный** `editMessageText` с отчётом — нет: исключение улетало в общий catch, который пытался отредактировать то же сообщение с текстом ошибки... и тоже ловил 429. Итог: run в БД — SUCCESS, отчёта в чате нет.

---

## 2. Что требуется (самый важный код)

### 2.1 Троттлинг + withRetry для редактирования статуса

```typescript
// src/bot/commands/runPipeline.ts

// Telegram ограничивает частоту editMessageText (~1 раз в 2-3 секунды на сообщение),
// иначе ловим 429 Too Many Requests
const STATUS_EDIT_INTERVAL_MS = 3000;
const TELEGRAM_EDIT_RETRY = { maxAttempts: 4, delayMs: 3000, backoffFactor: 1.5 } as const;

async function editStatusMessageWithRetry(ctx, statusMessage, text, options?) {
  await withRetry(
    () => ctx.api.editMessageText(
      statusMessage.chat.id, statusMessage.message_id, text, options
    ),
    TELEGRAM_EDIT_RETRY
  );
}
```

В колбэке прогресса — троттлинг по времени вместо редактирования на каждую идею:

```typescript
const now = Date.now();
if (now - lastStatusEditAt < STATUS_EDIT_INTERVAL_MS) return; // не чаще раза в 3 сек
lastStatusEditAt = now;
```

### 2.2 `editOrSend` — гарантия доставки финального отчёта

```typescript
async function editOrSend(ctx, statusMessage, text, options?) {
  if (statusMessage) {
    try {
      await editStatusMessageWithRetry(ctx, statusMessage, text, options);
      return;                       // редактирование удалось
    } catch (error) {
      console.error("Failed to edit status message, falling back to sendMessage:", error);
    }
  }
  await ctx.reply(text, options);   // fallback: отчёт уходит новым сообщением
}
```

Финальный отчёт и сообщение об ошибке отправляются **только** через `editOrSend` — даже если статусное сообщение «залипло» под rate limit, отчёт дойдёт как новое сообщение.

### 2.3 Достать последний прогон из БД

```typescript
// src/repositories/generationRunRepository.ts
export async function getLatestRun(): Promise<GenerationRun | null> {
  return prisma.generationRun.findFirst({
    orderBy: [{ startedAt: 'desc' }],
  });
}
```

Берём **любой статус** (RUNNING/SUCCESS/FAILED) — при разборе инцидента важнее увидеть, что прогон упал или завис, чем отфильтровать неуспешные.

### 2.4 Общий хелпер подписчиков

```typescript
// src/shared/telegram/subscribers.ts
export function getSubscriberChatIds(): string[]        // парсинг SUBSCRIBER_CHAT_IDS из .env
export async function broadcastToSubscribers(api, text, options?, chatIds?)
  // → { sent: number; failed: number }  — ошибка в одном чате не прерывает рассылку
```

Раньше парсинг `SUBSCRIBER_CHAT_IDS` был приватной логикой `scheduler.ts` — вынесен в shared, чтобы переиспользовать в командах.

---

## 3. Подход к реализации

1. **Не хранить отчёт, а пересобирать из БД.** `GenerationRun` уже содержит всё нужное (status, startedAt, finishedAt, processedPosts, generatedIdeas, acceptedIdeas, rejectedIdeas, openaiRequests) — команда просто форматирует запись. Форматтер `formatLastRunReport` живёт рядом с хендлером, переиспользует `formatDuration` из `pipelineReportFormatter.ts`.
2. **Дедупликация получателей.** Чат, откуда написали `/last_run`, получает отчёт напрямую через `ctx.reply`; остальным подписчикам — через `broadcastToSubscribers` с фильтром `id !== requesterChatId`. Никто не получает дубль.
3. **Фикс 429 — тремя слоями защиты:** троттлинг (не создаём 429), `withRetry` (пережидаем единичный 429), `editOrSend` (доставляем отчёт, даже если предыдущие слои не спасли).

---

## 4. Как работает

### `/last_run`

```
Юзер: /last_run
  ↓
getLatestRun() ← самый новый GenerationRun из БД (по startedAt desc)
  ↓
нет записи? → "📭 Запусков пайплайна ещё не было. Запустите /run_pipeline."
  ↓
formatLastRunReport(run) → HTML-отчёт:
  📊 Последний запуск пайплайна
  Статус: ✅ Успешно
  🕐 Начало / 🏁 Завершение (МСК) / ⏱ Длительность
  📈 Посты, создано/принято/отклонено идей, OpenAI запросов
  ↓
SUBSCRIBER_CHAT_IDS пуст? → ответ только в текущий чат
  ↓
иначе: ctx.reply инициатору (если он не в списке рассылки)
       + broadcastToSubscribers() остальным (без дубля инициатору)
```

### Фикс 429 — поток `/run_pipeline`

```
runFullPipeline(onStatus)
  ↓ onStatus (каждая идея)
троттлинг: прошло < 3 сек с последнего edit? → скип
  ↓
editStatusMessageWithRetry() ← withRetry: 4 попытки, задержка 3 сек, backoff 1.5
  ↓ (ошибка всё равно?) → console.error, пайплайн продолжает работать
  ↓
пайплайн завершён → formatPipelineReport()
  ↓
editOrSend(): editMessageText (withRetry) → не вышло? → ctx.reply новым сообщением
```

---

## 5. Поток данных и встраивание в архитектуру

```
.env (SUBSCRIBER_CHAT_IDS)
   └──► src/shared/telegram/subscribers.ts  ← новый общий хелпер
           ├──► src/cron/scheduler.ts       ← переведён с локального парсинга на хелпер
           └──► src/bot/commands/lastRun.ts ← новый хендлер

Prisma (GenerationRun)
   └──► src/repositories/generationRunRepository.ts  ← + getLatestRun()
           └──► lastRun.ts → formatLastRunReport()
                   ├── переиспользует formatDuration() из shared/utils/pipelineReportFormatter.ts
                   └── ctx.reply + broadcastToSubscribers → Telegram

src/bot/index.ts   ← bot.command("last_run", handleLastRunCommand) + строка в /help
src/bot/commands/index.ts ← экспорт handleLastRunCommand
```

Изменённые/новые файлы:

| Файл | Роль |
|---|---|
| `src/bot/commands/lastRun.ts` | **Новый.** Хендлер `/last_run` + `formatLastRunReport` |
| `src/shared/telegram/subscribers.ts` | **Новый.** `getSubscriberChatIds`, `broadcastToSubscribers` |
| `src/repositories/generationRunRepository.ts` | + `getLatestRun()` |
| `src/bot/commands/runPipeline.ts` | Троттлинг 3 сек, `editStatusMessageWithRetry`, `editOrSend` |
| `src/cron/scheduler.ts` | Переведён на `getSubscriberChatIds()` |
| `src/bot/index.ts`, `src/bot/commands/index.ts` | Регистрация команды и /help |

---

## 6. Ограничения

- В отчёте `/last_run` нет статистики парсинга (каналы/дубли) — её нет в модели `GenerationRun`, там хранятся только посты/идеи/статусы. Полная статистика — только в живом отчёте `/run_pipeline`.
- Если прогон ещё `RUNNING`, команда покажет его с длительностью «до текущего момента» (`finishedAt ?? now`).
- `broadcastToSubscribers` шлёт последовательно — при большом списке подписчиков учитывай rate limit Telegram на отправку (~30 сообщений/мин на чат).
