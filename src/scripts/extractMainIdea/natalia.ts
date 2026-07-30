/**
 * CLI: извлечение mainIdea для постов Натальи.
 * Запуск: npm run extract:mainidea:natalia
 */

import "dotenv/config";
import {
  getPostsWithoutMainIdea,
  updateMainIdea,
} from "../../repositories/nataliaPostRepository";
import { processBatch } from "../../services/nataliaPost/mainIdeaProcessor";
import { ProgressBar } from "../../shared/utils/progressBar";

async function main(): Promise<void> {
  console.log("\n🧠  Извлечение mainIdea — посты Натальи\n");

  const posts = await getPostsWithoutMainIdea();

  if (posts.length === 0) {
    console.log("✅ Все посты уже обработаны — нет постов без mainIdea.\n");
    return;
  }

  console.log(`📥 Найдено постов без mainIdea: ${posts.length}\n`);

  const progress = new ProgressBar();
  progress.start(posts.length);

  const started = Date.now();

  const stats = await processBatch(posts, {
    save: updateMainIdea,
    onProgress: (current) => progress.update(current),
  });

  progress.stop();

  const elapsedSec = Math.round((Date.now() - started) / 1000);

  console.log("\n📊  Статистика");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  📨 Всего постов:        ${stats.total}`);
  console.log(`  ✔️  Успешно обработано:  ${stats.succeeded}`);
  console.log(`  ❌ Ошибок:              ${stats.failed}`);
  console.log(`  ⏱️  Время:               ${elapsedSec}s`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (stats.failed > 0) {
    console.log("\n⚠️  Не удалось обработать:");
    for (const item of stats.failedItems) {
      console.log(`   • ${item.id}: ${item.error}`);
    }
    console.log("\n💡 Запустите команду повторно для оставшихся постов.");
  } else {
    console.log("\n✨ Все посты успешно обработаны!");
  }

  console.log("");
}

// Graceful shutdown: уже сохранённые посты не теряются.
process.on("SIGINT", () => {
  console.log("\n\n🛑 Прервано пользователем.");
  process.exit(0);
});

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n💥 Ошибка выполнения:", (error as Error).message);
    process.exit(1);
  });
