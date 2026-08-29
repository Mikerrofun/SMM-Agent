---

**Дата:** 29.08.2026  
**Теги:** #refactoring #logging #cron #reliability

---

# Гарантированное логирование статистики pipeline

## Обзор изменений

- Добавлена общая функция логирования статистики для переиспользования в команде бота и крон-задаче
- Исправлена проблема с отсутствием логов при зависании обновления сообщений Telegram
- Перенесены типы в `pipelineService.types.ts` для централизованного управления
- Упрощена архитектура за счёт устранения дублирования кода

---

## Часть 1: Проблема с зависанием логирования

### Проблема

**Проблема:** Pipeline выполняется успешно (данные в БД сохраняются), но `ctx.api.editMessageText` зависает при обновлении сообщения в Telegram. В результате финальная статистика не выводится в консоль, и невозможно понять, что процесс завершился.

**Контекст:** Это происходило и в ручном запуске `/run_pipeline`, и в автоматическом крон-запуске. Логирование находилось внутри `try` блока, поэтому при зависании API не доходило до финальных `console.log`.

### Решения

#### 1.1. Общая функция логирования статистики

**Файл:** `src/bot/commands/runPipeline.ts`

```ts
export function logPipelineStats(result: PipelineResult, duration: number): void {
  console.log("\n📊 СТАТИСТИКА ВЫПОЛНЕНИЯ:");
  console.log("━".repeat(60));
  console.log("\n📡 Парсинг каналов:");
  console.log(`   • Обработано каналов: ${result.parsing.totalChannels}`);
  console.log(`   • Успешно: ${result.parsing.successfulChannels}`);
  console.log(`   • Новых постов: ${result.parsing.savedPosts}`);
  if (result.parsing.skippedPosts > 0) {
    console.log(`   • Пропущено (дубли): ${result.parsing.skippedPosts}`);
  }
  
  console.log("\n💡 Генерация идей:");
  console.log(`   • Обработано постов: ${result.ideas.total}`);
  console.log(`   • Создано идей: ${result.ideas.succeeded}`);
  if (result.ideas.failed > 0) {
    console.log(`   • Ошибок: ${result.ideas.failed}`);
  }
  
  console.log("\n🔍 Дедупликация:");
  console.log(`   • Проверено всего идей: ${result.deduplication.total}`);
  console.log(`   • Новых из прогона: ${result.ideas.succeeded}`);
  console.log(`   • Уникальных из прогона: ${result.acceptedIdeasFromRun}`);
  if (result.deduplication.duplicates > 0) {
    console.log(`   • Дубликатов найдено: ${result.deduplication.duplicates}`);
  }
  
  console.log("\n" + "━".repeat(60));
  console.log(`⏱️  Время выполнения: ${formatDuration(duration)}`);
  console.log("━".repeat(60) + "\n");
}
```

**Логика:** Единая функция выводит детальную статистику всех этапов pipeline (парсинг, генерация идей, дедупликация) в структурированном виде. Используется и в команде бота, и в крон-задаче — нет дублирования кода.

#### 1.2. Вызов логирования после успешного выполнения

**Файл:** `src/bot/commands/runPipeline.ts`

```ts
const result = await Promise.race([pipelinePromise, timeoutPromise]);
const duration = Math.round((Date.now() - startTime) / 1000);

// Логируем статистику в консоль
logPipelineStats(result, duration);

let finalMessage = "✅ <b>Пайплайн успешно завершен!</b>\n\n";
// ... формирование сообщения для Telegram
```

**Логика:** Сразу после получения результата pipeline выводим статистику в консоль, до попытки обновить сообщение в Telegram. Если Telegram API зависнет — статистика уже будет в логах.

---

## Часть 2: Гарантированное логирование в крон-задаче

### Проблема

**Проблема:** В планировщике (`scheduler.ts`) логирование находилось в `try` блоке, поэтому при зависании или ошибке не выводилось. Нужен блок `finally`, который выполняется всегда.

### Решения

#### 2.1. Блок finally с гарантированным логированием

**Файл:** `src/cron/scheduler.ts`

```ts
async function runScheduledPipeline(): Promise<void> {
  const startTime = Date.now();
  const startTimestamp = new Date().toISOString();
  const moscowTime = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[CRON] 🚀 Автоматический запуск pipeline`);
  console.log(`[CRON] ⏰ UTC: ${startTimestamp}`);
  console.log(`[CRON] ⏰ MSK: ${moscowTime}`);
  console.log(`${"=".repeat(60)}\n`);
  
  if (!ADMIN_CHAT_ID) {
    console.error("[CRON] ❌ ADMIN_CHAT_ID не настроен, пропускаем запуск");
    return;
  }

  let pipelineResult: { success: boolean; data?: any; error?: string } | null = null;

  try {
    // ... запуск pipeline
    pipelineResult = await handleRunPipelineCommand(ctx);
  } catch (error) {
    // ... обработка ошибок
  } finally {
    // Гарантированное логирование статистики
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);
    const endTimestamp = new Date().toISOString();
    const endMoscowTime = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
    
    console.log("\n" + "=".repeat(60));
    console.log("[CRON] 🏁 Завершение автоматического запуска");
    console.log("=".repeat(60));
    
    if (pipelineResult?.success && pipelineResult.data) {
      // Используем общую функцию для логирования
      logPipelineStats(pipelineResult.data, duration);
      console.log("✅ Результат: УСПЕХ");
    } else if (pipelineResult?.error) {
      console.log(`\n❌ Результат: ОШИБКА - ${pipelineResult.error}`);
    } else {
      console.log(`\n⚠️  Результат: Статистика недоступна`);
    }
    
    console.log(`\n🕐 Начало (UTC): ${startTimestamp}`);
    console.log(`🕐 Конец  (UTC): ${endTimestamp}`);
    console.log(`🕐 Конец  (MSK): ${endMoscowTime}`);
    console.log("=".repeat(60) + "\n");
  }
}
```

**Логика:** Блок `finally` выполняется независимо от успеха или ошибки. Если pipeline выполнился успешно — вызывается та же `logPipelineStats()`, которая используется в команде. Если результата нет — выводится хотя бы время выполнения и статус. Начальное логирование (старт pipeline) сохранено для возможности отследить начало работы на хостинге.

---

## Часть 3: Типизация и централизация

### Проблема

**Проблема:** Типы были разбросаны, `PipelineCommandResult` определялся в `runPipeline.ts`, что не соответствует логике разделения на слои.

### Решения

#### 3.1. Перенос типов в pipelineService.types.ts

**Файл:** `src/services/pipeline/pipelineService.types.ts`

```ts
export interface PipelineResult {
  parsing: CompetitorParseStatistics;
  ideas: IdeaProcessStats;
  deduplication: DeduplicationStats;
  acceptedIdeasFromRun: number;
}

export interface PipelineCommandResult {
  success: boolean;
  data?: PipelineResult;
  error?: string;
}
```

**Логика:** `PipelineResult` — это результат выполнения самого pipeline. `PipelineCommandResult` — обёртка для команды бота, содержащая статус успеха/ошибки и данные. Оба типа в одном месте для централизованного управления.

#### 3.2. Возврат результата из handleRunPipelineCommand

**Файл:** `src/bot/commands/runPipeline.ts`

```ts
export async function handleRunPipelineCommand(ctx: Context): Promise<PipelineCommandResult> {
  // ...
  try {
    const result = await Promise.race([pipelinePromise, timeoutPromise]);
    // ... обработка
    return { success: true, data: result };
  } catch (error) {
    // ... обработка ошибок
    return { success: false, error: errorMessage };
  }
}
```

**Логика:** Функция теперь возвращает структурированный результат с полем `success`, данными в `data` и ошибкой в `error`. Это позволяет крон-задаче получить результат и вывести статистику в `finally` блоке, даже если обновление сообщения в Telegram зависнет.

---

## Итоги

### Изменённые файлы (3 шт)

**Типы:**
1. `src/services/pipeline/pipelineService.types.ts` — добавлен `PipelineCommandResult`

**Логика:**
2. `src/bot/commands/runPipeline.ts` — добавлена `logPipelineStats()`, функция возвращает `PipelineCommandResult`
3. `src/cron/scheduler.ts` — добавлен `finally` блок с гарантированным логированием через `logPipelineStats()`

### Результаты

- ✅ Статистика pipeline выводится в консоль всегда, независимо от зависания Telegram API
- ✅ Нет дублирования кода — одна функция `logPipelineStats()` для команды и крона
- ✅ Крон-задача гарантированно выводит время выполнения и статус в `finally` блоке
- ✅ Типы централизованы в `pipelineService.types.ts`
- ✅ При зависании на дедупликации или любом другом этапе логи показывают реальное состояние

---

## Принципы, использованные при рефакторинге

**DRY (Don't Repeat Yourself)** — общая функция `logPipelineStats()` вместо дублирования логики в команде и кроне.

**Fail-Safe Logging** — использование `finally` блока гарантирует вывод статистики независимо от успеха или ошибки.

**Single Responsibility** — типы вынесены в отдельный файл, функция логирования отделена от бизнес-логики команды.

**Surgical Changes** — изменения точечные, без переписывания рабочего кода pipeline и Telegram integration.
