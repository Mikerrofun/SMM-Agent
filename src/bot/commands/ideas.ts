import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getNewIdeasForSending, markIdeasAsSent } from "../../repositories/ideaRepository";

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
    }

    if (sentIdeaIds.length > 0) {
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
    try {
      await ctx.reply(
        "❌ Произошла ошибка при загрузке идей. Попробуйте позже."
      );
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

    await ctx.answerCallbackQuery({
      text: "🚧 Генерация постов в разработке. Скоро будет доступна!",
      show_alert: true,
    });

    console.log(`User requested post generation for idea ${ideaId}`);

  } catch (error) {
    console.error("Error in generate_post callback:", error);
    try {
      await ctx.answerCallbackQuery({
        text: "❌ Произошла ошибка",
      });
    } catch (answerError) {
      console.error("Failed to answer callback query:", answerError);
    }
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
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
