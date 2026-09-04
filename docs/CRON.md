---

**Дата:** 09.08.2026  
**Обновлено:** 05.09.2026 (добавлена автоматическая рассылка идей всем подписчикам)  
**Теги:** #features #cron #automation #telegram-bot #broadcast

---

## 1. Зачем

Ручной запуск `/run_pipeline` требует, чтобы кто-то помнил и вручную нажимал кнопку каждый вторник и четверг. Это неудобно, легко забыть, нет гарантии регулярности. Нужен автоматический запуск pipeline по расписанию с отправкой результатов администратору в Telegram и **автоматической рассылкой идей всем подписчикам**.

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

Задача была не писать новую логику pipeline, а создать автоматический триггер для существующей команды и **добавить рассылку идей всем подписчикам**.

## 3. Реализация

### Утилита массовой рассылки

```ts
// src/bot/utils/broadcast.ts
export async function broadcastIdeasToSubscribers(
  subscriberIds: string[],
  maxIdeas: number = 10
): Promise<BroadcastResult> {
  
  // 1. Получаем NEW идеи из БД
  const ideas = await getNewIdeasForSending(maxIdeas);
  
  // 2. Для каждого подписчика отправляем идеи
  for (const chatId of subscriberIds) {
    try {
      for (const idea of ideas) {
        await bot.api.sendMessage(chatId, formatIdeaMessage(idea), {
          parse_mode: "HTML",
          reply_markup: generatePostKeyboard(idea.id)
        });
      }
      successCount++;
    } catch (error) {
      // Обработка ошибок (blocked bot, chat not found)
      failedCount++;
    }
  }
  
  // 3. Помечаем идеи как SENT
  await markIdeasAsSent(ideaIds);
  
  return { totalSubscribers, successCount, failedCount, ideasSent, errors };
}
```

### Планировщик задач

```ts
// src/cron/scheduler.ts
import cron from "node-cron";
import { Context } from "grammy";
import { bot } from "../bot";
import { handleRunPipelineCommand } from "../bot/commands/runPipeline";
import { broadcastIdeasToSubscribers } from "../bot/utils";

// Парсим список подписчиков из переменной окружения
const SUBSCRIBER_CHAT_IDS = process.env.SUBSCRIBER_CHAT_IDS
  ?.split(',')
  .map(id => id.trim())
  .filter(id => id.length > 0) || [];

// Первый ID — главный админ для отчётов
const ADMIN_CHAT_ID = SUBSCRIBER_CHAT_IDS[0];

const CRON_ENABLED = process.env.CRON_ENABLED !== "false";
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "50 6 * * 2,4";

async function runScheduledPipeline(): Promise<void> {
  if (!ADMIN_CHAT_ID || SUBSCRIBER_CHAT_IDS.length === 0) {
    console.error("[CRON] ❌ SUBSCRIBER_CHAT_IDS не настроен");
    return;
  }

  // 1. Запускаем pipeline (отчёт отправляется админу)
  const ctx = createCronContext(ADMIN_CHAT_ID);
  const pipelineResult = await handleRunPipelineCommand(ctx);

  // 2. Если есть новые идеи — рассылаем всем подписчикам
  if (pipelineResult?.success && pipelineResult.data?.acceptedIdeasFromRun > 0) {
    const broadcastResult = await broadcastIdeasToSubscribers(SUBSCRIBER_CHAT_IDS, 10);
    
    // Отправляем админу статистику рассылки
    await bot.api.sendMessage(
      ADMIN_CHAT_ID,
      `📊 Статистика рассылки:\n` +
      `✅ Успешно: ${broadcastResult.successCount}/${broadcastResult.totalSubscribers}\n` +
      `💡 Идей отправлено: ${broadcastResult.ideasSent}`
    );
  }
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
# Comma-separated list of Telegram chat IDs (first ID = main admin)
SUBSCRIBER_CHAT_IDS="6788213640,1234567890,9876543210"

CRON_ENABLED=true                # Включить/выключить автозапуск
CRON_SCHEDULE="50 6 * * 2,4"     # Вт и Чт в 9:50 MSK (6:50 UTC)
```

## 4. Поток данных

```
node-cron (расписание: вт/чт 6:50 UTC = 9:50 MSK)
  ↓
runScheduledPipeline()
  ↓
createCronContext(ADMIN_CHAT_ID) → фейковый Context для Grammy
  ↓
handleRunPipelineCommand(ctx) → существующая команда бота
  ↓
runFullPipeline() → парсинг → генерация идей → дедупликация
  ↓
ctx.reply() → отчёт админу о завершении pipeline
  ↓
broadcastIdeasToSubscribers(SUBSCRIBER_CHAT_IDS)
  ↓
Для каждого подписчика:
  • bot.api.sendMessage(chatId, idea) с кнопкой "Сгенерировать пост"
  • Обработка ошибок (bot blocked, chat not found)
  ↓
markIdeasAsSent() → помечаем идеи как SENT
  ↓
Отчёт админу о статистике рассылки
```

## 5. Почему так, а не иначе

1. **Переиспользование `handleRunPipelineCommand` вместо дублирования логики**  
   Вся логика pipeline, форматирование отчетов, обработка ошибок уже реализованы. Создание фейкового `Context` позволяет вызвать команду напрямую без дублирования кода.

2. **`node-cron` внутри процесса бота, а не отдельный сервис**  
   Упрощает деплой — один процесс, один Procfile, не нужен Railway Cron Jobs. Планировщик живет пока работает бот.

3. **UTC timezone в cron-выражении**  
   Railway и большинство хостингов работают в UTC. Конвертация времени делается при настройке расписания (`6:50 UTC = 9:50 MSK`), а не в коде.

4. **`SUBSCRIBER_CHAT_IDS` вместо БД пользователей**  
   Для корпоративного бота (до 10 пользователей) достаточно списка в `.env`. Не нужна таблица `User`, миграции, подписка/отписка. Легко добавить/удалить пользователя через переменные окружения.

5. **Первый ID из списка = главный админ**  
   Простое решение для определения кому отправлять отчёты о pipeline. Не требует отдельной переменной `ADMIN_CHAT_ID`.

6. **Автоматическая рассылка после успешного pipeline**  
   Пользователи получают идеи сразу после генерации, не нужно вручную вызывать `/ideas`. Если новых идей нет — рассылка не выполняется.

7. **Обработка ошибок рассылки**  
   Если пользователь заблокировал бота — остальные всё равно получат идеи. Админ получает статистику успешных/неудачных отправок.

## Преимущества

- ✅ Нулевое дублирование логики — переиспользуем существующую команду `/run_pipeline`
- ✅ Один процесс для бота и cron — проще деплой и мониторинг
- ✅ Автоматические отчеты в Telegram — не нужно проверять логи
- ✅ **Автоматическая рассылка идей всем подписчикам** — пользователи получают идеи без ручного вызова `/ideas`
- ✅ Гибкая настройка через env — расписание и подписчиков можно менять без редеплоя
- ✅ Масштабируемость — легко добавить нового пользователя в список
- ✅ Обработка ошибок — если кто-то заблокировал бота, остальные получают идеи
- ✅ Graceful shutdown — планировщик корректно останавливается по SIGTERM

## Как добавить нового пользователя

1. Попросите пользователя написать боту `/start`
2. Узнайте его Telegram ID (можно через @userinfobot)
3. Добавьте ID в `.env`: `SUBSCRIBER_CHAT_IDS="старые_айди,новый_айди"`
4. Перезапустите бота

Новый пользователь будет получать идеи при следующем автоматическом запуске cron.
