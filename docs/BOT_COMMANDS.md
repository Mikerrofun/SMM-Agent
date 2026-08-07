# Telegram Bot Commands Documentation

## Overview

This document describes the Telegram bot commands implemented for the SMM Agent idea generation pipeline.

## Available Commands

### `/start`
**Description:** Welcome message with bot introduction

**Response:**
```
👋 Привет! Я SMM Agent — твой персональный AI-ассистент для создания контента.

Я помогу тебе:
• Анализировать публикации конкурентов
• Генерировать идеи для новых постов
• Создавать готовые публикации в твоём стиле

Используй /help для списка команд или /ideas чтобы получить новые идеи.
```

---

### `/help`
**Description:** Shows list of available commands and how to use the bot

**Response:** Formatted list of all commands with usage instructions

---

### `/ideas`
**Description:** Displays all ideas with status `NEW` and marks them as `SENT` after sending

**Behavior:**
- If no ideas are available:
  - Shows message: "Нет новых идей для постов"
  - Displays inline button: "🚀 Запустить генерацию" → triggers `/run_pipeline`
  
- If ideas exist:
  - Sends each idea as a separate message with:
    - **Title** (заголовок)
    - **Main Idea** (основная идея)
    - **Goal** (цель публикации)
    - Inline button: "✍️ Сгенерировать пост" (placeholder for future implementation)
  - Marks all sent ideas as `SENT` in database
  - Shows summary: "✅ Отправлено X идей!"

**Database Changes:**
- Updates `Idea.status` from `NEW` → `SENT` for all displayed ideas

---

### `/run_pipeline`
**Description:** Executes the full idea generation pipeline

**Pipeline Stages:**

1. **Parsing Competitor Channels**
   - Initializes Telegram client
   - Fetches new posts from active competitor channels
   - Saves posts to database
   
2. **Idea Generation**
   - Processes unprocessed competitor posts
   - Generates ideas using GPT-4o
   - Creates embeddings for each idea
   - Saves ideas with status `NEW`
   
3. **Deduplication**
   - Checks new ideas against existing ideas via vector search
   - Checks against Natalia's posts via vector search
   - Marks duplicates with status `DUPLICATE`
   - Keeps unique ideas as `NEW`

**Progress Updates:**
- Real-time status updates in Telegram
- Shows current stage and progress

**Final Statistics:**
```
✅ Пайплайн успешно завершен!

📊 Статистика:

📡 Парсинг каналов:
   • Обработано каналов: X
   • Успешно: X
   • Новых постов: X

💡 Генерация идей:
   • Обработано постов: X
   • Создано идей: X

🔍 Дедупликация:
   • Проверено идей: X
   • Уникальных: X
   • Дубликатов: X

⏱ Время выполнения: X мин Y сек
```

**Safety Features:**
- Prevents concurrent pipeline runs
- 30-minute timeout protection
- Comprehensive error handling
- Graceful Telegram client disconnection

---

### `/status`
**Description:** Health check for the bot

**Response:** "✅ Бот работает нормально!"

---

## Inline Buttons

### "🚀 Запустить генерацию"
**Trigger:** Shown in `/ideas` when no ideas are available  
**Action:** Executes `/run_pipeline` command

### "✍️ Сгенерировать пост"
**Trigger:** Shown under each idea in `/ideas`  
**Action:** Placeholder (shows: "🚧 Генерация постов в разработке. Скоро будет доступна!")  
**Future:** Will generate a full post based on the selected idea

---

## Implementation Details

### File Structure
```
src/bot/
├── index.ts                    # Main bot file with command registration
├── run.ts                      # Bot startup script
└── commands/
    ├── index.ts                # Commands export
    ├── ideas.ts                # /ideas command handler
    └── runPipeline.ts          # /run_pipeline command handler

src/services/pipeline/
├── pipelineService.ts          # Pipeline orchestration
└── pipelineService.types.ts    # Pipeline type definitions

src/repositories/
└── ideaRepository.ts           # Database operations (includes markIdeasAsSent)
```

### Key Functions

#### `markIdeasAsSent(ideaIds: string[]): Promise<number>`
**Location:** `src/repositories/ideaRepository.ts`  
**Purpose:** Atomically updates multiple ideas from `NEW` to `SENT` status  
**Returns:** Number of updated records

#### `runFullPipeline(onProgress: PipelineProgressCallback): Promise<PipelineResult>`
**Location:** `src/services/pipeline/pipelineService.ts`  
**Purpose:** Orchestrates the entire pipeline with progress callbacks  
**Returns:** Statistics from all three stages

---

## Testing Instructions

### Prerequisites
1. Ensure `.env` or `.env.local` file exists with:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token
   TELEGRAM_API_ID=your_api_id
   TELEGRAM_API_HASH=your_api_hash
   TELEGRAM_SESSION_STRING=your_session_string
   DATABASE_URL=your_database_url
   OPENAI_API_KEY=your_openai_key
   ```

2. Database should be migrated and seeded with competitors

### Type Check
```bash
npm run type-check
```

### Start Bot
```bash
npm run bot:dev
```

### Manual Testing Checklist

#### Test 1: Empty Database
1. Start bot
2. Send `/ideas` command
3. **Expected:** Message "Нет новых идей" with "Запустить генерацию" button
4. Click button
5. **Expected:** Pipeline starts executing

#### Test 2: Pipeline Execution
1. Send `/run_pipeline` command
2. **Expected:** 
   - Initial message: "🚀 Запуск пайплайна..."
   - Progress updates for each stage
   - Final statistics message
   - All stages complete successfully

#### Test 3: Ideas Display
1. After successful pipeline with new ideas
2. Send `/ideas` command
3. **Expected:**
   - Each idea sent as separate message
   - Each idea has format: Title, Main Idea, Goal
   - Each idea has "Сгенерировать пост" button
   - Final message: "✅ Отправлено X идей!"

#### Test 4: Generate Post Button
1. Click "Сгенерировать пост" button under any idea
2. **Expected:** Alert: "🚧 Генерация постов в разработке..."

#### Test 5: Concurrent Pipeline Protection
1. Send `/run_pipeline` command
2. While pipeline is running, send `/run_pipeline` again
3. **Expected:** Message: "⚠️ Пайплайн уже выполняется..."

#### Test 6: Error Handling
1. Disconnect database or network
2. Send `/ideas` or `/run_pipeline`
3. **Expected:** Error message displayed, bot continues running

#### Test 7: Help Command
1. Send `/help` command
2. **Expected:** List of all commands with descriptions

---

## Error Handling

### Command-Level Errors
- All commands wrapped in try-catch blocks
- User-friendly error messages sent to Telegram
- Detailed errors logged to console
- Bot continues running after errors

### Pipeline Errors
- Each stage has error recovery
- Partial results returned on failure
- Status updates stop on error
- Telegram client always disconnected (finally block)

### Callback Query Errors
- Failed callback queries logged but don't crash bot
- User receives error feedback via answerCallbackQuery

---

## Future Enhancements

1. **Post Generation:** Implement actual post generation when "Сгенерировать пост" is clicked
2. **Idea Selection:** Allow users to mark ideas as SELECTED/REJECTED
3. **Scheduled Runs:** Cron job to run pipeline automatically (Tue/Thu at 10:00)
4. **Analytics:** Show statistics on demand
5. **Multi-language:** Support for multiple languages
6. **Pagination:** Handle more than 10 ideas in `/ideas`

---

## Troubleshooting

### Bot doesn't start
- Check `TELEGRAM_BOT_TOKEN` in environment
- Verify token is valid via BotFather
- Check console logs for errors

### Pipeline fails
- Verify `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION_STRING`
- Check database connection
- Ensure OpenAI API key is valid
- Check active competitors exist in database

### Ideas not showing
- Run pipeline first: `/run_pipeline`
- Check ideas exist with `NEW` status in database
- Verify no database connection issues

### Timeout errors
- Pipeline has 30-minute timeout
- For large datasets, may need adjustment
- Check network/API rate limits

---

## Database Schema Reference

### Idea Status Flow
```
NEW → SENT → SELECTED/REJECTED
    ↓
DUPLICATE (marked during deduplication)
```

### Related Tables
- `Idea` - Generated ideas
- `CompetitorPost` - Source posts from competitors
- `Competitor` - Competitor channels configuration
- `NataliaPost` - Natalia's posts for deduplication
- `GenerationRun` - Pipeline execution history
