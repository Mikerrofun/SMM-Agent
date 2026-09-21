/**
 * Валидирует callback_data для Telegram Inline Keyboard кнопок.
 * 
 * Telegram требует, чтобы callback_data был:
 * - Не пустым
 * - От 1 до 64 байт в UTF-8 кодировке
 * 
 * @param data - callback_data для валидации
 * @param label - текст кнопки (для логирования)
 * @param logPrefix - префикс для логов (опционально)
 * @throws {Error} если callback_data пустой или превышает 64 байта
 * @returns валидный callback_data
 */
export function validateCallbackData(
  data: string,
  label: string,
  logPrefix = '[CallbackValidator]'
): string {
  if (!data || data.length === 0) {
    throw new Error(`${logPrefix} Empty callback_data for button: ${label}`);
  }

  const byteLength = Buffer.byteLength(data, 'utf8');

  if (byteLength > 64) {
    console.error(`${logPrefix} callback_data too long for "${label}":`, {
      data,
      byteLength,
      maxAllowed: 64,
    });
    throw new Error(
      `callback_data exceeds 64 bytes: ${byteLength} bytes for "${label}"`
    );
  }

  console.log(`${logPrefix} Validated callback_data for "${label}":`, {
    data,
    byteLength,
  });

  return data;
}
