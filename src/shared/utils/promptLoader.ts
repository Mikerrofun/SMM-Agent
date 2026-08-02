import { readFileSync } from 'fs';

const promptCache = new Map<string, string>();

/**
 * Загружает промпт из файла с кэшированием.
 * 
 * При первом вызове читает файл с диска и сохраняет в памяти.
 * Последующие вызовы возвращают закэшированное значение.
 * 
 * @param path — абсолютный путь к файлу промпта
 * @returns содержимое промпта
 * @throws если файл не найден или не читается
 */

export function loadPrompt(path: string): string {
  const cached = promptCache.get(path);
  
  if (cached !== undefined) {
    return cached;
  }
  
  const content = readFileSync(path, 'utf-8');
  promptCache.set(path, content);
  
  return content;
}

export function clearPromptCache(): void {
  promptCache.clear();
}
