const MAX_FEEDBACK_LENGTH = 1000;

export function validateFeedback(text: string): string {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    throw new Error('Фидбек не может быть пустым');
  }

  if (trimmed.length > MAX_FEEDBACK_LENGTH) {
    return trimmed.substring(0, MAX_FEEDBACK_LENGTH);
  }

  return trimmed;
}
