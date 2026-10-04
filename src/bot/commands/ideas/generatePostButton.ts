/**
 * Хендлер кнопки «✍️ Сгенерировать пост» под карточкой идеи.
 */

import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { generatePostForIdea } from '../../../services/post/postGenerationService';
import { escapeHtml } from '../../utils';
import { commandManager } from '../../../shared/utils/CommandManager/CommandManager';
import { CommandCancelledError } from '../../../shared/utils/CommandManager/CommandManager.errors';
import { INVALID_CALLBACK_TEXT } from './config';

const CALLBACK_PREFIX = 'generate_post:';

export async function handleGeneratePostCallback(ctx: Context): Promise<void> {
  const callbackData = ctx.callbackQuery?.data;

  if (!callbackData || !callbackData.startsWith(CALLBACK_PREFIX)) {
    await ctx.answerCallbackQuery({
      text: INVALID_CALLBACK_TEXT,
    });
    return;
  }

  const ideaId = callbackData.replace(CALLBACK_PREFIX, '');
  const messageId = ctx.callbackQuery?.message?.message_id;

  await ctx.answerCallbackQuery({
    text: "⏳ Генерирую пост...",
  });

  console.log(`Generating post for idea ${ideaId}`);

  await commandManager.execute(
    ctx,
    "generate_post",
    {
      // Статус-сообщение с кнопкой отмены отправляет execute
      statusText: "⏳ Генерирую пост, это может занять несколько секунд...",
    },
    async (_ctx, { statusMessage }) => {
      try {
        // Генерируем пост
        const result = await generatePostForIdea(ideaId);

        try {
          await ctx.api.deleteMessage(ctx.chat!.id, statusMessage.message_id);
        } catch (deleteError) {
          console.error("Failed to delete status message:", deleteError);
        }

        if (!result.success) {
          await ctx.reply(
            `❌ <b>Не удалось сгенерировать пост</b>\n\n` +
            `Ошибка: ${escapeHtml(result.error)}\n\n` +
            `Попробуйте ещё раз через кнопку "✍️ Сгенерировать пост"`,
            { parse_mode: "HTML" }
          );
          return;
        }

        const keyboard = new InlineKeyboard()
          .text("🔄 Перегенерировать", `regenerate_idea_post:${result.postId}`)
          .text("✏️ С уточнением", `regenerate_idea_post_feedback:${result.postId}`);

        await ctx.reply(
          `✅ <b>Сгенерированный пост:</b>\n\n${result.postText}`,
          {
            parse_mode: "HTML",
            reply_markup: keyboard,
            ...(messageId && { reply_to_message_id: messageId }),
          }
        );

        console.log(`✅ Successfully generated post for idea ${ideaId}`);
      } catch (error) {
        // Отмену обрабатывает execute — прокидываем дальше
        if (error instanceof CommandCancelledError) {
          throw error;
        }

        console.error("Error in generate_post callback:", error);

        const errorMessage = error instanceof Error
          ? error.message
          : "Неизвестная ошибка";

        try {
          await ctx.reply(
            `❌ <b>Произошла ошибка при генерации поста</b>\n\n` +
            `${escapeHtml(errorMessage)}\n\n` +
            `Попробуйте ещё раз или обратитесь к администратору.`,
            { parse_mode: "HTML" }
          );
        } catch (replyError) {
          console.error("Failed to send error message:", replyError);
        }
      }
    }
  );
}
