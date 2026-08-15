/**
 * Обработчик загрузки PDF файлов для команды /transcript_post.
 */

import type { Context } from 'grammy';
import { createTranscript } from '../../../repositories/clientTranscriptRepository';
import { processTranscript } from '../../../services/transcript/transcriptProcessingService';
import { extractTextFromPdf } from '../../../shared/utils/pdfParser';
import { PdfParserError } from '../../../shared/utils/pdfParser.errors';
import { waitingForPdf } from './command';
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_LABEL } from './config';
import { finishAndShowButton } from './renderer';


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

    await finishAndShowButton(ctx, result.posts, transcript.id);
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
