import { Api } from 'telegram';

export function isTextMessage(message: Api.Message): boolean {
  if (!message || !message.message) {
    return false;
  }

  const text = message.message.trim();
  if (text.length === 0) {
    return false;
  }

  // Фильтруем опросы
  if (message.poll) {
    return false;
  }

  return true;
}

export function isValidDate(message: Api.Message, cutoffDate: Date): boolean {
  if (!message || !message.date) {
    return false;
  }

  const messageDate = new Date(message.date * 1000);
  return messageDate >= cutoffDate;
}

export function validateMessageData(
  message: Api.Message,
  cutoffDate: Date
): boolean {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (!isTextMessage(message)) {
    return false;
  }

  if (!isValidDate(message, cutoffDate)) {
    return false;
  }

  if (!message.id) {
    return false;
  }

  return true;
}
