/**
 * Сборщик «тематической карты канала» для промпта /natalia_channel_post.
 *
 * Чистая функция: принимает список mainIdea (полученный из БД снаружи)
 * и склеивает в нумерованный список — формат avoidBlock из
 * transcriptPostGenerator.ts. Обращений к БД внутри нет.
 */

/**
 * Собирает текстовый блок «главные идеи канала» из списка mainIdea.
 *
 * @param mainIdeas — список главных идей постов канала Натальи
 * @returns нумерованный список (по строке на идею); пустая строка, если список пуст
 */
export function buildNataliaChannelContext(mainIdeas: string[]): string {
  if (mainIdeas.length === 0) {
    return '';
  }

  return mainIdeas
    .map((idea, index) => `${index + 1}. ${idea}`)
    .join('\n');
}
