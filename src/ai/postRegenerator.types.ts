export interface RegeneratePostInput {
  currentText: string;      // Текущий текст поста (100-2500 символов)
  mainIdea: string;         // Основная идея (ОБЯЗАТЕЛЬНО сохраняется, ~200 символов)
  feedback?: string;        // Опциональный фидбек пользователя (0-1000 символов)
}
