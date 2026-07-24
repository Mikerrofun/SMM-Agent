/**
 * Проверка доступных моделей OpenAI
 * 
 * Запуск: npm run check:models
 */

import { openai } from "../core/lib/openai";

async function checkAvailableModels() {
  console.log("🔍 Проверка доступных моделей...\n");

  try {
    const models = await openai.models.list();
    
    console.log("✅ Доступные модели:\n");
    
    // Фильтруем только GPT модели
    const gptModels = models.data
      .filter(model => model.id.includes('gpt'))
      .sort((a, b) => a.id.localeCompare(b.id));
    
    if (gptModels.length === 0) {
      console.log("❌ GPT модели не найдены");
      console.log("\nВозможные причины:");
      console.log("1. Неправильный API ключ");
      console.log("2. Нет активного биллинга");
      console.log("3. Аккаунт заблокирован");
      return;
    }
    
    gptModels.forEach((model, index) => {
      console.log(`${index + 1}. ${model.id}`);
    });
    
    console.log("\n💡 Рекомендации:");
    
    if (gptModels.some(m => m.id === 'gpt-4o-mini')) {
      console.log("✅ gpt-4o-mini доступна (дешевая, хорошая для теста)");
    }
    
    if (gptModels.some(m => m.id === 'gpt-3.5-turbo')) {
      console.log("✅ gpt-3.5-turbo доступна (бесплатный tier)");
    }
    
    if (gptModels.some(m => m.id === 'gpt-4o')) {
      console.log("✅ gpt-4o доступна (мощная, дорогая)");
    }
    
  } catch (error) {
    console.error("❌ Ошибка при получении списка моделей:");
    
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
    } else {
      console.error(error);
    }
  }
}

checkAvailableModels();
