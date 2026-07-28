# SMM Agent

Персональный AI-ассистент для создания контент-плана и подготовки публикаций
в Telegram-канале. Анализирует публикации конкурентов, предлагает идеи для
постов и помогает генерировать полноценные публикации в авторском стиле.

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
| `npm run bot`           | Запуск Telegram-бота                |
| `npm run bot:dev`       | Запуск бота в watch-режиме          |

## Документация

- [docs/VISION.md](docs/VISION.md) — цели проекта, флоу MVP, принципы генерации.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — структура папок, стек, принципы
  организации кода.
- [docs/PARSING.md](docs/PARSING.md) — как работает парсинг Telegram-каналов (для других агентов).
