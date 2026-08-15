# Генерация постов из транскрипций встреч с клиентами

---

**Дата:** 15.08.2026  
**Теги:** #features #transcript-post #data-flow #architecture

---

## Что делает фича

Превращает PDF-транскрипцию встречи с клиентом в 2 готовых поста для Telegram-канала Натальи, которые:
- **Не повторяют** уже опубликованные посты Натальи
- **Не повторяют** друг друга
- **Не повторяют** посты из других транскрипций

**Флоу пользователя:**
```
/transcript_post → загрузка PDF → 30-60 секунд ожидания → 2 поста в чат + кнопка "Найти ещё пост"
```

Кнопка позволяет получать дополнительные посты из той же встречи бесконечно, пока есть уникальные темы.

---

## Как текут данные

### 1. От команды до PDF

```
Юзер печатает: /transcript_post
      ↓
handleTranscriptCommand(ctx)
  - ctx.from.id → userId
  - waitingForPdf.set(userId, true)  ← включаем "ждём PDF от этого юзера"
  - reply("📄 Отправь PDF...")
      ↓
Юзер загружает документ
      ↓
bot.on("message:document")
  - waitingForPdf.get(userId)? 
      нет → return (игнорируем чужие документы)
      да → идём дальше
      ↓
handlePdfDocument(ctx)
```

**Зачем `waitingForPdf`:**  
Без него бот реагировал бы на **любой** документ в чате. Map хранит `userId → true`, пока пользователь не пришлёт файл (или не случится ошибка). После обработки `waitingForPdf.delete(userId)` в `finally` — состояние сбрасывается всегда.

---

### 2. От документа до текста

```
handlePdfDocument(ctx)
  ↓
Валидация:
  - mime_type === 'application/pdf'? нет → reply("❌ Файл должен быть в формате PDF")
  - file_size <= 10MB? нет → reply("❌ Файл слишком большой")
      ↓
Скачивание:
  - ctx.api.getFile(file_id) → file_path
  - fetch(`https://api.telegram.org/file/bot${token}/${file_path}`)
  - Buffer.from(await response.arrayBuffer())
      ↓
extractTextFromPdf(buffer)
  ↓
  new PDFParse({ data: Uint8Array(buffer) })
    - getText() → rawText
    - normalizePdfText(rawText):
        1. \u00A0 → пробел
        2. \r\n → \n
        3. множественные пробелы/табы → один пробел
        4. пробелы вокруг \n → убрать
        5. 3+ переноса → 2 переноса
        6. trim()
    - length === 0? → EmptyPdfError("PDF не содержит текста")
    - length < 100? → InsufficientContentError("Слишком мало текста в PDF")
    - parser.destroy() в finally (освобождаем worker, иначе утечка памяти)
  ↓
text: string (нормализованный текст транскрипции)
```

**Почему `parser.destroy()` критичен:**  
pdf-parse v2 создаёт worker на каждый файл. Без явного освобождения worker остаётся в памяти навсегда. После 10 файлов — 10 зависших worker'ов.

---

### 3. От текста до постов (ядро системы)

```
createTranscript({ text, fileName })
  - INSERT INTO ClientTranscript → transcriptId
  - текст сохранён в БД, дальше работаем с id
      ↓
ctx.reply("⏳ Генерирую посты...") → statusMessageId
      ↓
processTranscript(transcriptId)  ← ядро генерации
```

#### Внутри `processTranscript()` — двойной цикл

**Внешний цикл:** 2 поста (`POSTS_PER_TRANSCRIPT = 2`)  
**Внутренний цикл:** до 3 попыток на пост (`MAX_ATTEMPTS_PER_POST = 3`)

**Три накопителя живут на весь прогон:**

| Переменная | Что хранит | Зачем |
|---|---|---|
| `postsToSend[]` | Посты для отправки юзеру | Результат функции |
| `usedMainIdeas[]` | Темы уже отправленных постов | Уходят в промпт LLM: "не повторяй эти темы" |
| `rejectedDraftIds[]` | id отклонённых черновиков | Исключаются из векторного поиска дедупликации |

---

#### Одна попытка генерации (шаг за шагом)

```
Попытка N для поста M:
      ↓
1. generatePostFromTranscript(text, usedMainIdeas)  ← withRetry ×3
     - prepareTranscriptText(text):
         length <= 16000? → текст целиком
         length > 16000? → первые 12000 + последние 4000 символов
     - loadPrompt("generate-post.md") → systemPrompt
     - userMessage = <untrusted_source>
                      ТРАНСКРИПЦИЯ ВСТРЕЧИ С КЛИЕНТОМ:
                      {preparedText}
                      
                      УЖЕ РАСКРЫТЫЕ ТЕМЫ (не повторяй):
                      - {usedMainIdeas[0]}
                      - {usedMainIdeas[1]}
                      ...
                      
                      ЗАДАЧА: Извлеки ключевой инсайт, создай пост.
                     </untrusted_source>
     - openai.chat.completions.create() → postText
      ↓
2. extractMainIdea(postText)  ← withRetry ×3
     - Второй вызов LLM: "выдели одно предложение — суть поста"
     - mainIdea: string (например, "Цены и ценность")
      ↓
3. createTranscriptPost({ transcriptId, text: postText, mainIdea, attemptNumber: N })
     - INSERT INTO TranscriptPost
     - status = REJECTED по умолчанию (безопасное значение)
     - embedding пока NULL
     - возвращаем post с id
      ↓
4. generateAndCheckEmbedding(mainIdea)  ← withRetry ×3
     |
     ├─ createEmbedding(mainIdea)  ← withRetry ×3
     |    - openai.embeddings.create(model: "text-embedding-3-small")
     |    - возвращаем number[1536]
     |
     └─ checkPostDuplication(embedding)  ← withRetry ×3
          |
          Promise.all([
            findSimilarNataliaPosts(embedding, threshold: 0),
            findSimilarPosts(embedding, threshold: 0)  ← исключаем rejectedDraftIds
          ])
          ↓
          resolveBestMatch([
            { source: 'natalia', matches: [...] },
            { source: 'transcript', matches: [...] }
          ])
          ↓
          { maxSimilarity, source, matchedId }
          ↓
          isDuplicate = maxSimilarity >= 0.75
      ↓
5. updateEmbedding(post.id, embedding)
     - UPDATE TranscriptPost SET embedding = '[...]'::vector
     - теперь пост участвует в векторном поиске
      ↓
6. Развилка: уникален или дубль?

   НЕ ДУБЛЬ (maxSimilarity < 0.75):
     - updateStatus(post.id, 'SENT')  ← пост принят!
     - updateSimilarity(post.id, maxSimilarity)  ← записываем для статистики
     - postToSend = post
     - usedMainIdeas.push(mainIdea)  ← следующий пост НЕ будет про эту тему
     - stats.uniquePosts++
     - break  ← выходим из цикла попыток, переходим к следующему посту
   
   ДУБЛЬ (maxSimilarity >= 0.75):
     - bestCandidate = min(similarity)  ← держим наименее похожий из плохих вариантов
     - rejectedDraftIds.push(post.id)  ← следующая попытка НЕ будет сравниваться с этим
     - continue  ← следующая попытка
```

---

#### Что происходит после 3 попыток

**Случай A: нашли уникальный пост**
```
postToSend !== null
  ↓
postsToSend.push(postToSend)
  ↓
Переходим к следующему посту (postIndex++)
```

**Случай B: все 3 попытки дали дубли**
```
postToSend === null && bestCandidate !== null
  ↓
Отдаём пост с минимальной similarity (наименее похожий из плохих)
  ↓
updateStatus(bestCandidate.post.id, 'SENT')  ← проставляем статус
updateSimilarity(bestCandidate.post.id, bestCandidate.similarity)
  ↓
rejectedDraftIds.splice(indexOf(bestCandidate.post.id), 1)
  ↑ ВАЖНО: убираем из списка отклонённых, потому что он теперь отправлен
  ↑ Следующий пост ДОЛЖЕН с ним сравниваться
  ↓
usedMainIdeas.push(bestCandidate.post.mainIdea)
stats.duplicatePosts++
postsToSend.push(bestCandidate.post)
```

**Случай C: все 3 попытки упали с ошибками**
```
postToSend === null && bestCandidate === null
  ↓
stats.failedPosts++
continue  ← пропускаем этот пост, идём к следующему
```

---

#### После обоих постов

```
postsToSend.length > 0?
  да → markAsProcessed(transcriptId, new Date())
       UPDATE ClientTranscript SET processedAt = NOW()
  нет → ничего не делаем
      ↓
return {
  transcriptId,
  requestedPosts: 2,
  posts: postsToSend,  ← 0, 1 или 2 поста
  stats: { totalAttempts, uniquePosts, duplicatePosts, failedPosts },
  errors: []
}
```

---

### 4. Как работает дедупликация

**Два источника сравнения:**
1. **NataliaPost** — уже опубликованные посты Натальи (ручные)
2. **TranscriptPost** (status = SENT) — посты из других транскрипций

**Запрос к БД:**
```sql
-- Natalia (готовый метод из репозитория)
SELECT id, (1 - (embedding <=> $embedding::vector)) AS similarity
FROM "NataliaPost"
WHERE embedding IS NOT NULL
  AND (1 - (embedding <=> $embedding::vector)) >= 0
ORDER BY similarity DESC;

-- Transcript (исключаем черновики)
SELECT id, (1 - (embedding <=> $embedding::vector)) AS similarity
FROM "TranscriptPost"
WHERE embedding IS NOT NULL
  AND status = 'SENT'  ← только отправленные посты
  AND (1 - (embedding <=> $embedding::vector)) >= 0
ORDER BY similarity DESC;
```

**Зачем фильтр `status = 'SENT'`:**  
Без него новый пост сравнивался бы со **всеми** черновиками прошлых прогонов (status = REJECTED). Чем больше обработано транскрипций, тем больше мусора в выборке → тем выше вероятность ложного дубля.

**Выбор лучшего совпадения:**
```typescript
resolveBestMatch([
  { source: 'natalia', matches: [{ id, similarity: 0.82 }, ...] },
  { source: 'transcript', matches: [{ id, similarity: 0.79 }, ...] }
])
  ↓
Перебираем источники, берём первый элемент каждого (список уже отсортирован)
Сравниваем similarity между источниками
  ↓
{ maxSimilarity: 0.82, source: 'natalia', matchedId: 'clxyz...' }
  ↓
isDuplicate = 0.82 >= 0.75  → true
```

**Почему `threshold: 0` в запросе:**  
Нам нужно точное значение максимальной similarity, даже если оно ниже 0.75. Это значение:
- Записывается в БД (`TranscriptPost.similarity`)
- Показывается юзеру в сводке
- Используется для выбора `bestCandidate` (минимальная similarity среди дублей)

---

### 5. От постов до сообщений в Telegram

```
processTranscript() вернул result
      ↓
ctx.api.deleteMessage(statusMessageId)  ← убираем "⏳ Генерирую..."
      ↓
result.posts.length === 0?
  да → reply("❌ Не удалось сгенерировать посты")
  нет → идём дальше
      ↓
finishAndShowButton(ctx, result.posts, transcriptId)
  ↓
  Цикл по posts:
    - sendSinglePost(ctx, post, номер)
        · escapeMarkdown(post.text)  ← экранируем _, *, [, ] для Markdown
        · reply("✅ *Пост N*\n\n{text}", parse_mode: 'Markdown')
    - sleep(500ms)  ← пауза между постами (rate limit Telegram)
  ↓
  Сводка:
    - "✅ Готово! Сгенерировано N {pluralizePost(N)} из транскрипции."
  ↓
  Кнопка (если posts.length > 0):
    - InlineKeyboard: "📝 Найти ещё пост"
    - callback_data: "transcript_more:{transcriptId}"
      ↓
finally:
  waitingForPdf.delete(userId)  ← всегда, даже при ошибке
```

---

### 6. Кнопка "Найти ещё пост" (бесконечная цепочка)

```
Юзер кликает кнопку
      ↓
bot.callbackQuery(/^transcript_more:/) → handleTranscriptMoreCallback(ctx)
      ↓
1. Парсим transcriptId из callback_data
      ↓
2. answerCallbackQuery("⏳ Ищу уникальную тему...")  ← убираем часики у юзера
      ↓
3. editMessageReplyMarkup({ reply_markup: undefined })
      ↑ ВАЖНО: снимаем клавиатуру СРАЗУ
      ↑ Защита от двойного клика: второй клик попадёт в сообщение без кнопки
      ↓
4. reply("⏳ Ищу уникальную тему в транскрипции...") → statusMessageId
      ↓
5. generateAdditionalPost(transcriptId)  ← новая функция
     |
     ├─ getTranscriptById(transcriptId) → transcript
     |    null? → return { success: false, error: "Транскрипция не найдена" }
     |
     ├─ getSentPosts(transcriptId)
     |    - SELECT * FROM TranscriptPost WHERE transcriptId = ? AND status = 'SENT'
     |    - возвращаем ВСЕ отправленные посты (базовые 2 + все из прошлых кликов)
     |
     ├─ usedMainIdeas = sentPosts.map(p => p.mainIdea)
     |    ↑ КЛЮЧЕВОЙ МОМЕНТ: LLM видит историю тем из БД
     |    ↑ Не повторит ни базовые 2 поста, ни посты из прошлых кликов
     |
     └─ generateSinglePost(transcript, usedMainIdeas, postIndex, stats, errors)
          ↑ ТА ЖЕ функция, что в processTranscript()
          ↑ Цикл 1..3 попытки, логика идентична
          ↓
        Три исхода:
          A. Уникальный пост найден → return { success: true, post }
          B. Все 3 попытки дубли → return { success: false, reason: 'no_unique_topics' }
          C. Ошибка → return { success: false, reason: 'error', error: message }
      ↓
6. deleteMessage(statusMessageId)
      ↓
7. Развилка по result:

   SUCCESS:
     - sendSinglePost(ctx, post, postNumber)
         · postNumber = sentPosts.length (высчитываем из БД, а не из памяти)
     - reply("✅ Найден ещё один пост!")
     - InlineKeyboard: "📝 Найти ещё пост"  ← НОВАЯ кнопка, цепочка продолжается
   
   NO_UNIQUE_TOPICS:
     - reply("💭 Больше уникальных тем не найдено. Все инсайты использованы.")
     - кнопка НЕ возвращается  ← СТОП-МЕХАНИЗМ
   
   ERROR:
     - reply("❌ Произошла ошибка: {message}\n\nПопробуй ещё раз.")
     - InlineKeyboard: "📝 Найти ещё пост"  ← кнопка возвращается, можно повторить
```

**Почему цепочка бесконечная:**  
Нет лимита на количество постов из одной транскрипции. Дедупликация — естественный лимит: когда темы кончатся, система сама скажет "больше нет". Если встреча насыщенная — получишь 5 постов, если скучная — 2.

**Почему `postNumber` из БД, а не из `callback_data`:**  
`callback_data` в Telegram ограничен 64 байтами. Один cuid ≈ 25 символов, префикс 17 → всего ≈ 42 байта. Два id не влезут. Плюс номер в кнопке устареет после первого же клика — БД всегда актуальна.

---

## Ключевые решения и их причины

### 1. Почему `bestCandidate` (дубль) отдаётся пользователю

**Альтернатива:** 3 дубля → пост не генерируется.

**Проблема:** Юзер получает "❌ ничего не вышло" вместо контента.

**Решение:** Отдаём пост с **минимальной similarity** среди дублей + пометка `⚠️ similarity: 0.79`. Пользователь сам решает, исчерпана ли тема. Это честно и практично.

**Последствие:** Пост с `status = SENT` и `isDuplicate = false` попадает в дедупликацию будущих постов. Но это правильно: если мы его отправили, значит он часть контента.

---

### 2. Почему `rejectedDraftIds` убирают `bestCandidate` при отправке

```typescript
if (postToSend === null && bestCandidate !== null) {
  postToSend = await markAsDuplicate(bestCandidate.post.id, bestCandidate.similarity);
  
  const rejectedIndex = rejectedDraftIds.indexOf(bestCandidate.post.id);
  if (rejectedIndex !== -1) {
    rejectedDraftIds.splice(rejectedIndex, 1);  // ← зачем?
  }
}
```

**Без этой строки:**
1. Пост 1 получил дубль на попытке 3, отправили `bestCandidate` (similarity 0.79)
2. `bestCandidate.post.id` остался в `rejectedDraftIds`
3. Пост 2 запускается с `excludeIds = [bestCandidate.post.id, ...]`
4. Пост 2 **не сравнивается** с постом 1
5. Пост 2 может быть про ту же тему, что пост 1

**С этой строкой:**
Пост 1 стал контентом → убираем из списка отклонённых → пост 2 сравнивается с ним → дубль будет пойман.

---

### 3. Почему `usedMainIdeas` в промпте (двухуровневая защита)

**Уровень 1 (до генерации):** Промпт содержит "УЖЕ РАСКРЫТЫЕ ТЕМЫ: - Цены и ценность - Делегирование"  
**Уровень 2 (после генерации):** Векторная проверка по embedding

**Зачем два уровня:**
- Промпт снижает вероятность дубля **заранее** → меньше потраченных попыток
- Вектор ловит дубль **гарантированно**, даже если LLM проигнорировал промпт
- Второй пост обычно проходит с первой попытки благодаря промпту

---

### 4. Почему транскрипция обрезается "начало + конец", а не "первые N символов"

**Структура встречи:**
- Начало: знакомство, постановка проблемы клиента
- Середина: детали, обсуждение, вопросы
- Конец: выводы, договорённости, итоги

**Обрезка сверху (первые 16000):** выкидывает самое ценное — итоги.  
**Обрезка "12000 + 4000":** сохраняет проблему и решение, жертвует серединой.

**Ограничение:** Середина длинной встречи не попадает в модель ни на одной попытке. Для решения нужно чанкование + суммаризация → оставлено на будущее.

---

### 5. Почему черновики пишутся в БД до проверки на дубль

**Альтернатива:** Держать попытки в памяти, сохранять только победителя.

**Проблема:** Исчезает статистика. С какой попытки получился пост? Сколько дублей отбраковано? Какие темы модель предлагает повторно?

**Решение:** Записываем **все** попытки с `attemptNumber`, `isDuplicate`, `similarity`. Цена: 6 лишних INSERT'ов на прогон (2 поста × 3 попытки, из которых 2 — черновики). Выгода: полная трассируемость.

---

### 6. Почему статус `REJECTED` по умолчанию, а не `SENT`

**Если бы `SENT` было по умолчанию:**
```typescript
const post = await createTranscriptPost({ ... });  // status = SENT

// ... генерация упала до проверки ...

// Пост остался в БД как SENT, но не прошёл дедупликацию
// Будущие посты сравниваются с мусором
```

**С `REJECTED` по умолчанию:**
```typescript
const post = await createTranscriptPost({ ... });  // status = REJECTED

// ... генерация упала ...

// Пост в БД как REJECTED → не участвует в дедупликации
// Мусор изолирован
```

Пост "поднимается" до `SENT` только после успешной проверки. Забытый апдейт даст недостающий пост (плохо), а не мусор в дедупликации (катастрофа).

---

## Точки расширения

**Что легко добавить:**
1. **Регенерация поста** — кнопка 🔄 под каждым постом (аналог `regenerate_post` для идей)
2. **Удаление поста** — кнопка 🗑 + `UPDATE status = DELETED`, исключать из дедупликации
3. **Batch-обработка** — `/transcript_batch` → загрузить несколько PDF → прогнать все подряд
4. **План тем от LLM** — на старте спросить "сколько инсайтов в транскрипции", остановиться раньше
5. **Чанкование длинных встреч** — разбить на куски, суммаризировать, склеить для промпта

**Что требует изменений архитектуры:**
1. **Редактирование отправленного поста** — нужна связь `TranscriptPost ↔ Telegram message_id`
2. **Предпросмотр до отправки** — нужен промежуточный статус `PENDING_APPROVAL`
3. **Выбор тем вручную** — UI для показа всех mainIdea до генерации

---

## Диаграмма потока данных (упрощённая)

```
┌─────────────────────┐
│ Юзер: /transcript   │
│ + PDF файл          │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ extractTextFromPdf  │──► Ошибка PDF → ❌ reply
└──────────┬──────────┘
           │ text
           ▼
┌─────────────────────┐
│ createTranscript    │──► INSERT ClientTranscript
└──────────┬──────────┘
           │ transcriptId
           ▼
┌─────────────────────────────────────────────┐
│ processTranscript (2 поста × 3 попытки)     │
│                                             │
│  ┌────────────────────────────────────┐    │
│  │ Попытка N:                         │    │
│  │  1. generatePostFromTranscript     │◄───┼─── usedMainIdeas
│  │     (LLM + промпт с темами)        │    │
│  │  2. extractMainIdea (LLM)          │    │
│  │  3. createTranscriptPost (INSERT)  │    │
│  │  4. createEmbedding (LLM)          │    │
│  │  5. checkPostDuplication:          │    │
│  │       - findSimilarNataliaPosts    │    │
│  │       - findSimilarPosts           │◄───┼─── excludeIds
│  │       - resolveBestMatch           │    │
│  │  6. isDuplicate?                   │    │
│  │       нет → updateStatus(SENT)     │────┼──► postsToSend.push()
│  │             usedMainIdeas.push()   │    │    usedMainIdeas.push()
│  │       да  → rejectedDraftIds.push()│    │
│  │             следующая попытка      │    │
│  └────────────────────────────────────┘    │
│                                             │
│  3 дубля → bestCandidate (min similarity)  │
│            updateStatus(SENT)              │──► postsToSend.push()
│            rejectedDraftIds.splice()       │
└──────────────┬──────────────────────────────┘
               │ posts[]
               ▼
┌─────────────────────┐
│ finishAndShowButton │
│  - sendSinglePost   │──► reply в Telegram
│  - сводка           │
│  - кнопка           │──► InlineKeyboard("transcript_more:{transcriptId}")
└─────────────────────┘
```

---

## Кнопка "Найти ещё пост" — бесконечная цепочка

```
┌─────────────────────┐
│ Клик на кнопку      │
└──────────┬──────────┘
           │ transcriptId из callback_data
           ▼
┌────────────────────────────────────┐
│ handleTranscriptMoreCallback       │
│  1. answerCallbackQuery            │
│  2. editMessageReplyMarkup(none)   │◄─── защита от двойного клика
└──────────┬─────────────────────────┘
           │
           ▼
┌────────────────────────────────────┐
│ generateAdditionalPost             │
│  - getTranscriptById               │
│  - getSentPosts (ВСЕ SENT из БД)   │──► usedMainIdeas = [...mainIdea]
│  - generateSinglePost (1..3 попытки│     (включая базовые 2 + прошлые клики)
└──────────┬─────────────────────────┘
           │
           ▼
      ┌────┴────┐
      │ Успех?  │
      └────┬────┘
           │
    ┌──────┼──────┐
    │      │      │
    да     нет    ошибка
    │      │      │
    ▼      ▼      ▼
 ┌────┐ ┌────┐ ┌────┐
 │reply│ │reply│ │reply│
 │+пост│ │"нет"│ │error│
 │+btn │ │     │ │+btn │
 └────┘ └────┘ └────┘
   │             │
   │             │
   └──────┬──────┘
          │
          ▼
    Юзер может кликнуть снова
    (если кнопка вернулась)
```

**Стоп-механизм:** "Больше тем не найдено" → кнопка не возвращается → цепочка обрывается.

---

## Конфигурация (критичные параметры)

| Параметр | Значение | Что регулирует |
|---|---|---|
| `POSTS_PER_TRANSCRIPT` | 2 | Сколько постов генерируется за один прогон |
| `MAX_ATTEMPTS_PER_POST` | 3 | Сколько попыток на один пост, если дубль |
| `SIMILARITY_THRESHOLD` | 0.75 | Порог дубля (0..1, чем выше — тем строже) |
| `TRANSCRIPT_MAX_INPUT_LENGTH` | 16000 | Лимит символов для LLM |
| `TRANSCRIPT_HEAD_LENGTH` | 12000 | Сколько символов с начала при обрезке |
| `TRANSCRIPT_TAIL_LENGTH` | 4000 | Сколько символов с конца при обрезке |
| `AI_RETRY_CONFIG.maxAttempts` | 3 | Ретраи на каждый вызов LLM |
| `MIN_PDF_TEXT_LENGTH` | 100 | Минимум символов в PDF (иначе ошибка) |

**Худший случай по вызовам LLM:**
```
2 поста × 3 попытки × (1 генерация + 1 mainIdea + 1 embedding) × 3 ретрая = 54 запроса
```

Реально меньше: уникальный пост проходит с первой попытки, ретраи срабатывают только при сбое сети/API.

---

## Преимущества архитектуры

✅ **Переиспользование:** `openai`, `withRetry`, `loadPrompt`, `createEmbedding`, `extractMainIdea`, `findSimilarNataliaPosts` — всё из существующего кода  
✅ **Двухуровневая защита от дублей:** промпт (до генерации) + вектор (после)  
✅ **Единый порог 0.75** с флоу генерации идей → поведение предсказуемо  
✅ **Полная трассируемость:** каждый черновик в БД с `attemptNumber`, `similarity`, `source`  
✅ **Отказоустойчивость:** `withRetry` на каждом AI-вызове, ошибка попытки не рушит прогон  
✅ **Чистота БД:** `onDelete: Cascade` → удаление транскрипции чистит её посты  
✅ **Безопасность:** `<untrusted_source>` в промпте, `status = REJECTED` по умолчанию  
✅ **Бесконечная генерация:** кнопка позволяет получить 3, 4, 5... N постов из одной встречи  
✅ **Естественный лимит:** дедупликация сама останавливает, когда темы исчерпаны


Раньше единственным источником контента были посты конкурентов: парсер собирал их, `ideaExtractor` вытаскивал идею, `postGenerator` писал пост в стиле Натальи. Но самый ценный материал — не чужие посты, а реальные встречи с клиентами: там живые боли, формулировки и возражения, которых нет ни у одного конкурента.

Транскрипции встреч уже существовали, но лежали в виде PDF-файлов и в контент не превращались — их читали вручную и вручную же придумывали посты. Нужен был путь `PDF → 2 готовых поста в Telegram`, при котором посты не повторяют ни уже опубликованные посты Натальи, ни друг друга.

## 2. Где/что уже было

Фича почти целиком собрана из существующих кусков:

```ts
// src/core/lib/openai.ts
export const openai = new OpenAI({ apiKey });
export const DEFAULT_MODEL = "gpt-4o-mini";

// src/shared/utils/retry.ts
export async function withRetry<T>(fn: () => Promise<T>, config: RetryConfig): Promise<T>

// src/shared/utils/promptLoader.ts
export function loadPrompt(filename: string): string

// src/ai/embeddings.ts
export async function createEmbedding(text: string): Promise<number[]>

// src/ai/mainIdeaExtractor.ts
export async function extractMainIdea(postText: string): Promise<string>
```

Переиспользуется и вся механика дедупликации из генерации идей:

```ts
// src/services/idea/deduplication.config.ts
export const SIMILARITY_THRESHOLD = 0.75;
export const DEDUPLICATION_RETRY_CONFIG: RetryConfig = { ... };

// src/repositories/nataliaPostRepository.ts
export async function findSimilarNataliaPosts(embedding: number[], threshold: number)

// src/services/idea/deduplication.types.ts
export interface SimilarityMatch { id: string; similarity: number }
```

Промпт тоже не новый — `TRANSCRIPT_PROMPT_PATH` указывает на тот же `src/prompts/generate-post.md`, что использует `postGenerator.ts`. Стиль Натальи от источника не зависит.

Новое здесь только четыре вещи: парсинг PDF, две таблицы в БД, оркестратор попыток и общий `similarityResolver`.

Модели в `prisma/schema.prisma`:

```prisma
model ClientTranscript {
  id          String    @id @default(cuid())
  text        String
  fileName    String?
  uploadedAt  DateTime  @default(now())
  processedAt DateTime?
  posts       TranscriptPost[]
}

model TranscriptPost {
  id            String   @id @default(cuid())
  transcriptId  String
  text          String
  mainIdea      String
  embedding     Unsupported("vector(1536)")?
  similarity    Float?
  isDuplicate   Boolean  @default(false)
  attemptNumber Int      @default(1)
  createdAt     DateTime @default(now())
  transcript    ClientTranscript @relation(fields: [transcriptId], references: [id], onDelete: Cascade)
}
```

## 3. Карта файлов

| Файл | Роль |
|---|---|
| `bot/commands/transcriptPost.ts` | Команда, приём документа, отправка результата |
| `bot/commands/transcriptPost.config.ts` | Лимиты Telegram-слоя: размер файла, пауза между постами |
| `shared/utils/pdfParser.ts` | `Buffer → текст`, нормализация, минимальная длина |
| `shared/utils/pdfParser.errors.ts` | 4 класса ошибок PDF под `PdfParserError` |
| `shared/types/transcript.types.ts` | `ClientTranscriptData`, `TranscriptPostData`, input-типы |
| `repositories/clientTranscriptRepository.ts` | CRUD транскрипции (Prisma) |
| `repositories/transcriptPostRepository.ts` | CRUD постов + векторные запросы (raw SQL) |
| `ai/transcriptPostGenerator.ts` | Промпт → LLM → текст поста |
| `ai/transcriptPostGenerator.config.ts` | Модель, температура, лимиты входного текста |
| `services/transcript/transcriptProcessingService.ts` | Оркестратор: 2 поста × 3 попытки |
| `services/transcript/deduplicationService.ts` | embedding + проверка по двум источникам |
| `services/transcript/transcript.config.ts` | `POSTS_PER_TRANSCRIPT`, `MAX_ATTEMPTS_PER_POST` |
| `services/transcript/errors.ts` | `TranscriptNotFoundError`, `DeduplicationError` |
| `services/shared/similarityResolver.ts` | Общий выбор лучшего совпадения (используют оба флоу) |

## 4. Реализация

### PDF парсер

```ts
// src/shared/utils/pdfParser.ts
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  if (!buffer || buffer.length === 0) throw new InvalidPdfError('Получен пустой файл');

  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const result = await parser.getText();
    rawText = result.text ?? '';
  } catch (error) {
    if (name === 'PasswordException' || /password/i.test(message)) {
      throw new PasswordProtectedPdfError(undefined, err);
    }
    throw new InvalidPdfError(`Не удалось прочитать PDF: ${message}`, err);
  } finally {
    await parser.destroy().catch(() => undefined);   // освобождаем worker
  }

  const text = normalizePdfText(rawText);

  if (text.length === 0) throw new EmptyPdfError();
  if (text.length < MIN_PDF_TEXT_LENGTH) throw new InsufficientContentError(...);

  return text;
}
```

`normalizePdfText()` работает в 6 замен по порядку: `\u00A0 → пробел`, `\r\n → \n`, схлопывание пробелов/табов, обрезка пробелов вокруг переносов, `3+ переноса → 2`, `trim()`. Абзацы сохраняются, мусор PDF-вёрстки уходит.

`parser.destroy()` стоит в `finally` — pdf-parse v2 держит worker, без явного освобождения он утекает при каждом файле.

### AI модуль

```ts
// src/ai/transcriptPostGenerator.ts
export function prepareTranscriptText(text: string): string {
  if (text.length <= TRANSCRIPT_MAX_INPUT_LENGTH) {
    return text;                       // короткая транскрипция идёт целиком
  }

  const head = text.slice(0, TRANSCRIPT_HEAD_LENGTH);
  const tail = text.slice(-TRANSCRIPT_TAIL_LENGTH);

  return `${head}\n\n[...фрагмент транскрипции пропущен...]\n\n${tail}`;
}

export async function generatePostFromTranscript(
  transcriptText: string,
  excludeMainIdeas: string[] = []
): Promise<string> {
  const trimmed = transcriptText?.trim() ?? '';
  if (trimmed.length === 0) throw new Error('Cannot generate post from empty transcript');

  const preparedText = prepareTranscriptText(trimmed);
  const systemPrompt = loadPrompt(TRANSCRIPT_PROMPT_PATH);

  const avoidBlock = excludeMainIdeas.length > 0
    ? `\nУЖЕ РАСКРЫТЫЕ ТЕМЫ (не повторяй их, выбери другой инсайт):\n${...}\n`
    : '';

  const userMessage = `<untrusted_source>
ТРАНСКРИПЦИЯ ВСТРЕЧИ С КЛИЕНТОМ:

${preparedText}
${avoidBlock}
ЗАДАЧА:
Извлеки из транскрипции ключевой инсайт или проблему клиента.
Создай пост для Telegram-канала Натальи, раскрывающий эту тему.
</untrusted_source>`;

  const response = await openai.chat.completions.create({ ... });
  const content = response.choices[0]?.message?.content?.trim() ?? '';

  if (content.length === 0) throw new Error('LLM returned empty post text');
  return content;
}
```

Функция называется `prepareTranscriptText`, а не `truncate*`, именно потому что обрезка условная: транскрипция короче лимита возвращается символ в символ.

Retry внутри модуля нет — им управляет сервис, чтобы политика повторов была в одном месте.

### Repository

`clientTranscriptRepository.ts` — обычный Prisma без вектора: `createTranscript`, `getTranscriptById`, `markAsProcessed`.

`transcriptPostRepository.ts` — четыре функции, две из них через raw SQL:

```ts
// запись вектора: Prisma не умеет тип vector
export async function updateEmbedding(id: string, embedding: number[]): Promise<void> {
  const vectorLiteral = `[${embedding.join(',')}]`;
  await prisma.$executeRaw`
    UPDATE "TranscriptPost"
    SET embedding = ${vectorLiteral}::vector
    WHERE id = ${id}
  `;
}

// косинусное расстояние pgvector: 1 - (a <=> b) = cosine similarity
export async function findSimilarPosts(
  embedding: number[],
  threshold: number,
  excludeIds: string[] = []
): Promise<SimilarityMatch[]> {
  const rows = excludeIds.length > 0
    ? await prisma.$queryRaw`
        SELECT id, (1 - (embedding <=> ${vectorLiteral}::vector)) AS similarity
        FROM "TranscriptPost"
        WHERE embedding IS NOT NULL
          AND id != ALL(${excludeIds}::text[])
          AND (1 - (embedding <=> ${vectorLiteral}::vector)) >= ${threshold}
        ORDER BY similarity DESC
      `
    : await prisma.$queryRaw`... без фильтра по id ...`;

  return rows.map((row) => ({ id: row.id, similarity: Number(row.similarity) }));
}
```

Запрос разветвлён на два варианта не ради красоты: `id != ALL('{}'::text[])` на пустом массиве ведёт себя неочевидно, а держать в SQL заведомо бесполезное условие незачем.

Обновление similarity разнесено на две функции, потому что это два разных события:

```ts
markAsDuplicate(id, similarity)  // similarity + isDuplicate = true, возвращает запись
updateSimilarity(id, similarity) // только similarity, пост остаётся уникальным
```

### Deduplication service

```ts
// src/services/transcript/deduplicationService.ts
export async function checkPostDuplication(
  embedding: number[],
  excludePostIds: string[] = []
): Promise<DuplicationResult> {
  const [nataliaMatches, transcriptMatches] = await Promise.all([
    findSimilarNataliaPosts(embedding, 0),          // threshold 0 — нужен сам максимум
    findSimilarPosts(embedding, 0, excludePostIds),
  ]);

  const { maxSimilarity, source, matchedId } = resolveBestMatch([
    { source: 'natalia' as const, matches: nataliaMatches },
    { source: 'transcript' as const, matches: transcriptMatches },
  ]);

  const isDuplicate = maxSimilarity >= SIMILARITY_THRESHOLD;

  return {
    isDuplicate,
    maxSimilarity,
    source: isDuplicate ? source : null,      // источник осмыслен только для дубля
    matchedId: isDuplicate ? matchedId : null,
  };
}
```

`threshold = 0` передаётся намеренно: нам нужна не «есть ли что-то выше 0.75», а точное значение максимума — оно уходит в БД и в текст сообщения даже для уникального поста.

`generateAndCheckEmbedding()` оборачивает `createEmbedding` и `checkPostDuplication` каждый в свой `withRetry`, а любую ошибку переупаковывает в `DeduplicationError`, чтобы вызывающий код отличал сбой дедупликации от сбоя генерации.

### Общий resolver

Выбор лучшего совпадения был одинаковым в `services/idea` и `services/transcript`, поэтому вынесен:

```ts
// src/services/shared/similarityResolver.ts
// matches отсортированы по similarity DESC, поэтому сравниваем первый элемент
export function resolveBestMatch<TSource extends string>(
  sources: Array<SimilaritySource<TSource>>
): ResolvedSimilarity<TSource> {
  let maxSimilarity = 0;
  let source: TSource | null = null;
  let matchedId: string | null = null;

  for (const candidate of sources) {
    const best = candidate.matches[0];

    if (best && best.similarity > maxSimilarity) {
      maxSimilarity = best.similarity;
      source = candidate.source;
      matchedId = best.id;
    }
  }

  return { maxSimilarity, source, matchedId };
}
```

Generic по `TSource` — у флоу идей источники `'idea' | 'nataliaPost'`, у транскрипций `'natalia' | 'transcript'`, литеральные типы сохраняются на выходе. Сравнение строгое `>`, поэтому при равной similarity выигрывает источник, идущий раньше в массиве.

### Processing service

Двойной цикл: посты снаружи, попытки внутри.

```ts
// src/services/transcript/transcriptProcessingService.ts
const postsToSend: TranscriptPostData[] = [];
const usedMainIdeas: string[] = [];

// отклонённые черновики остаются в БД с embedding'ом — исключаем их из дедупликации
const rejectedDraftIds: string[] = [];

for (let postIndex = 1; postIndex <= POSTS_PER_TRANSCRIPT; postIndex++) {
  let postToSend: TranscriptPostData | null = null;
  let bestCandidate: AttemptCandidate | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_POST; attempt++) {
    stats.totalAttempts++;

    try {
      const postText = await withRetry(
        () => generatePostFromTranscript(transcript.text, usedMainIdeas),
        AI_RETRY_CONFIG
      );
      const mainIdea = await withRetry(() => extractMainIdea(postText), AI_RETRY_CONFIG);

      const post = await createTranscriptPost({
        transcriptId, text: postText, mainIdea, attemptNumber: attempt,
      });

      const dedupResult = await generateAndCheckEmbedding(mainIdea, [
        ...rejectedDraftIds,
        post.id,
      ]);

      await updateEmbedding(post.id, dedupResult.embedding);

      if (!dedupResult.isDuplicate) {
        if (dedupResult.maxSimilarity > 0) {
          await updateSimilarity(post.id, dedupResult.maxSimilarity);
        }
        postToSend = { ...post, similarity: dedupResult.maxSimilarity };
        usedMainIdeas.push(mainIdea);
        stats.uniquePosts++;
        break;
      }

      // дубль: держим попытку с минимальной similarity как fallback
      if (bestCandidate === null || dedupResult.maxSimilarity < bestCandidate.similarity) {
        bestCandidate = { post, similarity: dedupResult.maxSimilarity };
      }

      rejectedDraftIds.push(post.id);
    } catch (error) {
      errors.push(`post ${postIndex}, attempt ${attempt}: ${message}`);
    }
  }

  if (postToSend === null && bestCandidate !== null) {
    postToSend = await markAsDuplicate(bestCandidate.post.id, bestCandidate.similarity);

    // пост уходит пользователю — следующий должен с ним сравниваться
    const rejectedIndex = rejectedDraftIds.indexOf(bestCandidate.post.id);
    if (rejectedIndex !== -1) rejectedDraftIds.splice(rejectedIndex, 1);

    usedMainIdeas.push(bestCandidate.post.mainIdea);
    stats.duplicatePosts++;
  }

  if (postToSend === null) { stats.failedPosts++; continue; }

  postsToSend.push(postToSend);
}

if (postsToSend.length > 0) {
  await markAsProcessed(transcriptId, new Date());
}
```

Три накопителя живут **на весь прогон**, а не на итерацию поста, и это принципиально:

| Накопитель | Что копит | Зачем |
|---|---|---|
| `postsToSend` | Посты для отправки | Результат функции |
| `usedMainIdeas` | Темы отправленных постов | Уходит в промпт следующего поста |
| `rejectedDraftIds` | id отклонённых черновиков | Исключается из векторного поиска |

`bestCandidate` и `postToSend`, наоборот, обнуляются на каждом `postIndex` — они про конкретный пост.

Особый момент: когда дубль всё-таки уходит пользователю через `bestCandidate`, его id **удаляется** из `rejectedDraftIds`. Он перестал быть браком и стал контентом, поэтому следующий пост обязан с ним сравниваться.

## 5. Поток данных

Полный путь от команды до сообщений в чате.

```
Юзер: /transcript_post
  │
  ├─ handleTranscriptCommand(ctx)
  │    waitingForPdf.set(userId, true)
  │    ctx.reply('📄 Отправь PDF файл...')
  ▼
Юзер отправляет документ
  │
  ├─ bot.on("message:document") → handlePdfDocument(ctx)
  │    │
  │    ├─ waitingForPdf.get(userId)? → нет: return (чужой документ игнорируем)
  │    ├─ mime_type === 'application/pdf' || file_name.endsWith('.pdf')? → нет: ❌ reply
  │    ├─ file_size <= MAX_FILE_SIZE_BYTES? → нет: ❌ reply
  │    │
  │    ├─ ctx.api.getFile(file_id) → file_path
  │    ├─ fetch(https://api.telegram.org/file/bot<token>/<file_path>)
  │    └─ Buffer.from(await response.arrayBuffer())
  ▼
extractTextFromPdf(buffer)
  │    new PDFParse({ data }) → getText() → normalizePdfText()
  │    length === 0        → EmptyPdfError
  │    length < 100        → InsufficientContentError
  │    parser.destroy()    ← finally, всегда
  ▼
createTranscript({ text, fileName }) → INSERT ClientTranscript → id
  │
  ├─ ctx.reply('⏳ Генерирую посты...') → statusMessageId
  ▼
processTranscript(transcriptId)
  │
  ├─ getTranscriptById() → null? → TranscriptNotFoundError
  │
  ├─ postIndex = 1..POSTS_PER_TRANSCRIPT (2)
  │   │
  │   └─ attempt = 1..MAX_ATTEMPTS_PER_POST (3)
  │       │
  │       ├─ generatePostFromTranscript(text, usedMainIdeas)      withRetry ×3
  │       │    prepareTranscriptText() → 16000? → 12000 + 4000
  │       │    loadPrompt(generate-post.md) + <untrusted_source>
  │       │    openai.chat.completions.create() → postText
  │       │
  │       ├─ extractMainIdea(postText)                            withRetry ×3
  │       │
  │       ├─ createTranscriptPost({ ..., attemptNumber })          INSERT (черновик,
  │       │                                                        embedding = NULL)
  │       ├─ generateAndCheckEmbedding(mainIdea, [...rejectedDraftIds, post.id])
  │       │    │
  │       │    ├─ createEmbedding(mainIdea) → number[1536]         withRetry ×3
  │       │    │
  │       │    └─ checkPostDuplication(embedding, excludeIds)      withRetry ×3
  │       │         Promise.all([
  │       │           findSimilarNataliaPosts(embedding, 0),
  │       │           findSimilarPosts(embedding, 0, excludeIds),
  │       │         ])
  │       │         resolveBestMatch(...) → { maxSimilarity, source, matchedId }
  │       │         isDuplicate = maxSimilarity >= 0.75
  │       │
  │       ├─ updateEmbedding(post.id, embedding)                   UPDATE ::vector
  │       │
  │       ├─ НЕ дубль → updateSimilarity() → postToSend
  │       │              usedMainIdeas.push(mainIdea) → break
  │       │
  │       └─ дубль    → bestCandidate = min(similarity)
  │                     rejectedDraftIds.push(post.id) → следующая попытка
  │
  ├─ все 3 попытки дубли → markAsDuplicate(bestCandidate)
  │                        rejectedDraftIds.splice(индекс этого поста)
  │                        usedMainIdeas.push(его mainIdea)
  │
  └─ postsToSend.length > 0 → markAsProcessed(transcriptId, new Date())
  ▼
ctx.api.deleteMessage(statusMessageId)
  │
  ├─ result.posts.length === 0 → ❌ 'Не удалось сгенерировать посты'
  ▼
sendTranscriptPosts(ctx, posts)
     escapeMarkdown(post.text) → ctx.reply(parse_mode: 'Markdown')
     sleep(DELAY_BETWEEN_POSTS_MS) между постами
     сводка по количеству дублей
  ▼
finally: waitingForPdf.delete(userId)
```

### Пример прогона: пост №2 упёрся в дубли

Что происходит с `rejectedDraftIds` и `usedMainIdeas` по шагам.

| Шаг | Событие | similarity | `rejectedDraftIds` | `usedMainIdeas` |
|---|---|---|---|---|
| Пост 1, попытка 1 | уникален | 0.41 | `[]` | `['цены']` |
| Пост 2, попытка 1 | дубль (natalia) | 0.88 | `[p2a1]` | `['цены']` |
| Пост 2, попытка 2 | дубль (transcript → пост 1) | 0.79 | `[p2a1, p2a2]` | `['цены']` |
| Пост 2, попытка 3 | дубль (natalia) | 0.83 | `[p2a1, p2a2, p2a3]` | `['цены']` |
| Пост 2, финал | `bestCandidate = p2a2` (0.79) | 0.79 | `[p2a1, p2a3]` | `['цены', 'делегирование']` |

В БД остаются все 4 черновика: `p1a1` уникальный, `p2a2` с `isDuplicate = true`, `p2a1` и `p2a3` как отбракованные попытки. Пользователь получает `p1a1` и `p2a2`.

Ключевое: на попытке 2 поста №2 в `excludeIds` попал `p2a1` — иначе пост сравнивался бы со собственной провалившейся попыткой и почти гарантированно получил бы завышенный similarity.

### Конфигурация

| Константа | Значение | Файл |
|---|---|---|
| `POSTS_PER_TRANSCRIPT` | 2 | `services/transcript/transcript.config.ts` |
| `MAX_ATTEMPTS_PER_POST` | 3 | `services/transcript/transcript.config.ts` |
| `AI_RETRY_CONFIG` | 3 попытки, 1000ms, ×2 | `services/transcript/transcript.config.ts` |
| `SIMILARITY_THRESHOLD` | 0.75 | `services/idea/deduplication.config.ts` |
| `TRANSCRIPT_MAX_INPUT_LENGTH` | 16000 | `ai/transcriptPostGenerator.config.ts` |
| `TRANSCRIPT_HEAD_LENGTH` | 12000 | `ai/transcriptPostGenerator.config.ts` |
| `TRANSCRIPT_TAIL_LENGTH` | 4000 | `ai/transcriptPostGenerator.config.ts` |
| `TRANSCRIPT_MAX_TOKENS` | 2000 | `ai/transcriptPostGenerator.config.ts` |
| `TRANSCRIPT_TEMPERATURE` | 0.7 | `ai/transcriptPostGenerator.config.ts` |
| `MIN_PDF_TEXT_LENGTH` | 100 | `shared/utils/pdfParser.ts` |
| `MAX_FILE_SIZE_BYTES` | 10MB | `bot/commands/transcriptPost.config.ts` |
| `DELAY_BETWEEN_POSTS_MS` | 500 | `bot/commands/transcriptPost.config.ts` |

Худший случай по вызовам LLM: `2 поста × 3 попытки × (1 генерация + 1 mainIdea + 1 embedding)` = 18 запросов, каждый с тремя ретраями при сбое.

## 6. UI

```
Юзер: /transcript_post
Бот:  📄 Отправь PDF файл с транскрипцией встречи с клиентом.
      После обработки я сгенерирую 2 поста в стиле Натальи.

Юзер: [meeting-2026-08-14.pdf]
Бот:  ⏳ Генерирую посты... Это займет 30-60 секунд     ← удаляется по завершении

Бот:  ✅ *Пост 1*
      [текст поста]

Бот:  ⚠️ *Пост 2* (похож на существующий, similarity: 0.79)
      [текст поста]

Бот:  ⚠️ Сгенерировано 2 поста, но 1 похож на существующие.
      Возможно, эта тема уже частично раскрыта.
```

Сводка зависит от числа дублей: `0` → `✅ Готово!`, часть → предупреждение, все → `⚠️ Все посты похожи на существующие (similarity > 0.75)`. Счётчик постов проходит через `pluralizePost()` — «1 пост / 2 поста / 5 постов».

Текст прогоняется через `escapeMarkdown()`, иначе `_` или `*` из поста ломают `parse_mode: 'Markdown'`. Отправка каждого поста в своём `try/catch`: упавшее сообщение не отменяет остальные.

### Обработка ошибок по слоям

| Слой | Что ловит | Что видит юзер |
|---|---|---|
| Валидация | не PDF, > 10MB | `❌ Файл должен быть в формате PDF` |
| Telegram | нет `file_path`, `!response.ok` | `❌ Не удалось скачать файл из Telegram` |
| `PdfParserError` | пароль, нет текста, < 100 символов | текст самой ошибки |
| Попытка генерации | сбой LLM/embedding | ничего, копится в `errors[]` |
| Пост целиком | все попытки упали | пост пропускается, `failedPosts++` |
| Прогон | `result.posts.length === 0` | `❌ Не удалось сгенерировать посты` |
| Внешний `catch` | всё остальное | `❌ Произошла ошибка при генерации постов` |

Статусное сообщение удаляется в обеих ветках — и при успехе, и в `catch`. `waitingForPdf.delete(userId)` стоит в `finally`, поэтому пользователь не остаётся в подвешенном состоянии после любой ошибки.

## 7. Почему так, а не иначе

1. **Транскрипция сохраняется в БД до генерации.** PDF парсится один раз, дальше работаем с `ClientTranscript.id`. Если генерация упала, текст не потерян — можно перезапустить `processTranscript(transcriptId)` без повторной загрузки файла.

2. **`bot.on("message:document")` вместо conversation.** Grammy-conversations пришлось бы тащить как зависимость и хранить состояние диалога. Здесь состояние — один `Map<userId, boolean>`, который живёт до первого документа и чистится в `finally`. Сторонний документ просто игнорируется.

3. **Черновики пишутся в БД до проверки на дубль.** Альтернатива — держать попытки в памяти и сохранять только победителя. Но тогда исчезает статистика: с какой попытки получился пост, сколько дублей отбраковано, какие темы модель предлагает повторно. `attemptNumber` + `isDuplicate` дают эти данные бесплатно.

4. **`rejectedDraftIds` копится на весь прогон, а не на один пост.** Отклонённый черновик остаётся в БД с посчитанным `embedding`, то есть участвует в векторном поиске. Если сбрасывать список на каждом `postIndex`, пост №2 начнёт сравниваться с браком от поста №1 и получит завышенный similarity — вплоть до ложной пометки «дубль». Сам `post.id` добавляется в `excludeIds` отдельно: без этого пост находил бы себя с similarity = 1.0.

5. **`usedMainIdeas` в промпте.** Векторная проверка ловит дубль *после* генерации — это потраченный вызов LLM. Передача уже раскрытых тем в промпт снижает вероятность дубля заранее, поэтому второй пост обычно проходит с первой попытки.

6. **Дубль отдаётся пользователю, а не отбрасывается.** После 3 попыток лучше показать пост с честной пометкой `⚠️ similarity: 0.79`, чем `❌ ничего не вышло`. Человек сам решит, исчерпана ли тема. Выбирается кандидат с **минимальной** similarity — наименее похожий из плохих вариантов, и это сравнение почти бесплатно, similarity уже посчитана.

7. **`markAsDuplicate` и `updateSimilarity` — разные функции.** Уникальному посту нужно записать similarity, но не ставить флаг. Один метод с булевым параметром читался бы хуже, а `markAsDuplicate` ещё и возвращает обновлённую запись, которая сразу уходит в `postsToSend`.

8. **Порог 0.75 переиспользован, а не задан свой.** Смысл дедупликации одинаковый: не повторять то, что уже написано. Два независимых порога рано или поздно разъехались бы, и одна тема считалась бы дублем в одном флоу и уникальной в другом.

9. **`resolveBestMatch` вынесен, а сервисы не объединены.** Общая у двух флоу только выборка максимума. Всё остальное различается: idea-версия батчевая и сама пишет в БД, transcript-версия проверяет один вектор и сама считает embedding. Универсальный сервис потребовал бы флагов `mode` и `entity` с ветвлением на каждом шаге — сложнее двух отдельных файлов.

10. **Промпт `generate-post.md` общий с `postGenerator.ts`.** Стиль Натальи не зависит от источника контента. Адаптация под транскрипцию сделана user-message-ом (`ЗАДАЧА: извлеки ключевой инсайт...`), поэтому стиль правится в одном файле.

11. **Обрезка «начало + конец», а не первые 16000 символов.** Во встрече начало — знакомство и постановка проблемы, конец — выводы и договорённости. Простая обрезка сверху выкинула бы самое ценное. Ограничение подхода: середина длинной встречи не попадает в модель ни на одной из попыток.

12. **`<untrusted_source>` вокруг транскрипции.** Транскрипция — внешний текст, в него может попасть что угодно, включая фразы, похожие на инструкции. Тег фиксирует границу данных, как в `postGenerator.ts`.

## Преимущества

- ✅ Новый источник контента без нового пайплайна — переиспользованы `openai`, `withRetry`, `promptLoader`, `createEmbedding`, `extractMainIdea`, `findSimilarNataliaPosts`
- ✅ Дедупликация сразу по двум источникам (`NataliaPost` + `TranscriptPost`) одним `Promise.all`
- ✅ Двухуровневая защита от повторов: темы в промпте (до генерации) + вектор (после)
- ✅ Единый порог 0.75 и общий `resolveBestMatch` с флоу генерации идей — поведение предсказуемо
- ✅ Полная трассируемость: `attemptNumber`, `similarity`, `isDuplicate`, `source` по каждому черновику
- ✅ Отказоустойчивость: `withRetry` на каждом AI-вызове, ошибка попытки не рушит прогон, `errors[]` в результате
- ✅ Понятные ошибки в Telegram вместо стектрейсов — отдельный класс под каждый случай PDF
- ✅ Prompt injection закрыт через `<untrusted_source>`
- ✅ `onDelete: Cascade` — удаление транскрипции чистит её посты, сирот в БД не остаётся
- ✅ Конфигурация разнесена по слоям: лимиты Telegram, параметры LLM и параметры генерации правятся независимо
