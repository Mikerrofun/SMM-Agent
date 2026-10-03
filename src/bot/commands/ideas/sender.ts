/**
 * Отправка порции идей всем получателям (подписчики + инициатор).
 *
 * Порция помечается SENT после рассылки — повторный выбор той же категории
 * отдаёт пустую порцию.
 */

import type { Api } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { IdeaModel } from '../../../db/generated/models/Idea';
import { markIdeasAsSent } from '../../../repositories/ideaRepository';
import {
  resolveRecipientChatIds,
  sendMessageToChats,
} from '../../../shared/telegram/subscribers';
import { sleep } from '../../../shared/utils/sleep';
import type { IdeasBatchResult } from './ideas.types';
import { DELAY_BETWEEN_IDEAS_MS } from './config';
import { formatBatchSummary, formatIdeaCard } from './utils';

const GENERATE_POST_CALLBACK_PREFIX = 'generate_post:';
const GENERATE_POST_BUTTON_TEXT = '✍️ Сгенерировать пост';

function buildGeneratePostKeyboard(ideaId: string): InlineKeyboard {
  return new InlineKeyboard().text(
    GENERATE_POST_BUTTON_TEXT,
    `${GENERATE_POST_CALLBACK_PREFIX}${ideaId}`
  );
}

/**
 * Рассылает порцию идей и помечает их как SENT.
 *
 * @param api - Telegram API (ctx.api)
 * @param ideas - порция идей
 * @param initiatorChatId - чат инициатора, которому тоже нужно показать идеи
 * @returns счётчики отправки
 */
export async function sendIdeasBatch(
  api: Api,
  ideas: IdeaModel[],
  initiatorChatId: string
): Promise<IdeasBatchResult> {
  const recipients = resolveRecipientChatIds({ initiatorChatId });

  console.log(
    `[Ideas] 📤 Отправка ${ideas.length} идей для ${recipients.length} получателей`
  );

  const sentIdeaIds: string[] = [];
  let failedIdeas = 0;
  let summarySent = 0;

  for (const chatId of recipients) {
    let firstInChat = true;

    for (const idea of ideas) {
      // Пауза между отправками, чтобы не упереться в rate limit Telegram
      if (!firstInChat) {
        await sleep(DELAY_BETWEEN_IDEAS_MS);
      }
      firstInChat = false;

      try {
        await api.sendMessage(chatId, formatIdeaCard(idea), {
          parse_mode: 'HTML',
          reply_markup: buildGeneratePostKeyboard(idea.id),
        });

        if (!sentIdeaIds.includes(idea.id)) {
          sentIdeaIds.push(idea.id);
        }
      } catch (error) {
        failedIdeas++;
        console.error(
          `[Ideas] ❌ Не удалось отправить идею ${idea.id} в ${chatId}:`,
          error
        );
      }
    }

    await sleep(DELAY_BETWEEN_IDEAS_MS);

    const { sent } = await sendMessageToChats(
      api,
      [chatId],
      formatBatchSummary(ideas.length)
    );
    summarySent += sent;
  }

  if (sentIdeaIds.length > 0) {
    try {
      const marked = await markIdeasAsSent(sentIdeaIds);
      console.log(`[Ideas] ✅ Marked ${marked} ideas as SENT`);
    } catch (error) {
      console.error('[Ideas] Failed to mark ideas as SENT:', error);
    }
  }

  return {
    sentIdeas: sentIdeaIds.length,
    failedIdeas,
    recipients: recipients.length,
    summarySent,
  };
}
