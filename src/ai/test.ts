/**
 * Тестовый скрипт для проверки подключения OpenAI
 * 
 * Запуск: npm run test:ai
 */

import { openai, DEFAULT_MODEL } from "../core/lib/openai";

async function testOpenAI() {
  console.log("🤖 Тестирование подключения к OpenAI...\n");
  console.log(`📦 Модель: ${DEFAULT_MODEL}\n`);

  try {
    const response = await openai.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: "system",
          content: "Ты помощник для SMM-специалиста. Отвечай кратко и по делу.",
        },
        {
          role: "user",
          content: "Придумай одну идею для поста в Telegram-канале про маркетинг.",
        },
      ],
      max_tokens: 200,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content;

    console.log("✅ Подключение успешно!\n");
    console.log("📝 Ответ от AI:");
    console.log("─".repeat(60));
    console.log(content);
    console.log("─".repeat(60));
    console.log("\n💰 Использовано токенов:");
    console.log(`   Входных: ${response.usage?.prompt_tokens}`);
    console.log(`   Выходных: ${response.usage?.completion_tokens}`);
    console.log(`   Всего: ${response.usage?.total_tokens}`);
    
    // Примерная стоимость (gpt-4o-mini: $0.15/1M input, $0.60/1M output)
    const inputCost = ((response.usage?.prompt_tokens || 0) / 1_000_000) * 0.15;
    const outputCost = ((response.usage?.completion_tokens || 0) / 1_000_000) * 0.60;
    const totalCost = inputCost + outputCost;
    
    console.log(`\n💵 Стоимость запроса: ~$${totalCost.toFixed(6)}`);
    
  } catch (error) {
    console.error("❌ Ошибка при подключении к OpenAI:");
    
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
    } else {
      console.error(error);
    }
    
    console.log("\n🔍 Проверь:");
    console.log("   1. OPENAI_API_KEY в .env.local");
    console.log("   2. Баланс на аккаунте OpenAI");
    console.log("   3. Интернет-соединение");
    
    process.exit(1);
  }
}

testOpenAI();
