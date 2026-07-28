import { Api } from 'telegram';

export function extractMessageText(message: Api.Message): string {
  if (!message || !message.message) {
    return '';
  }

  return message.message.trim();
}

export function extractMessageDate(message: Api.Message): Date | null {
  if (!message || !message.date) {
    return null;
  }

  return new Date(message.date * 1000);
}
