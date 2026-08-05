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
