/**
 * Утилиты для работы с транскрипт-постами.
 */

export function pluralizePost(count: number): string {
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
    return 'постов';
  }

  if (lastDigit === 1) {
    return 'пост';
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return 'поста';
  }

  return 'постов';
}
