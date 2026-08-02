# Рефакторинг генератора идей — Changelog

## Дата: 2 августа 2026

## Что изменено

### 1. ✅ Вынесены константы AI в отдельный конфиг

**Создан:** `src/ai/ideaExtractor.config.ts`

Вынесены:
- `IDEA_PROMPT_PATH` — путь к промпту
- `IDEA_MAX_TOKENS` — лимит токенов для ответа (300)
- `IDEA_TEMPERATURE` — температура генерации (0.7)

**Причина:** Разделение ответственности, упрощение изменения параметров AI.

---

### 2. ✅ Создана утилита для загрузки промптов

**Создан:** `src/shared/utils/promptLoader.ts`

**Функции:**
- `loadPrompt(path: string): string` — загрузка с кэшированием
- `clearPromptCache(): void` — очистка кэша (для тестов)

**Переиспользуемость:** Можно использовать для всех промптов в проекте.

**Преимущества:**
- Единый механизм кэширования
- Не дублируется код загрузки файлов
- Легко тестировать

---

### 3. ✅ Рефакторинг ideaExtractor.ts

**Было:**
```typescript
// Константы внутри файла
const MAX_TOKENS = 300;
const TEMPERATURE = 0.7;
const PROMPT_PATH = resolve(...);

// Функция загрузки промпта внутри файла
let cachedPrompt: string | null = null;
function getSystemPrompt(): string { ... }
```

**Стало:**
```typescript
// Импорты из конфигов и утилит
import { loadPrompt } from '../shared/utils/promptLoader';
import { IDEA_PROMPT_PATH, IDEA_MAX_TOKENS, IDEA_TEMPERATURE } from './ideaExtractor.config';

// Чистая логика AI
const systemPrompt = loadPrompt(IDEA_PROMPT_PATH);
```

**Результат:** Код чище, легче тестировать, константы в одном месте.

---

### 4. ✅ Добавлены методы в ideaRepository для Telegram

**Добавлено:**

#### `getNewIdeasForSending(limit = 10)`
Возвращает идеи со статусом `NEW` для отправки в Telegram.

```typescript
const ideas = await getNewIdeasForSending(5);
// Вернёт 5 последних идей со статусом NEW
```

#### `getIdeasByStatus(status, limit?)`
Получение идей по любому статусу (NEW, SENT, SELECTED, REJECTED, DUPLICATE).

```typescript
const sentIdeas = await getIdeasByStatus('SENT', 10);
```

#### `countIdeasByStatus(status)`
Подсчёт идей по статусу для статистики.

```typescript
const newIdeasCount = await countIdeasByStatus('NEW');
```

**Применение:** Для интеграции с Telegram-ботом и аналитики.

---

### 5. ✅ Переименован скрипт для ясности

**Было:** `src/scripts/generateIdeas/competitors.ts`  
**Стало:** `src/scripts/generateIdeas/competitorPostsToIdeas.ts`

**Причина:** Явное название показывает трансформацию: посты конкурентов → идеи.

**NPM скрипт остался тем же:**
```bash
npm run generate:ideas:competitors
```

---

## Файлы созданы

1. `src/shared/utils/promptLoader.ts` — утилита загрузки промптов
2. `src/ai/ideaExtractor.config.ts` — конфиг AI параметров

## Файлы изменены

1. `src/ai/ideaExtractor.ts` — рефакторинг, убраны дублирующие функции
2. `src/repositories/ideaRepository.ts` — добавлены методы для Telegram
3. `package.json` — обновлён путь к скрипту
4. `docs/IDEA_GENERATOR.md` — обновлена документация

## Файлы переименованы

1. `competitors.ts` → `competitorPostsToIdeas.ts`

---

## Что НЕ сделано (отложено)

### Связь с GenerationRun

**Статус:** Отложено до реализации логики отсеивания идей.

**Что нужно будет добавить:**
- Создание `GenerationRun` при старте скрипта
- Обновление полей:
  - `processedPosts` — количество обработанных постов
  - `generatedIdeas` — количество созданных идей
  - `acceptedIdeas` — успешно созданные (пока = generatedIdeas)
  - `rejectedIdeas` — отброшенные как дубли (когда будет дедупликация)
  - `openaiRequests` — сколько запросов ушло в OpenAI

**Когда реализовывать:** После добавления дедупликации через embeddings.

---

## Проверка работоспособности

✅ TypeScript компиляция: `npm run type-check` — успешно  
✅ Файловая структура: все файлы на месте  
✅ Импорты: автоматически обновлены через smart_relocate

---

## Migration Guide

Если использовался старый код:

### До рефакторинга
```typescript
// Прямой импорт, константы внутри файла
import { extractIdea } from './ai/ideaExtractor';
```

### После рефакторинга
```typescript
// Ничего не изменилось — API остался тем же
import { extractIdea } from './ai/ideaExtractor';

// Дополнительно доступны:
import { getNewIdeasForSending } from './repositories/ideaRepository';
```

**Вывод:** Breaking changes нет, API обратно совместим.

---

## Следующие шаги

1. Интеграция с Telegram-ботом через `getNewIdeasForSending()`
2. Добавление дедупликации идей через embeddings
3. Реализация связи с `GenerationRun` для полной статистики
4. Возможно: рефакторинг других AI модулей по этому же паттерну
