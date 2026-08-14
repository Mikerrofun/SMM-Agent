/**
 * Telegram-команда /transcript_post — генерация постов из транскрипции встречи.
 *
 * Флоу: /transcript_post → юзер отправляет PDF → парсинг → ClientTranscript →
 * processTranscript() → 2 поста в чат + кнопка "Найти ещё пост".
 */

import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { createTranscript } from '../../repositories/clientTranscriptRepository';
import {
  processTranscript,
  generateAdditionalPost,
} from '../../services/transcript/transcriptProcessingService';
import { extractTextFromPdf } from '../../shared/utils/pdfParser';
import { PdfParserError } from '../../shared/utils/pdfParser.errors';
import { sleep } from '../../shared/utils/sleep';
import type { TranscriptPostData } from '../../shared/types/transcript.types';
import {
  DELAY_BETWEEN_POSTS_MS,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
} from './transcriptPost.config';

const waitingForPdf = new Map<number, boolean>();

const CALLBACK_PREFIX = 'transcript_more:';

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
    await ctx.reply(`❌ Файл слишком большой (max ${MAX_FILE_SIZE_LABEL})`);
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

    await sendTranscriptPosts(ctx, result.posts, transcript.id);
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
 * Отправляет один пост в чат.
 */
async function sendSinglePost(
  ctx: Context,
  post: TranscriptPostData,
  postNumber: number
): Promise<void> {
  try {
    await ctx.reply(`✅ *Пост ${postNumber}*\n\n${escapeMarkdown(post.text)}`, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    console.error(`[TranscriptPost] Failed to send post ${post.id}:`, error);
    throw error;
  }
}

export async function sendTranscriptPosts(
  ctx: Context,
  posts: TranscriptPostData[],
  transcriptId: string
): Promise<void> {
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const number = i + 1;

    try {
      await sendSinglePost(ctx, post, number);
    } catch (error) {
      console.error(`[TranscriptPost] Failed to send post ${post.id}:`, error);
    }

    if (i < posts.length - 1) {
      await sleep(DELAY_BETWEEN_POSTS_MS);
    }
  }

  const summary = `✅ Готово! Сгенерировано ${posts.length} ${pluralizePost(posts.length)} из транскрипции.`;

  if (posts.length > 0) {
    const keyboard = new InlineKeyboard().text(
      '📝 Найти ещё пост',
      `${CALLBACK_PREFIX}${transcriptId}`
    );

    await ctx.reply(summary, { reply_markup: keyboard });
  } else {
    await ctx.reply(summary);
  }
}


export async function handleTranscriptMoreCallback(
  ctx: Context
): Promise<void> {
  try {
    const callbackData = ctx.callbackQuery?.data;

    if (!callbackData || !callbackData.startsWith(CALLBACK_PREFIX)) {
      await ctx.answerCallbackQuery({
        text: '❌ Неверные данные',
      });
      return;
    }

    const transcriptId = callbackData.replace(CALLBACK_PREFIX, '');

    await ctx.answerCallbackQuery({
      text: '⏳ Ищу уникальную тему...',
    });

    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch (error) {
      console.error('[TranscriptPost] Failed to remove keyboard:', error);
    }

    const statusMessage = await ctx.reply('⏳ Ищу уникальную тему в транскрипции...');

    const result = await generateAdditionalPost(transcriptId);

    try {
      await ctx.api.deleteMessage(ctx.chat!.id, statusMessage.message_id);
    } catch (deleteError) {
      console.error('[TranscriptPost] Failed to delete status message:', deleteError);
    }

    if (!result.success) {
      if (result.reason === 'no_unique_topics') {
        await ctx.reply(
          '💭 Больше уникальных тем в этой встрече не найдено.\n\n' +
            'Все инсайты из транскрипции уже использованы.'
        );
      } else {
        const keyboard = new InlineKeyboard().text(
          '📝 Найти ещё пост',
          `${CALLBACK_PREFIX}${transcriptId}`
        );

        await ctx.reply(
          `❌ Произошла ошибка: ${result.error ?? 'Неизвестная ошибка'}\n\n` +
            'Попробуй ещё раз.',
          { reply_markup: keyboard }
        );
      }
      return;
    }

    const sentPosts = await import('../../repositories/transcriptPostRepository')
      .then((m) => m.getSentPosts(transcriptId));
    const postNumber = sentPosts.length;

    await sendSinglePost(ctx, result.post!, postNumber);

    const keyboard = new InlineKeyboard().text(
      '📝 Найти ещё пост',
      `${CALLBACK_PREFIX}${transcriptId}`
    );

    await ctx.reply(
      `✅ Найден ещё один пост из этой встречи!`,
      { reply_markup: keyboard }
    );

    console.log('[TranscriptPost] Additional post sent', {
      transcriptId,
      postId: result.post!.id,
    });
  } catch (error) {
    console.error('[TranscriptPost] Callback handler failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    try {
      await ctx.reply(
        '❌ Произошла ошибка при генерации поста. Попробуй позже.'
      );
    } catch (replyError) {
      console.error('[TranscriptPost] Failed to send error message:', replyError);
    }
  }
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
