# Деплой SMM Agent на Railway

## 📋 Подготовка завершена

Ваш проект подготовлен для деплоя на Railway. Созданы необходимые файлы:

- ✅ `Procfile` — указывает Railway запускать бота как worker процесс
- ✅ `.railwayignore` — исключает ненужные файлы из деплоя

## 🚀 Инструкция по деплою

### Шаг 1: Создание проекта на Railway

1. Перейдите на [railway.app](https://railway.app)
2. Войдите через GitHub аккаунт
3. Нажмите **New Project**
4. Выберите **Deploy from GitHub repo**
5. Найдите и выберите репозиторий `SMM-Agent`
6. Выберите ветку для деплоя (обычно `main` или `master`)

### Шаг 2: Подключение к Supabase Database

Вы используете свою базу данных Supabase, поэтому создавать новую на Railway не нужно.

1. Откройте ваш проект на [supabase.com](https://supabase.com)
2. Перейдите в **Settings** → **Database**
3. Найдите **Connection String** в разделе **Connection pooling**
4. Скопируйте URI в формате `postgresql://...`

### Шаг 3: Настройка переменных окружения

В интерфейсе Railway перейдите во вкладку **Variables** вашего сервиса и добавьте:

#### Обязательные переменные:

```bash
# Database (ваш Supabase)
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather

# Telegram MTProto (для парсинга каналов)
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_SESSION_STRING=your_session_string

# Admin notifications (ваш личный chat ID в Telegram)
ADMIN_CHAT_ID=your_telegram_chat_id

# OpenAI
OPENAI_API_KEY=sk-your-openai-key

# Node Environment
NODE_ENV=production

# Cron (опционально, по умолчанию включен)
CRON_ENABLED=true
CRON_SCHEDULE=0 7 * * 2,4
```

**Как получить ADMIN_CHAT_ID:**
1. Напишите боту [@userinfobot](https://t.me/userinfobot) в Telegram
2. Он отправит вам ваш chat ID
3. Скопируйте число и вставьте в `ADMIN_CHAT_ID`

### Шаг 4: Настройка сборки и деплоя

Railway автоматически определит Node.js проект и выполнит:

```bash
npm install              # установка зависимостей
npx prisma generate     # генерация Prisma Client
npm run build           # сборка Next.js (если нужна)
npm run bot             # запуск бота (из Procfile)
```

#### Важно про Prisma и Supabase:

Ваша база данных Supabase уже настроена с расширениями PostgreSQL (включая pgvector для embeddings).

**Применение миграций:**

При первом деплое нужно применить миграции Prisma к вашей Supabase базе.

**Вариант А: Через Railway CLI** (рекомендуется)
```bash
# Установите Railway CLI
npm install -g @railway/cli

# Войдите и свяжите проект
railway login
railway link

# Примените миграции
railway run npx prisma migrate deploy

# Проверьте подключение
railway run npx prisma db pull
```

**Вариант Б: Локально с Supabase URL**
```bash
# Установите DATABASE_URL локально
export DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres"

# Примените миграции
npx prisma migrate deploy
```

### Шаг 5: Запуск и проверка

После настройки переменных Railway автоматически запустит деплой.

Проверьте логи:
1. Откройте ваш сервис в Railway
2. Перейдите во вкладку **Deployments**
3. Откройте последний деплой и проверьте логи

Ожидаемые логи при успешном запуске:
```
🤖 Starting Telegram bot...
✅ Telegram bot is running
📱 Available commands: /start, /help, /ideas, /run_pipeline, /status
```

### Шаг 6: Тестирование бота

1. Откройте Telegram
2. Найдите вашего бота по username
3. Отправьте команду `/start`
4. Попробуйте команду `/status`

Если бот отвечает — всё работает! 🎉

---

## 🔧 Настройка Cron-задач

Ваш проект использует `node-cron` для планирования задач (анализ каждый вторник и четверг в 10:00).

### Как это работает на Railway:

✅ **Cron работает автоматически** внутри процесса бота
✅ **Не требует дополнительных настроек** на Railway
✅ **Работает 24/7** пока процесс бота запущен

### ⚠️ Важно про временные зоны:

Railway работает в **UTC** времени. 

**Дефолтное расписание: `"0 7 * * 2,4"`**
- Это означает: **вторник и четверг в 7:00 UTC**
- В Москве (MSK = UTC+3): **10:00 по Москве** ✅

Если вы хотите изменить время запуска:
- **8:00 MSK** → `"0 5 * * 2,4"` (5:00 UTC)
- **12:00 MSK** → `"0 9 * * 2,4"` (9:00 UTC)
- **Каждый день в 10:00 MSK** → `"0 7 * * *"` (7:00 UTC)

Измените переменную `CRON_SCHEDULE` в настройках Railway.

---

## 📊 Мониторинг и логи

### Просмотр логов в реальном времени:

1. Откройте ваш сервис на Railway
2. Перейдите во вкладку **Deployments**
3. Откройте активный деплой
4. Логи обновляются автоматически

### Основные команды через Railway CLI:

```bash
# Просмотр логов
railway logs

# Просмотр логов с подпиской на новые
railway logs --follow

# Подключение к базе данных
railway connect postgres
```

---

## 🔄 Обновление после изменений в коде

Railway автоматически перезапускает сервис при каждом push в выбранную ветку GitHub.

### Ручной редеплой:

1. Откройте ваш сервис
2. Нажмите на три точки (⋯)
3. Выберите **Redeploy**

---

## ⚠️ Troubleshooting

### Проблема: Бот не запускается

**Проверьте:**
- ✅ Все переменные окружения установлены
- ✅ `TELEGRAM_BOT_TOKEN` корректный
- ✅ База данных PostgreSQL создана и подключена
- ✅ Миграции Prisma применены

**Логи должны показать конкретную ошибку.**

### Проблема: База данных не подключается

**Проверьте:**
- ✅ `DATABASE_URL` указан правильно (из Supabase)
- ✅ IP-адрес Railway добавлен в whitelist Supabase (если включен)
- ✅ Пароль не содержит специальных символов (или они экранированы)

**Решение через Railway CLI:**
```bash
railway link
railway run npx prisma migrate deploy
railway run npx prisma generate
```

**Проверка подключения:**
```bash
railway run npx prisma db pull
```

### Проблема: Cron не срабатывает

**Проверьте:**
- ✅ Время указано в UTC
- ✅ Формат cron-выражения корректный
- ✅ Логи показывают срабатывание cron

**Добавьте логирование в код cron:**
```typescript
console.log('[CRON] Запуск задачи в:', new Date().toISOString());
```

### Проблема: Не хватает памяти

Railway дает **512MB RAM** на бесплатном плане. Если не хватает:

1. Оптимизируйте количество одновременных запросов к AI
2. Увеличьте лимиты в настройках проекта (платная опция)
3. Добавьте батчинг для обработки постов

---

## 💰 Стоимость и лимиты

### Бесплатный план Railway:
- ✅ **$5** бесплатных кредитов в месяц
- ✅ **512MB RAM**
- ✅ **1GB Disk**
- ✅ Автоматические деплои
- ✅ PostgreSQL база данных

### Если кредиты закончатся:

**Альтернативные хостинги:**
- **Render.com** — бесплатный план для background workers
- **Fly.io** — бесплатные 3 VM с 256MB RAM
- **VPS** (Hetzner, DigitalOcean) — от €3-5/месяц, полный контроль

---

## 📚 Полезные ссылки

- [Railway Documentation](https://docs.railway.app/)
- [Railway CLI](https://docs.railway.app/develop/cli)
- [Prisma Deploy Guide](https://www.prisma.io/docs/guides/deployment/deployment-guides/deploying-to-railway)
- [Grammy Bot Framework](https://grammy.dev/)

---

## ✅ Чеклист перед деплоем

- [ ] Все переменные окружения подготовлены
- [ ] `.gitignore` содержит `.env*` (не коммитить секреты!)
- [ ] PostgreSQL база создана на Railway
- [ ] Миграции Prisma применены
- [ ] Cron настроен на правильное время (UTC)
- [ ] Код залит в GitHub репозиторий
- [ ] Railway подключен к репозиторию

**Всё готово! 🚀**
