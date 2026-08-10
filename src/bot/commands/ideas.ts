import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getNewIdeasForSending, markIdeasAsSent } from "../../repositories/ideaRepository";
import { generatePostForIdea } from "../../services/post/postGenerationService";

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

    for (const idea of ideas) {
      try {
        const keyboard = new InlineKeyboard().text(
          "✍️ Сгенерировать пост",
          `generate_post:${idea.id}`
        );

        await ctx.reply(
          `💡 *${escapeMarkdown(idea.title)}*\n\n` +
          `📝 *Идея:*\n${escapeMarkdown(idea.mainIdea)}\n\n` +
          `🎯 *Цель:*\n${escapeMarkdown(idea.goal)}`,
          {
            parse_mode: "Markdown",
            reply_markup: keyboard,
          }
        );

        sentIdeaIds.push(idea.id);
      } catch (error) {
        console.error(`Failed to send idea ${idea.id}:`, error);
      }
    }

    if (sentIdeaIds.length > 0) {
      try {
        await markIdeasAsSent(sentIdeaIds);
        console.log(`✅ Marked ${sentIdeaIds.length} ideas as SENT`);
      } catch (error) {
        console.error("Failed to mark ideas as SENT:", error);
      }

      await ctx.reply(
        `✅ Отправлено ${sentIdeaIds.length} ${pluralizeIdea(sentIdeaIds.length)}!`
      );
    } else if (ideas.length > 0) {
      await ctx.reply(
        `⚠️ Не удалось отправить идеи. Попробуйте позже.`
      );
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
        `❌ *Не удалось сгенерировать пост*\n\n` +
        `Ошибка: ${escapeMarkdown(result.error)}\n\n` +
        `Попробуйте ещё раз через кнопку "✍️ Сгенерировать пост"`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const keyboard = new InlineKeyboard().text(
      "🔄 Перегенерировать",
      `regenerate_post:${ideaId}`
    );

    await ctx.reply(
      `✅ *Сгенерированный пост:*\n\n${escapeMarkdown(result.postText)}`,
      {
        parse_mode: "Markdown",
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
        `❌ *Произошла ошибка при генерации поста*\n\n` +
        `${escapeMarkdown(errorMessage)}\n\n` +
        `Попробуйте ещё раз или обратитесь к администратору.`,
        { parse_mode: "Markdown" }
      );
    } catch (replyError) {
      console.error("Failed to send error message:", replyError);
    }
  }
}

export async function handleRegeneratePostCallback(ctx: Context): Promise<void> {
  try {
    const callbackData = ctx.callbackQuery?.data;
    
    if (!callbackData || !callbackData.startsWith("regenerate_post:")) {
      await ctx.answerCallbackQuery({
        text: "❌ Неверные данные",
      });
      return;
    }

    // Заглушка: функция в разработке
    await ctx.answerCallbackQuery({
      text: "🚧 Функция в разработке",
      show_alert: true,
    });

  } catch (error) {
    console.error("Error in regenerate_post callback:", error);
    
    try {
      await ctx.answerCallbackQuery({
        text: "❌ Произошла ошибка",
      });
    } catch (replyError) {
      console.error("Failed to answer callback query:", replyError);
    }
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}])/g, "\\$1");
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
