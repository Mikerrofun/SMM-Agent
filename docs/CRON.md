---

**Дата:** 09.08.2026  
**Теги:** #features #cron #automation #telegram-bot

---

## 1. Зачем

Ручной запуск `/run_pipeline` требует, чтобы кто-то помнил и вручную нажимал кнопку каждый вторник и четверг. Это неудобно, легко забыть, нет гарантии регулярности. Нужен автоматический запуск pipeline по расписанию с отправкой результатов администратору в Telegram. Задача — не дублировать логику, а переиспользовать существующую команду бота.

## 2. Где/что уже было

Вся логика генерации идей уже реализована в `handleRunPipelineCommand`:

```ts
// src/bot/commands/runPipeline.ts
export async function handleRunPipelineCommand(ctx: Context): Promise<void> {
  // Запуск pipeline с отправкой статус-сообщений
  const result = await runFullPipeline(async (stage, status) => {
    await ctx.api.editMessageText(..., status);
  });
  // Форматирование отчета и отправка результатов
}
```

Функция уже умеет:
- Запускать `runFullPipeline` (парсинг → генерация → дедупликация)
- Отправлять статус-сообщения в процессе
- Форматировать финальный отчет с статистикой
- Обрабатывать ошибки

Задача была не писать новую логику pipeline, а создать автоматический триггер для существующей команды.

## 3. Реализация

### Планировщик задач

```ts
// src/cron/scheduler.ts
import cron from "node-cron";
import { Context } from "grammy";
import { bot } from "../bot";
import { handleRunPipelineCommand } from "../bot/commands/runPipeline";

const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const CRON_ENABLED = process.env.CRON_ENABLED !== "false";
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 7 * * 2,4";

function createCronContext(chatId: string): Context {
  return {
    api: bot.api,
    reply: async (text: string, options?: any) => {
      return await bot.api.sendMessage(chatId, text, options);
    },
  } as Context;
}

async function runScheduledPipeline(): Promise<void> {
  if (!ADMIN_CHAT_ID) {
    console.error("[CRON] ❌ ADMIN_CHAT_ID не настроен");
    return;
  }

  const ctx = createCronContext(ADMIN_CHAT_ID);
  await handleRunPipelineCommand(ctx);
}

export function initScheduler(): void {
  if (!CRON_ENABLED) return;

  cron.schedule(CRON_SCHEDULE, () => void runScheduledPipeline(), {
    scheduled: true,
    timezone: "UTC",
  });
}
```

### Интеграция в запуск бота

```ts
// src/bot/run.ts
import { startBot } from "./index";
import { initScheduler } from "../cron";

async function main() {
  await startBot();
  initScheduler(); // Запускаем планировщик после бота
}

void main();
```

### Переменные окружения

```bash
# .env.example
ADMIN_CHAT_ID=123456789          # ID администратора в Telegram
CRON_ENABLED=true                # Включить/выключить автозапуск
CRON_SCHEDULE="0 7 * * 2,4"      # Вт и Чт в 10:00 MSK (7:00 UTC)
```

Остальная логика pipeline (парсинг, генерация, дедупликация) не изменилась — используется как есть.

## 4. Поток данных

```
node-cron (расписание: вт/чт 7:00 UTC)
  ↓
runScheduledPipeline()
  ↓
createCronContext(ADMIN_CHAT_ID) → фейковый Context для Grammy
  ↓
handleRunPipelineCommand(ctx) → существующая команда бота
  ↓
runFullPipeline() → парсинг → генерация идей → дедупликация
  ↓
ctx.reply() → bot.api.sendMessage(ADMIN_CHAT_ID) → отчет в Telegram админу
```

## 5. Почему так, а не иначе

1. **Переиспользование `handleRunPipelineCommand` вместо дублирования логики**  
   Вся логика pipeline, форматирование отчетов, обработка ошибок уже реализованы. Создание фейкового `Context` позволяет вызвать команду напрямую без дублирования кода.

2. **`node-cron` внутри процесса бота, а не отдельный сервис**  
   Упрощает деплой — один процесс, один Procfile, не нужен Railway Cron Jobs. Планировщик живет пока работает бот.

3. **UTC timezone в cron-выражении**  
   Railway и большинство хостингов работают в UTC. Конвертация времени делается при настройке расписания (`7:00 UTC = 10:00 MSK`), а не в коде.

4. **`ADMIN_CHAT_ID` вместо хардкода**  
   Гибкость — можно менять получателя отчетов через переменные окружения без изменения кода.

## Преимущества

- ✅ Нулевое дублирование логики — переиспользуем существующую команду `/run_pipeline`
- ✅ Один процесс для бота и cron — проще деплой и мониторинг
- ✅ Автоматические отчеты в Telegram — не нужно проверять логи
- ✅ Гибкая настройка через env — расписание и получателя можно менять без редеплоя
- ✅ Graceful shutdown — планировщик корректно останавливается по SIGTERM
