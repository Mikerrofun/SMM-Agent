# Main Idea Extraction — извлечение главной мысли

Механизм извлекает главную мысль (`mainIdea`) из постов через LLM. Результат
используется дальше для векторизации и дедупликации по смыслу (см.
[`Embeddings.md`](./Embeddings.md)).

## Как это работает

```
CLI (natalia.ts)
   ↓
Получить посты без mainIdea (repository)
   ↓
processBatch() — батчи по 20 постов параллельно, retry
   ↓
extractMainIdea() — вызов LLM для каждого поста
   ↓
updateMainIdea() — сохранение результата в БД
   ↓
Финальная статистика
```

## Архитектура

| Файл | Назначение |
|------|-----------|
| `src/ai/mainIdeaExtractor.ts` | Универсальная функция вызова LLM `extractMainIdea(text)`. |
| `src/prompts/extract-main-idea.md` | System-промпт для сжатия текста в 3-4 предложения. |
| `src/services/nataliaPost/mainIdeaProcessor.ts` | Batch + retry + сбор статистики (`processBatch`). |
| `src/services/nataliaPost/mainIdeaProcessor.types.ts` | Типы (`ProcessableItem`, `ProcessOptions`, `ProcessStats`). |
| `src/services/nataliaPost/mainIdea.config.ts` | Конфиг retry и rate limit. |
| `src/repositories/nataliaPostRepository.ts` | `getPostsWithoutMainIdea()`, `updateMainIdea()`. |
| `src/scripts/extractMainIdea/natalia.ts` | CLI-точка входа для постов Натальи. |
| `src/shared/utils/progressBar.ts` | Progress bar (`cli-progress`). |

`services/` группируется по доменам-сущностям: всё, что относится к
`NataliaPost`, лежит в `services/nataliaPost/`. Когда появятся `Idea` и
`CompetitorPost`, для них заведутся соседние папки `services/idea/`,
`services/competitorPost/`.


Сервис `processBatch` универсален: принимает функции `extractor` и `save`,
поэтому легко переиспользуется для `Idea` и `CompetitorPost`.

## Использование

```bash
npm run extract:mainidea:natalia
```

Скрипт обрабатывает только посты, где `mainIdea` пустая. Повторный запуск
обрабатывает только оставшиеся (не трогает уже заполненные).

## Параметры LLM

- Модель: `gpt-5.6-luna` (`DEFAULT_MODEL` из `src/core/lib/openai.ts`)
- `temperature: 0.3`
- `max_tokens: 200`
- Формат результата: 3-4 предложения

## Параметры обработки

- Размер батча: **20** постов параллельно
- Retry: **3** попытки с задержкой **3 сек**
- После 3 неудачных попыток пост попадает в список `failedItems`

## FAQ / Troubleshooting

**Скрипт упал на середине — что делать?**
Просто запустите команду снова. Уже сохранённые посты пропускаются, обработка
продолжится с оставшихся.

**Часть постов в статистике как «Ошибки».**
В конце выводится список `id` с текстом ошибки. Запустите команду повторно —
скрипт снова попробует обработать эти посты.

**Как прервать выполнение?**
`Ctrl+C`. Уже сохранённые в БД результаты не теряются.

**Как расширить на другие сущности (Idea, CompetitorPost)?**
Создайте новый CLI-скрипт (например `src/scripts/extractMainIdea/ideas.ts`),
добавьте в repository методы получения/обновления и передайте их в
`processBatch({ save, extractor })`.
