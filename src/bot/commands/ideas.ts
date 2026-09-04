import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getNewIdeasForSending, markIdeasAsSent } from "../../repositories/ideaRepository";
import { generatePostForIdea } from "../../services/post/postGenerationService";
import { escapeHtml } from "../utils";
import { bot } from "../index";

// Получаем список подписчиков из env
const SUBSCRIBER_CHAT_IDS = process.env.SUBSCRIBER_CHAT_IDS
  ?.split(',')
  .map(id => id.trim())
  .filter(id => id.length > 0) || [];

export async function handleIdeasCommand(ctx: Context): Promise<void> {
  try {
    const ideas = await getNewIdeasForSending(10);

    if (ideas.length === 0) {
      const keyboard = new InlineKeyboard().text(
        "🚀 Запустить генерацию",
        "run_pipeline"
      );

      await ctx.reply(
        "📭 Нет новых идей для постов.\n\n" +
        "Запустите пайплайн генерации, чтобы получить свежие идеи из каналов конкурентов.",
        { reply_markup: keyboard }
      );
      return;
    }

    const sentIdeaIds: string[] = [];
    
    // Определяем кому отправлять: если есть подписчики — всем, иначе только текущему юзеру
    const recipientIds = SUBSCRIBER_CHAT_IDS.length > 0 
      ? SUBSCRIBER_CHAT_IDS 
      : [ctx.chat!.id.toString()];

    console.log(`[IDEAS] 📤 Отправка ${ideas.length} идей для ${recipientIds.length} получателей`);

    for (const chatId of recipientIds) {
      for (const idea of ideas) {
        try {
          const keyboard = new InlineKeyboard().text(
            "✍️ Сгенерировать пост",
            `generate_post:${idea.id}`
          );

          await bot.api.sendMessage(
            chatId,
            `💡 <b>${escapeHtml(idea.title)}</b>\n\n` +
            `📝 <b>Идея:</b>\n${escapeHtml(idea.mainIdea)}\n\n` +
            `🎯 <b>Цель:</b>\n${escapeHtml(idea.goal)}`,
            {
              parse_mode: "HTML",
              reply_markup: keyboard,
            }
          );

          if (!sentIdeaIds.includes(idea.id)) {
            sentIdeaIds.push(idea.id);
          }

        } catch (error) {
          console.error(`Failed to send idea ${idea.id} to ${chatId}:`, error);
        }
      }

      try {
        await bot.api.sendMessage(
          chatId,
          `✅ Отправлено ${ideas.length} ${pluralizeIdea(ideas.length)}!`
        );
      } catch (error) {
        console.error(`Failed to send summary to ${chatId}:`, error);
      }
    }

    if (sentIdeaIds.length > 0) {
      try {
        await markIdeasAsSent(sentIdeaIds);
        console.log(`✅ Marked ${sentIdeaIds.length} ideas as SENT`);
      } catch (error) {
        console.error("Failed to mark ideas as SENT:", error);
      }
    }

  } catch (error) {
    console.error("Error in /ideas command:", error);
    
    const errorMsg = error instanceof Error && error.message.includes('does not exist')
      ? "❌ Ошибка подключения к базе данных.\nПроверьте DATABASE_URL в .env"
      : "❌ Произошла ошибка при загрузке идей. Попробуйте позже.";
    
    try {
      await ctx.reply(errorMsg);
    } catch (replyError) {
      console.error("Failed to send error message:", replyError);
    }
  }
}

export async function handleGeneratePostCallback(ctx: Context): Promise<void> {
  try {
    const callbackData = ctx.callbackQuery?.data;
    
    if (!callbackData || !callbackData.startsWith("generate_post:")) {
      await ctx.answerCallbackQuery({
        text: "❌ Неверные данные",
      });
      return;
    }

    const ideaId = callbackData.replace("generate_post:", "");
    const messageId = ctx.callbackQuery?.message?.message_id;

    await ctx.answerCallbackQuery({
      text: "⏳ Генерирую пост...",
    });

    const statusMessage = await ctx.reply("⏳ Генерирую пост, это может занять несколько секунд...");
    console.log(`Generating post for idea ${ideaId}`);

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

function pluralizeIdea(count: number): string {
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
    return "идей";
  }

  if (lastDigit === 1) {
    return "идея";
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return "идеи";
  }

  return "идей";
}
