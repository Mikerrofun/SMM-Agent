# План: отмена любых команд через CommandManager

Ветка: `CommandManager`. Статус: план, не реализовано.

## 0. Глобальные правила (действуют для всех задач)

1. **Типизация только в файлах типов.** Никаких интерфейсов/типов/enum-типов внутри файлов с логикой. Всё, что описывает форму данных (`CommandState`, опции execute, типы callback data, типы результатов), кладём в `*.types.ts` рядом с модулем. Классы ошибок (runtime-сущности) — в `*.errors.ts`. Файл с логикой импортирует типы из файлов типов, а не объявляет их у себя.
2. **Никаких задач «написать документацию» и «сделать demo».** Документация обновляется отдельно после полного рефакторинга — в рамках этого плана её не трогаем.
3. **Тесты — один раз в конце, минимальные** (см. последнюю задачу). Промежуточных тестов, моков Telegram и demo-скриптов нет.
4. **Миграция БД: только создать файл миграции.** Не применять, не запускать `prisma migrate dev`. Применение — вручную владельцем проекта.
5. **Точка невозврата — запись в БД.** `checkCancelled()` ставится строго ДО записи. Как только запись началась — проверок нет до её завершения. Записал = конец, отменить нельзя.
6. Оборачивание в CommandManager делаем **внутри экспортированного хендлера команды**, а не в месте регистрации в `bot/index.ts` (обоснование в задаче 4 и в камне №3).

---

## 1. Файлы для изучения (перед стартом)

Читать в этом порядке — этого достаточно, чтобы понять весь поток:

| Файл | Что понять |
| --- | --- |
| `src/shared/utils/CommandMaganer/ CommandManager.ts` | Текущий менеджер: `execute` (статус-сообщение с кнопкой, AsyncLocalStorage), `checkCancelled`, `cancel`, cleanup. Обрати внимание: папка с опечаткой `CommandMaganer`, а в имени файла — ведущий пробел |
| `src/shared/utils/CommandMaganer/CommandManager.types.ts` | `CommandState` — уже вынесен, расширяем здесь |
| `src/bot/index.ts` | Где регистрируются все command/callback-хендлеры, `bot.catch` |
| `src/bot/commands/index.ts` | Баррель экспортов хендлеров |
| `src/bot/commands/runPipeline.ts` + `runPipeline.types.ts` | Пайплайн: глобальный флаг `isPipelineRunning`, свой таймаут через `Promise.race`, троттлинг статуса |
| `src/cron/scheduler.ts` | Крон: `createCronContext` — фейковый `ctx` только с `api` и `reply` (без `from`/`chat`!), вызов `handleRunPipelineCommand` |
| `src/services/pipeline/pipelineService.ts` | Где создаётся `GenerationRun` и где финальные записи; catch → `updateGenerationRunFailed` |
| `src/repositories/generationRunRepository.ts` | Работа со статусами `RunStatus` |
| `prisma/schema.prisma` (модели `GenerationRun`, enum `RunStatus`) | Что именно расширяет миграция |
| `src/bot/commands/nataliaChannelPost/command.ts` | Пример локального `runningForUser` — удаляется |
| `src/bot/commands/transcriptPost/command.ts` + `documentHandler.ts` | Флаг `waitingForPdf` (это state, не lock — не путать) и тяжёлый обработчик PDF |
| `src/bot/commands/ideas.ts` | `handleGeneratePostCallback` — генерация поста по кнопке, своё статус-сообщение |
| `src/bot/commands/regeneratePost.ts` | Перегенерации по кнопкам, `waitingForFeedback` (state, не lock) |
| `src/services/idea/ideaProcessor.ts`, `src/services/idea/deduplicationService.ts` | Циклы с LLM/embedding — куда ставить `checkCancelled` |
| `src/services/shared/postGeneration/postGenerationPipeline.ts`, `src/services/transcript/transcriptProcessingService.ts`, `src/services/nataliaChannelPost/nataliaChannelPostService.ts` | Общий пайплайн генерации постов: embedding → LLM → запись в БД |
| `docs/COMMANDS.md`, `docs/BOT_COMMANDS.md` | Полный список команд (только читать, не обновлять) |

---

## 2. Целевой поток данных (как это работает после внедрения)

1. Пользователь вызывает команду / жмёт кнопку → хендлер обёрнут в `commandManager.execute(ctx, commandName, options, handler)`.
2. `execute`: проверяет «уже запущена?» (per-user по ключу `userId_commandName`, для пайплайна — глобально, см. задачу 2) → регистрирует `AbortController` в `activeCommands` → отправляет стартовое сообщение с инлайн-кнопкой `❌ Отменить` (`callback_data: cancel:<commandId>`) → запускает хендлер внутри `AsyncLocalStorage` с commandId.
3. Пользователь жмёт «Отменить» → `bot.callbackQuery(/^cancel:/)` → валидация нажавшего → `commandManager.cancel(commandId)` → `controller.abort()`.
4. Внутри команды/сервисов в ключевых точках вызывается `checkCancelled()` → если aborted, бросается `CommandCancelledError` → `execute` ловит его, редактирует статус-сообщение в «❌ Команда отменена», снимает команду с учёта.
5. Для пайплайна: catch в `pipelineService` различает отмену → `GenerationRun.status = CANCELLED` (вместо FAILED).
6. Крон запускает тот же обёрнутый хендлер от синтетического пользователя-админа → админ видит ту же кнопку отмены и может отменить крон-пайплайн.

---

## 3. Задачи

### Задача 1. Приведение в порядок самого CommandManager

Файлы: `src/shared/utils/CommandMaganer/` (переименовать), `CommandManager.types.ts`, новый `CommandManager.errors.ts`.

- Переименовать папку `CommandMaganer` → `CommandManager` и файл ` CommandManager.ts` (ведущий пробел в имени!) → `CommandManager.ts`. Обновить импорт в `CommandManager.ts` на types. На момент плана менеджер никем не импортируется, так что сломаться нечему — но делаем это первым шагом, чтобы дальше везде использовать чистый путь.
- Создать `CommandManager.errors.ts` с классом `CommandCancelledError`. В `execute` заменить хрупкое сравнение `error.message === 'Command cancelled'` на `instanceof CommandCancelledError`; `checkCancelled` бросает именно этот класс.
- Расширить `CommandManager.types.ts` (не файл с логикой!): тип опций `execute` — `statusText`, опциональные `successText`, флаг `singleton` (глобальная блокировка по `commandName` независимо от userId — нужно для пайплайна, см. камень №2), флаг «не редактировать сообщение при успехе» (нужен командам, которые сами удаляют статус-сообщение — transcript/natalia).
- Добавить метод `cancelCurrent()`: читает commandId из `AsyncLocalStorage` и делает `abort()` — понадобится для таймаута пайплайна (задача 8).
- Механику `execute`/`checkCancelled`/`cancel`/cleanup не переписывать — она рабочая. Флоу остаётся как в разделе 2.

### Задача 2. Утилита кнопки отмены (единая точка создания сообщения с кнопкой)

Файлы: новый `src/shared/utils/CommandManager/cancelButton.ts` (+ типы в `cancelButton.types.ts`, если появятся).

- Одна функция вида `startMessage`: принимает текст и commandId (`${userId}_${commandName}`), возвращает готовый `reply_markup` с инлайн-кнопкой `❌ Отменить` и `callback_data: cancel:<commandId>`. Смысл: клавиатура отмены создаётся ровно в одном месте.
- `CommandManager.execute` использует эту функцию вместо своего инлайнового `reply_markup`.
- Крон (задача 7) использует её же для стартового сообщения админу.
- Тип callback-строки (`cancel:<commandId>`) и парсер этой строки — тоже в файлах типов/утилите, не инлайн в хендлерах.

### Задача 3. Callback-обработчик отмены

Файлы: новый `src/bot/commands/cancelCommand.ts`, регистрация в `src/bot/index.ts`.

- Хендлер `handleCancelCallback`: распарсить `cancel:<commandId>` → проверить права (см. ниже) → `commandManager.cancel(commandId)` → `answerCallbackQuery` («Отменяю…» / «Команда уже завершена», если commandId в `activeCommands` уже нет).
- Валидация прав: commandId имеет вид `${userId}_${commandName}`. Нажимать «Отменить» может только владелец команды (`ctx.from.id` совпадает с префиксом). Для крон-команд владелец — админ (задача 7), поэтому обычный пользователь не сможет отменить крон, даже узнав commandId. Это защита от подделки callback_data.
- Зарегистрировать в `bot/index.ts`: `bot.callbackQuery(/^cancel:/, handleCancelCallback)`. Порядок относительно других callback-регистраций не критичен — префикс `cancel:` ни с чем не пересекается.

### Задача 4. Обёртывание команд в commandManager

Сначала важное исправление к твоему пункту 3: оборачивать нужно **внутрь экспортированного хендлера** (например, `handleRunPipelineCommand` сам вызывает `commandManager.execute` и передаёт свою текущую логику как handler), а не в месте регистрации в `bot/index.ts`. Причины: (а) крон вызывает `handleRunPipelineCommand` напрямую — при обёртке в `index.ts` крон остался бы без защиты и без кнопки отмены; (б) место регистрации остаётся тонким. Следствие: у пар «callback-хендлер → command-хендлер» (например, `handleRunPipelineCallback` → `handleRunPipelineCommand`) оборачиваем только внешний по цепочке вызова хендлер, иначе получим двойную обёртку и «эта команда уже выполняется» против самого себя (камень №3).

Порядок и состав:

1. **`runPipeline.ts`** — обернуть `handleRunPipelineCommand`. Удалить `isPipelineRunning` / `setIsPipelineRunning` из `runPipeline.types.ts` — их заменяет опция `singleton` у execute (глобальный запрет параллельного пайплайна, включая крон). Свой статус-текст команды совмещаем со `statusText` execute — второе «⏳ Инициализация…» сообщение не отправляем, execute шлёт его сам с кнопкой.
2. **`nataliaChannelPost/command.ts`** — удалить `runningForUser` Map целиком (замена — учёт в CommandManager). Обернуть `handleNataliaChannelPostCommand`. Команда сама удаляет статус-сообщение перед выводом постов — использовать опцию «не редактировать при успехе» (задача 1), иначе execute будет пытаться отредактировать удалённое сообщение.
3. **`transcriptPost/`** — `handleTranscriptCommand` НЕ оборачивать (это мгновенная установка флага `waitingForPdf`, это state, а не long-running задача). Обернуть `handlePdfDocument` — там скачивание PDF, парсинг и генерация. `waitingForPdf` остаётся как есть. `createTranscript` — промежуточная запись «сырого материала» в БД: `checkCancelled` до неё, после неё отмена разрешена до старта генерации постов (записанные посты — результат, их не трогаем).
4. **`ideas.ts`** — обернуть `handleGeneratePostCallback` (генерация поста — долгая LLM-операция). Собственное статус-сообщение «⏳ Генерирую пост…» убрать — его заменяет статус-сообщение execute с кнопкой.
5. **`regeneratePost.ts`** — обернуть `handleRegeneratePostCallback` (три типа перегенерации — долгие). `handleRegeneratePostFeedbackCallback` и `handleFeedbackMessage` — быстрые записи, не оборачивать. `waitingForFeedback` — state, не трогать.
6. **`ideas.ts` `handleIdeasCommand`, `lastRun.ts`, `/status`, `/start`, `/help`** — быстрые операции, не оборачивать. Если захочешь единообразия — `/ideas` можно обернуть с именем `ideas`, но это опционально и в объём не входит.

Для каждой обёрнутой команды выбрать `commandName` (используется в commandId и в сообщении «уже выполняется»): `run_pipeline`, `natalia_channel_post`, `transcript_post_pdf`, `generate_post`, `regenerate_post`. Имена — константы, типизированные union-типом в `CommandManager.types.ts`, чтобы опечататься было нельзя.

### Задача 5. Точки checkCancelled в сервисах

Файлы: `pipelineService.ts`, `ideaProcessor.ts`, `deduplicationService.ts`, `postGenerationPipeline.ts`, `transcriptProcessingService.ts`, `nataliaChannelPostService.ts`.

Правило расстановки: **перед каждой долгой операцией и перед каждой записью в БД**, никогда — между началом записи и её завершением. Конкретно:

- `pipelineService`: после `createGenerationRun` (запись RUNNING — это стартовый маркер, не результат; отменять после неё можно), перед инициализацией Telegram-клиента, в колбэке прогресса парсинга (по каналу), перед `processIdeaBatch`, перед `deduplicateIdeas`, перед финальным `updateGenerationRunSuccess`.
- `ideaProcessor`: в цикле батча — перед каждым элементом (перед LLM-вызовом) и перед `createIdeaAndMarkProcessed`.
- `deduplicationService`: в цикле проверки идей перед векторным поиском и перед записью статуса DUPLICATE.
- `postGenerationPipeline` / `transcriptProcessingService` / `nataliaChannelPostService`: перед embedding, перед LLM-генерацией, перед `create*`/`updateStatus('SENT')`.
- Импорт `checkCancelled` — из модуля CommandManager. Вне бота (npm-скрипты `parse:*`, `generate:*`) он no-op: `AsyncLocalStorage` пуст → функция выходит, ничего не бросая. Поэтому сервисы безопасно вызывают его всегда, отдельные ветки «для бота / для скрипта» не нужны.

### Задача 6. RunStatus.CANCELLED для GenerationRun

Файлы: `prisma/schema.prisma`, новый файл миграции, `generationRunRepository.ts`, `pipelineService.ts`, `runPipeline.ts` (отображение результата).

- `schema.prisma`: добавить `CANCELLED` в enum `RunStatus`.
- Создать файл миграции `prisma/migrations/<timestamp>_add_cancelled_run_status/migration.sql` с единственным выражением `ALTER TYPE "RunStatus" ADD VALUE 'CANCELLED';`. **Файл только создать и закоммитить — не применять** (камень №9 про транзакцию).
- `generationRunRepository.ts`: добавить `updateGenerationRunCancelled` (по аналогии с `updateGenerationRunFailed`: `finishedAt`, статус CANCELLED, частичная статистика). Типы параметров — в `generationRunRepository.types.ts`, если заведёшь отдельные; иначе типы Prisma.
- `pipelineService.ts` catch: различать `CommandCancelledError` → `updateGenerationRunCancelled`, любую другую ошибку → `updateGenerationRunFailed` (как сейчас). Частично записанная статистика на момент отмены — сохранять той, что уже посчитана, нули не затирать.
- `/last_run` (`lastRun.ts` + `pipelineReportFormatter.ts`): `getLatestRun` теперь может вернуть CANCELLED-прогон. Отображать отдельным понятным текстом («последний прогон был отменён»), не как SUCCESS и не как FAILED.

### Задача 7. Крон

Файлы: `src/cron/scheduler.ts`.

- **Камень №1, обязательный пункт:** расширить `createCronContext` — сейчас фейковый `ctx` содержит только `api` и `reply`, а `execute` читает `ctx.from?.id` и `ctx.chat?.id`. Без этого `execute` вернёт null и крон **молча** не запустит пайплайн. В фейковый ctx добавить `from: { id: <adminId> }` и `chat: { id: <adminId> }` (ADMIN_CHAT_ID из env привести к числу).
- userId крон-команды = ID админа, commandName = `run_pipeline` → commandId крона совпадает с командой админа: (а) singleton-блокировка сохраняет семантику «только один пайплайн одновременно», (б) админ кнопкой отмены может остановить крон-пайплайн, (в) валидация прав из задачи 3 проходит для админа.
- Стартовое уведомление админу отправлять через утилиту из задачи 2 (с кнопкой отмены). Уведомления остальным подписчикам — без кнопки (им отменять нечего: их commandId не существует).
- Блок «отправить ошибку ВСЕМ подписчикам» в catch: различать отмену (`CommandCancelledError` / результат execute «отменено») — тогда не пугать подписчиков «критической ошибкой», а логировать и разослать нейтральное «прогон отменён» (или ничего). Финальный отчёт остальным подписчикам при отмене не отправлять.
- `pipelineResult` из `handleRunPipelineCommand` при отмене — вернуть различимый результат (например, `success: false` + маркер отмены; тип результата описать в `runPipeline.types.ts`), чтобы крон не путал отмену с ошибкой.

### Задача 8. Таймаут пайплайна

Файлы: `runPipeline.ts`.

- Сейчас `Promise.race([pipelinePromise, timeoutPromise])`: при таймауте race бросает ошибку, но `pipelinePromise` продолжает крутиться в фоне — пайплайн реально не остановлен. После внедрения: в ветке таймаута вызывать `commandManager.cancelCurrent()` (задача 1), чтобы abort прокатился по `checkCancelled` в сервисах, а `GenerationRun` получил CANCELLED (или FAILED — по факту это отмена по таймауту; выбрать CANCELLED и написать это в сообщении юзеру).
- Сообщение про таймаут — через статус-сообщение execute (оно уже есть), дубли не плодить.

### Задача 9. Минимальные тесты (в самом конце)

Файлы: один новый `tests/commandManager.test.ts` (node:test, как существующие тесты проекта).

- Ровно три сценария, без моков Telegram API (фейковый ctx-объект в духе `createCronContext`): (1) `execute` регистрирует команду и снимает учёт после завершения; (2) `cancel` → внутри хендлера `checkCancelled()` бросает `CommandCancelledError`; (3) повторный `execute` во время выполнения блокируется (per-user), а с опцией `singleton` блокируется и для другого userId.
- Ничего больше: без тестов команд, без интеграционных тестов, без тестов крона.
- Проверки: `npm run type-check`, `npm run lint`, `npm test`.

---

## 4. Подводные камни (прочитать до реализации)

1. **Крон сломается молча.** `createCronContext` не содержит `from`/`chat` → `execute` вернёт null без единой ошибки в чате. Пункт 1 задачи 7 обязателен, иначе «отмена» у крона не заработает и сам крон откатится к «ничего не происходит».
2. **Per-user блокировка недостаточна для пайплайна.** `isPipelineRunning` сегодня глобальный. Если просто удалить его и положиться на CommandManager, два разных пользователя (или крон и другой подписчик) запустят два пайплайна параллельно. Отсюда опция `singleton` в задаче 1.
3. **Двойная обёртка.** `handleRunPipelineCallback` вызывает `handleRunPipelineCommand`; если обернуть оба, внутренний execute упрётся в собственную же блокировку. Оборачиваем один раз — внешний по цепочке вызова. По этой же причине обёртка внутри хендлеров, а не в `bot/index.ts`.
4. **Таймаут не останавливает работу.** `Promise.race` только бросает исключение наверх, пайплайн продолжает жечь токены в фоне. Лечится `cancelCurrent()` (задача 8).
5. **Точки невозврата.** Записи, после которых отмены быть не должно: `createIdeaAndMarkProcessed`, `markIdeasAsSent`, `createTranscriptPost` / `updateStatus('SENT')`, финальные `updateGenerationRun*`. `createGenerationRun` (RUNNING) и `createTranscript` — стартовые/сырые записи, отмена после них допустима до начала записи результата. `checkCancelled` — строго до записи.
6. **Строковое сравнение ошибки.** `error.message === 'Command cancelled'` ломается от любого рефакторинга текста. Только `instanceof CommandCancelledError`.
7. **Гонка за статус-сообщение.** `onProgress` в пайплайне — fire-and-forget (`void onProgress(...)`): после отмены отложенный edit может перезаписать «❌ Команда отменена» статусом этапа. Либо в `onProgress`-обёртке проверять aborted и выходить, либо принять косметическую гонку. В плане — проверка aborted (дешёвая).
8. **Переименование папки/файла.** `CommandMaganer/` + ` CommandManager.ts` (пробел) — делаем первым шагом, пока менеджер никто не импортирует; иначе потом придётся править импорты по всему проекту.
9. **Миграция ALTER TYPE.** `ALTER TYPE ... ADD VALUE` в Postgres нельзя использовать в той же транзакции, где значение употребляется. Файл миграции содержит одно выражение — при применении через `prisma migrate` это ок, но не «доклеивай» в него другие выражения. Файл создаём, не применяем.
10. **State ≠ lock.** `waitingForPdf` и `waitingForFeedback` — флаги ожидания ввода от пользователя, а не блокировки долгой работы. Их не удаляем и не заменяем CommandManager — иначе сломаем флоу «пришли PDF» / «напиши уточнение».
11. **`bot.catch` не увидит отмену.** `CommandCancelledError` ловится внутри `execute` и наружу не выходит — это ожидаемо; не «чинить» двойную обработку в `bot.catch`.

## 5. Порядок выполнения

1 → 2 → 3 → 4 (внутри: run_pipeline → natalia → transcript → ideas → regenerate) → 5 → 6 → 7 → 8 → 9. Задачи 2–4 можно делать в одном коммите, 5–8 — по одной команде/сервису за раз, чтобы диффы были обозримыми.
