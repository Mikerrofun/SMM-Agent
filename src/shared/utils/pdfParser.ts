/**
 * Утилита извлечения текста из PDF-файлов.
 *
 * Используется в боте для транскрипций встреч с клиентами:
 * Telegram document → Buffer → extractTextFromPdf() → текст для ClientTranscript.
 *
 * Библиотека: pdf-parse v2 (класс PDFParse, метод getText()).
 */

import { PDFParse } from 'pdf-parse';
import {
  EmptyPdfError,
  InsufficientContentError,
  InvalidPdfError,
  PasswordProtectedPdfError,
} from './pdfParser.errors';

/** Минимальная длина текста, с которой имеет смысл генерировать посты. */
export const MIN_PDF_TEXT_LENGTH = 100;

/**
 * Нормализует извлечённый из PDF текст.
 *
 * - заменяет неразрывные пробелы на обычные
 * - схлопывает подряд идущие пробелы/табы
 * - схлопывает 3+ переносов строки до двух (сохраняем абзацы)
 * - trim по краям
 */
export function normalizePdfText(raw: string): string {
  return raw
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Извлекает и нормализует текст из PDF.
 *
 * @param buffer — содержимое PDF файла
 * @returns нормализованный текст
 * @throws InvalidPdfError — файл повреждён или не PDF
 * @throws PasswordProtectedPdfError — PDF защищён паролем
 * @throws EmptyPdfError — в PDF нет текстового слоя
 * @throws InsufficientContentError — текста меньше MIN_PDF_TEXT_LENGTH символов
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  if (!buffer || buffer.length === 0) {
    throw new InvalidPdfError('Получен пустой файл');
  }

  let rawText: string;
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const result = await parser.getText();
    rawText = result.text ?? '';
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const name = err.name ?? '';
    const message = err.message ?? '';

    if (name === 'PasswordException' || /password/i.test(message)) {
      throw new PasswordProtectedPdfError(undefined, err);
    }

    throw new InvalidPdfError(`Не удалось прочитать PDF: ${message}`, err);
  } finally {
    await parser.destroy().catch(() => undefined);
  }

  const text = normalizePdfText(rawText);

  if (text.length === 0) {
    throw new EmptyPdfError();
  }

  if (text.length < MIN_PDF_TEXT_LENGTH) {
    throw new InsufficientContentError(
      `В PDF всего ${text.length} символов, нужно минимум ${MIN_PDF_TEXT_LENGTH}`
    );
  }

  return text;
}
