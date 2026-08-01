# Competitors Parser Documentation

## Overview

The Competitors Parser is a system for collecting posts from multiple Telegram channels of competitors and storing them in the `CompetitorPost` table with `isProcessed = false` for later analysis and idea generation.

## Features

- **Multiple Channel Support**: Parses all active competitors from the database
- **Incremental Loading**: Only fetches posts newer than the last successful `GenerationRun`
- **First Run Mode**: On first run, fetches posts from the last 2 days
- **Intelligent Error Handling**: 
  - Deactivates inaccessible channels (non-network errors)
  - Continues parsing other channels when errors occur
  - Distinguishes between network errors and access errors
- **Batching**: Saves posts in batches of 20 for database optimization
- **Deduplication**: Uses `skipDuplicates: true` based on `telegramPostUrl`
- **Detailed Statistics**: Provides comprehensive statistics per channel and overall

## Architecture

```
src/parser/competitors/
├── config.ts              # Configuration (batch size, messages per request, lookback days)
├── errors.ts              # Error types (re-exported from natalia parser)
├── channelProcessor.ts    # Single channel parsing logic
├── parser.ts              # Main orchestrator for all channels
└── run.ts                 # CLI entry point

src/repositories/
├── competitorRepository.ts           # Competitor CRUD operations
├── competitorPostRepository.ts       # CompetitorPost operations
└── generationRunRepository.ts        # GenerationRun queries

src/types/
└── competitorPost.types.ts           # TypeScript types
```

## Usage

### Running the Parser

```bash
npm run parse:competitors
```

### Prerequisites

1. **Database Setup**: Ensure the database is migrated and contains competitors
2. **Seed Competitors**: Run `npm run seed:competitors` to populate competitors
3. **Telegram Authentication**: Set up Telegram credentials in `.env`:
   - `TELEGRAM_API_ID`
   - `TELEGRAM_API_HASH`
   - `TELEGRAM_SESSION_STRING` (generated on first run)

### Configuration

Edit `src/parser/competitors/config.ts`:

```typescript
export const COMPETITORS_PARSER_CONFIG = {
  BATCH_SIZE: 20,                    // Posts per database batch
  MESSAGES_PER_REQUEST: 100,         // Messages per Telegram API request
  DEFAULT_LOOKBACK_DAYS: 2,          // Days to look back on first run
} as const;
```

## How It Works

### 1. Initialization
- Retrieves all active competitors from database (`isActive = true`)
- Determines cutoff date:
  - If last successful `GenerationRun` exists → use `finishedAt`
  - Otherwise → use current date minus `DEFAULT_LOOKBACK_DAYS`

### 2. Channel Processing
For each competitor:
- Check channel accessibility via `getChannel()`
- If inaccessible (non-network error):
  - Deactivate competitor in database
  - Log and continue to next channel
- If accessible:
  - Fetch messages in batches
  - Filter by cutoff date (incremental loading)
  - Validate messages (text only, no polls)
  - Save in batches of 20

### 3. Statistics Collection
Tracks per channel:
- Total messages fetched
- Messages saved (new)
- Messages skipped (duplicates)
- Errors encountered
- Accessibility status

Aggregates overall:
- Total channels processed
- Successful channels
- Failed channels
- Deactivated channels
- Total posts saved/skipped

### 4. Results Display
```
📊 Общая статистика:
  📡 Обработано каналов:       25
  ✅ Успешно:                  23
  ❌ С ошибками:               2
  ⚠️  Недоступны:              2
  ─────────────────────────────
  📝 Всего постов:             450
  ✔️  Сохранено новых:         380
  ⏭️  Пропущено (дубли):       70

📋 Детали по каналам:
  ✅ Успешно обработаны:
     • Максим Батырев (@Maxim_Batyrev)
       └─ 45 постов (40 новых, 5 дубли)
  ...
```

## Error Handling

### Channel Not Found / Inaccessible
When a channel cannot be accessed (non-network error):
1. Log the error
2. Deactivate the competitor (`isActive = false`)
3. Continue with next channel

### Network Errors
Transient network issues:
1. Log the error
2. Do NOT deactivate the channel
3. Continue with next channel

### Other Errors
Unexpected errors:
1. Log the error with stack trace
2. Mark channel as failed
3. Continue with next channel

## Database Schema

### Competitor
```prisma
model Competitor {
  id        String   @id @default(cuid())
  name      String
  url       String   @unique
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  
  posts CompetitorPost[]
}
```

### CompetitorPost
```prisma
model CompetitorPost {
  id              String   @id @default(cuid())
  competitorId    String
  telegramPostUrl String   @unique
  text            String
  publishedAt     DateTime
  isProcessed     Boolean  @default(false)
  createdAt       DateTime @default(now())
  
  competitor Competitor @relation(...)
  idea       Idea?
}
```

### GenerationRun
```prisma
model GenerationRun {
  id             String    @id @default(cuid())
  startedAt      DateTime  @default(now())
  finishedAt     DateTime?
  processedPosts Int       @default(0)
  generatedIdeas Int       @default(0)
  status         RunStatus @default(RUNNING)
}
```

## Comparison with Natalia Parser

| Feature | Natalia Parser | Competitors Parser |
|---------|----------------|-------------------|
| Channels | 1 (hardcoded) | Multiple (from DB) |
| Cutoff Date | `publishedAt` of last post | Last successful `GenerationRun.finishedAt` |
| Error Handling | Stop on channel error | Continue on error, deactivate inaccessible |
| Statistics | Single channel | Per-channel + aggregate |
| Use Case | Reference content | Competitor analysis |

## Future Enhancements

- [ ] Parallel channel processing for better performance
- [ ] Retry logic for network errors
- [ ] Progress bar per channel
- [ ] Configurable lookback days per competitor
- [ ] Rate limiting to avoid Telegram API throttling
- [ ] Webhook notifications on completion
- [ ] Metrics tracking (parsing duration, error rates)

## Troubleshooting

### "No active competitors found"
Run `npm run seed:competitors` to populate the database.

### "Channel not accessible" for all channels
- Check Telegram authentication credentials
- Verify network connectivity
- Ensure channels are public or you have access

### "Database connection error"
- Verify `DATABASE_URL` in `.env`
- Ensure PostgreSQL is running
- Run `npx prisma migrate dev`

### High duplicate rate
This is expected on subsequent runs due to incremental loading. Only new posts since last run are saved.

## Related Documentation

- [Data Architecture](./dataArchitecture.md) - Database schema and data flow
- [Natalia Parser](./NATALIA_PARSER.md) - Reference parser implementation
- [Vision](./vision.md) - Overall project goals and principles
