/**
 * Обработчик загрузки PDF файлов для команды /transcript_post.
 */

import type { Context } from 'grammy';
import { createTranscript } from '../../../repositories/clientTranscriptRepository';
import { processTranscript } from '../../../services/transcript/transcriptProcessingService';
import { extractTextFromPdf } from '../../../shared/utils/pdfParser';
import { PdfParserError } from '../../../shared/utils/pdfParser.errors';
import { commandManager, checkCancelled } from '../../../shared/utils/CommandManager/CommandManager';
import { CommandCancelledError } from '../../../shared/utils/CommandManager/CommandManager.errors';
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

  try {
    await commandManager.execute(
      ctx,
      'transcript_post_pdf',
      {
        statusText: '⏳ Обрабатываю PDF...',
        // Команда сама удаляет статус-сообщение перед выводом постов
      },
      async (_ctx, { statusMessage }) => {
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

          // createTranscript — запись «сырого материала»: отмена возможна
          // только до неё, после — до старта генерации постов
          checkCancelled();

          const transcript = await createTranscript({
            text,
            fileName: document.file_name,
          });

          try {
            await ctx.api.editMessageText(
              ctx.chat!.id,
              statusMessage.message_id,
              '⏳ Генерирую посты... Это займет 30-60 секунд'
            );
          } catch (editError) {
            console.error('[TranscriptPost] Failed to update status message:', editError);
          }

          const result = await processTranscript(transcript.id);

          if (ctx.chat) {
            try {
              await ctx.api.deleteMessage(ctx.chat.id, statusMessage.message_id);
            } catch (deleteError) {
              console.error('[TranscriptPost] Failed to delete status message:', deleteError);
            }
          }

          if (result.posts.length === 0) {
            await ctx.reply(
              '❌ Не удалось сгенерировать посты из этой транскрипции. Попробуй еще раз.'
            );
            return;
          }

          await finishAndShowButton(ctx, result.posts, transcript.id);
        } catch (error) {
          // Отмену обрабатывает execute — прокидываем дальше
          if (error instanceof CommandCancelledError) {
            throw error;
          }

          console.error('[TranscriptPost] Processing failed', {
            userId,
            fileName: document.file_name,
            error: error instanceof Error ? error.message : String(error),
          });

          try {
            await ctx.reply(
              '❌ Произошла ошибка при генерации постов. Попробуй еще раз.'
            );
          } catch (replyError) {
            console.error(
              '[TranscriptPost] Failed to send error message:',
              replyError
            );
          }
        }
      }
    );
  } finally {
    waitingForPdf.delete(userId);
  }
}
