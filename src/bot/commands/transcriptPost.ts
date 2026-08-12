/**
 * Telegram-команда /transcript_post — генерация постов из транскрипции встречи.
 *
 * Флоу: /transcript_post → юзер отправляет PDF → парсинг → ClientTranscript →
 * processTranscript() → 2 поста в чат.
 */

import type { Context } from 'grammy';
import { createTranscript } from '../../repositories/clientTranscriptRepository';
import { processTranscript } from '../../services/transcript/transcriptProcessingService';
import { extractTextFromPdf } from '../../shared/utils/pdfParser';
import { PdfParserError } from '../../shared/utils/pdfParser.errors';
import { sleep } from '../../shared/utils/sleep';
import type { TranscriptPostData } from '../../shared/types/transcript.types';

/** Пользователи, от которых бот ждёт PDF. */
const waitingForPdf = new Map<number, boolean>();

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const DELAY_BETWEEN_POSTS_MS = 500;

export async function handleTranscriptCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    return;
  }

  waitingForPdf.set(userId, true);

  await ctx.reply(
    '📄 Отправь PDF файл с транскрипцией встречи с клиентом.\n\n' +
      'После обработки я сгенерирую 2 поста в стиле Натальи.'
  );
}

export async function handlePdfDocument(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId || !waitingForPdf.get(userId)) {
    return;
  }

  const document = ctx.message?.document;

  if (!document) {
    return;
  }

  const isPdf =
    document.mime_type === 'application/pdf' ||
    (document.file_name?.toLowerCase().endsWith('.pdf') ?? false);

  if (!isPdf) {
    await ctx.reply('❌ Файл должен быть в формате PDF');
    return;
  }

  if ((document.file_size ?? 0) > MAX_FILE_SIZE_BYTES) {
    await ctx.reply('❌ Файл слишком большой (max 10MB)');
    return;
  }

  let statusMessageId: number | undefined;

  try {
    const file = await ctx.api.getFile(document.file_id);

    if (!file.file_path) {
      await ctx.reply('❌ Не удалось скачать файл из Telegram');
      return;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    const response = await fetch(fileUrl);

    if (!response.ok) {
      await ctx.reply('❌ Не удалось скачать файл из Telegram');
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    let text: string;
    try {
      text = await extractTextFromPdf(buffer);
    } catch (error) {
      const message =
        error instanceof PdfParserError
          ? error.message
          : 'Не удалось извлечь текст из PDF';

      console.error('[TranscriptPost] PDF parsing failed', {
        userId,
        fileName: document.file_name,
        error: error instanceof Error ? error.message : String(error),
      });

      await ctx.reply(`❌ ${message}`);
      return;
    }

    const transcript = await createTranscript({
      text,
      fileName: document.file_name,
    });

    const statusMessage = await ctx.reply(
      '⏳ Генерирую посты... Это займет 30-60 секунд'
    );
    statusMessageId = statusMessage.message_id;

    const result = await processTranscript(transcript.id);

    if (statusMessageId && ctx.chat) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, statusMessageId);
      } catch (deleteError) {
        console.error('[TranscriptPost] Failed to delete status message:', deleteError);
      }
      statusMessageId = undefined;
    }

    if (result.posts.length === 0) {
      await ctx.reply(
        '❌ Не удалось сгенерировать посты из этой транскрипции. Попробуй еще раз.'
      );
      return;
    }

    await sendTranscriptPosts(ctx, result.posts);
  } catch (error) {
    console.error('[TranscriptPost] Processing failed', {
      userId,
      fileName: document.file_name,
      error: error instanceof Error ? error.message : String(error),
    });

    if (statusMessageId && ctx.chat) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, statusMessageId);
      } catch {
        // статус мог быть уже удалён — игнорируем
      }
    }

    try {
      await ctx.reply(
        '❌ Произошла ошибка при генерации постов. Попробуй еще раз.'
      );
    } catch (replyError) {
      console.error('[TranscriptPost] Failed to send error message:', replyError);
    }
  } finally {
    waitingForPdf.delete(userId);
  }
}

/**
 * Отправляет сгенерированные посты и итоговое сообщение.
 */
export async function sendTranscriptPosts(
  ctx: Context,
  posts: TranscriptPostData[]
): Promise<void> {
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const number = i + 1;

    const prefix = post.isDuplicate
      ? `⚠️ *Пост ${number}* (похож на существующий, similarity: ${formatSimilarity(post.similarity)})\n\n`
      : `✅ *Пост ${number}*\n\n`;

    try {
      await ctx.reply(`${prefix}${escapeMarkdown(post.text)}`, {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      console.error(`[TranscriptPost] Failed to send post ${post.id}:`, error);
    }

    if (i < posts.length - 1) {
      await sleep(DELAY_BETWEEN_POSTS_MS);
    }
  }

  const duplicates = posts.filter((post) => post.isDuplicate).length;

  let summary: string;

  if (duplicates === 0) {
    summary = `✅ Готово! Сгенерировано ${posts.length} ${pluralizePost(posts.length)} из транскрипции.`;
  } else if (duplicates < posts.length) {
    summary =
      `⚠️ Сгенерировано ${posts.length} ${pluralizePost(posts.length)}, но ${duplicates} похож на существующие.\n` +
      'Возможно, эта тема уже частично раскрыта.';
  } else {
    summary =
      '⚠️ Все посты похожи на существующие (similarity > 0.75).\n' +
      'Вероятно, инсайты из этой встречи уже использовались в контенте.';
  }

  await ctx.reply(summary);
}

function formatSimilarity(similarity?: number | null): string {
  return typeof similarity === 'number' ? similarity.toFixed(2) : 'n/a';
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+|{}])/g, '\\$1');
}

function pluralizePost(count: number): string {
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
    return 'постов';
  }

  if (lastDigit === 1) {
    return 'пост';
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return 'поста';
  }

  return 'постов';
}
