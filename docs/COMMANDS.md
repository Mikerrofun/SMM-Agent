# Команды запуска

## Парсеры

### Парсинг постов Натальи
```bash
npm run parse:natalia
```
Загружает посты из канала Натальи в БД (`NataliaPost`)

### Парсинг постов конкурентов
```bash
npm run parse:competitors
```
Загружает посты из каналов конкурентов в БД (`CompetitorPost`)

---

## Обработка постов Натальи

### Извлечение mainIdea
```bash
npm run extract:mainidea:natalia
```
Генерирует `mainIdea` для постов Натальи через LLM

### Генерация embeddings
```bash
npm run generate:embeddings:natalia
```
Создаёт векторные представления для постов Натальи (pgvector)

---

## Генерация идей

### Создание идей из постов конкурентов
```bash
npm run generate:ideas:competitors
```
Генерирует идеи (`Idea`) из постов конкурентов с embeddings:
- Извлекает структуру идеи через LLM (title, mainIdea, goal)
- Создаёт embedding от mainIdea
- Сохраняет в БД атомарно

### Дедупликация идей
```bash
npm run deduplicate:ideas
```
Проверяет NEW идеи на похожесть через pgvector (cosine similarity ≥ 0.85):
- Сравнивает с существующими идеями (NEW + SENT статусы)
- Сравнивает с постами Натальи
- Помечает дубликаты статусом DUPLICATE с метаданными

**Типичный workflow:**
```bash
npm run parse:competitors              # 1. Парсинг постов конкурентов
npm run generate:ideas:competitors     # 2. Генерация идей с embeddings
npm run deduplicate:ideas              # 3. Дедупликация идей
# 4. Бот отправляет NEW идеи пользователю
```

---

## Бот

### Запуск Telegram бота
```bash
npm run bot
```
Запускает бота для работы с Натальей (отправка идей, обработка реакций)

### Запуск в watch режиме
```bash
npm run bot:dev
```
Запускает бота с автоперезагрузкой при изменении кода

---

## База данных

### Создание бэкапа
```bash
npm run db:backup
```
Создаёт полный дамп базы данных Supabase:
- Использует `pg_dump` (PostgreSQL 17)
- Читает `DIRECT_URL` из `.env` (fallback на `DATABASE_URL`)
- Сохраняет в `db-backups/backup-YYYY-MM-DD-HH-MM-SS.sql`
- Включает структуру таблиц + все данные

### Восстановление из бэкапа
```bash
npm run db:restore
```
Восстанавливает базу из последнего бэкапа:
- Автоматически выбирает самый свежий файл из `db-backups/`
- ⚠️ **Перезаписывает текущую базу данных!**
- Использует `psql` для импорта SQL-дампа

**Типичный сценарий:**
```bash
npm run db:backup                # Перед рискованными операциями
# ... работа с базой, случайное удаление данных ...
npm run db:restore               # Откат к последнему бэкапу
```

### Prisma Studio
```bash
npm run prisma:studio
```
Открывает веб-интерфейс для просмотра и редактирования БД

### Seed конкурентов
```bash
npm run seed:competitors
```
Заполняет таблицу `Competitor` начальными данными

---

## Разработка

### Проверка типов
```bash
npm run type-check
```
Запускает TypeScript компилятор без генерации файлов

### Линтинг
```bash
npm run lint
```
Проверяет код через ESLint

### Тестирование AI
```bash
npm run test:ai
```
Тестовый скрипт для проверки AI интеграций

### Проверка доступных моделей
```bash
npm run check:models
```
Проверяет доступные модели OpenAI/Anthropic через API

---

## Next.js

### Разработка
```bash
npm run dev
```
Запускает Next.js dev сервер на http://localhost:3000

### Продакшен сборка
```bash
npm run build
```
Собирает оптимизированную версию для продакшена

### Запуск продакшена
```bash
npm run start
```
Запускает собранную версию
