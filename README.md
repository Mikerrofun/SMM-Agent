# SMM Agent

Персональный AI-ассистент для создания контент-плана и подготовки публикаций
в Telegram-канале. Анализирует публикации конкурентов, предлагает идеи для
постов и помогает генерировать полноценные публикации в авторском стиле.
Второй источник контента — транскрипции встреч с клиентами: команда
`/transcript_post` принимает PDF и возвращает 2 готовых поста.

Финальное решение о выборе идеи и публикации всегда принимает человек — система
ничего не публикует автоматически.

## Стек

Next.js (App Router), TypeScript, Prisma + Supabase (PostgreSQL), OpenAI,
grammy (Telegram-бот), node-cron, zod.

## Быстрый старт

```bash
# 1. Установить зависимости
npm install

# 2. Скопировать шаблон переменных окружения и заполнить значения
cp .env.example .env

# 3. Запустить в режиме разработки
npm run dev
```

Проверка работоспособности: http://localhost:3000/api/health

## Скрипты

| Команда                 | Назначение                          |
| ----------------------- | ----------------------------------- |
| `npm run dev`           | Запуск в режиме разработки          |
| `npm run build`         | Production-сборка                   |
| `npm run start`         | Запуск production-сборки            |
| `npm run lint`          | Проверка ESLint                     |
| `npm run type-check`    | Проверка типов (`tsc --noEmit`)     |
| `npm run prisma:studio` | Prisma Studio (после настройки БД)  |
| `npm run parse:natalia` | Парсинг канала @talant_director     |
| `npm run parse:competitors` | Парсинг каналов конкурентов (25 каналов) |
| `npm run seed:competitors` | Заполнение БД списком конкурентов |
| `npm run extract:mainidea:natalia` | Извлечение mainIdea из постов Натальи |
| `npm run bot`           | Запуск Telegram-бота                |
| `npm run bot:dev`       | Запуск бота в watch-режиме          |


## Документация

- [docs/VISION.md](docs/VISION.md) — цели проекта, флоу MVP, принципы генерации.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — структура папок, стек, принципы
  организации кода.
- [docs/RAILWAY_DEPLOYMENT.md](docs/RAILWAY_DEPLOYMENT.md) — деплой на Railway с Supabase.
- [docs/CRON.md](docs/CRON.md) — настройка автоматических запусков по расписанию.
- [docs/PARSING.md](docs/PARSING.md) — как работает парсинг Telegram-каналов (для других агентов).
- [docs/NATALIA_PARSER.md](docs/NATALIA_PARSER.md) — парсер канала Натальи (@talant_director).
- [docs/COMPETITORS_PARSER.md](docs/COMPETITORS_PARSER.md) — парсер каналов конкурентов (25 каналов).
- [docs/MAIN_IDEA_EXTRACTION.md](docs/MAIN_IDEA_EXTRACTION.md) — извлечение главной мысли (mainIdea) через LLM.
- [docs/features/TRANSCRIPT_POST_GENERATION.md](docs/features/TRANSCRIPT_POST_GENERATION.md) — генерация постов из транскрипций встреч (`/transcript_post`).



## Как узнать свой Telegram ID

Для настройки `SUBSCRIBER_CHAT_IDS` нужны числовые ID пользователей Telegram:

### Вариант 1: Через @userinfobot (самый простой)
1. Напишите боту [@userinfobot](https://t.me/userinfobot) в Telegram
2. Он ответит вам с вашим ID (например: `6788213640`)

### Вариант 2: Через @getmyid_bot
1. Напишите боту [@getmyid_bot](https://t.me/getmyid_bot)
2. Он покажет ваш ID

### Вариант 3: Через команду /myid (если добавить в бота)
Можно добавить команду в бот:
```typescript
bot.command("myid", async (ctx) => {
  await ctx.reply(`Ваш Telegram ID: ${ctx.from?.id}`);
});
```

После получения ID всех пользователей, добавьте их в `.env`:
```bash
SUBSCRIBER_CHAT_IDS="6788213640,1234567890,9876543210"
```

**Важно:** Первый ID в списке — главный админ, который получает детальные отчёты о работе pipeline.
