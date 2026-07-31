/**
 * CLI: генерация embeddings для постов Натальи.
 * 
 * Два режима обработки:
 * 1. Посты без mainIdea → извлекает mainIdea + генерирует embedding
 * 2. Посты с mainIdea, но без embedding → только генерирует embedding
 * 
 * Запуск: npm run generate:embeddings:natalia
 */

import "dotenv/config";
import { extractMainIdea } from "../../ai/mainIdeaExtractor";
import {
  getPostsWithoutMainIdea,
  getPostsWithoutEmbedding,
  updateMainIdeaAndEmbedding,
  updateEmbedding,
} from "../../repositories/nataliaPostRepository";
import { processEmbeddingsBatch } from "../../services/nataliaPost/embeddingProcessor";
import { ProgressBar } from "../../shared/utils/progressBar";

async function main(): Promise<void> {
  console.log("\n🧠  Генерация embeddings — посты Натальи\n");

  // ─────────────────────────────────────────────────────────────
  // Режим 1: посты без mainIdea (сначала извлекаем mainIdea, потом embedding)
  // ─────────────────────────────────────────────────────────────

  const postsWithoutMainIdea = await getPostsWithoutMainIdea();
  console.log(`📥 Найдено постов без mainIdea: ${postsWithoutMainIdea.length}`);

  if (postsWithoutMainIdea.length > 0) {
    console.log("\n🔄 Режим 1: Извлечение mainIdea + генерация embedding\n");

    const progress1 = new ProgressBar();
    const started1 = Date.now();

    console.log("📝 Шаг 1/2: Извлечение mainIdea из текстов постов...\n");

    // В режиме 1 нужно:
    // 1. Извлечь mainIdea из текста
    // 2. Создать embedding из mainIdea
    // 3. Сохранить оба поля атомарно
    const items1 = [];
    for (const post of postsWithoutMainIdea) {
      try {
        const mainIdea = await extractMainIdea(post.text);
        items1.push({ id: post.id, text: mainIdea });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ Ошибка извлечения mainIdea для ${post.id}: ${message}`);
      }
    }

    console.log(`\n✓ Извлечено ${items1.length} mainIdea из ${postsWithoutMainIdea.length} постов\n`);

    if (items1.length === 0) {
      console.log("⚠️  Не удалось извлечь ни одной mainIdea, пропускаем режим 1.\n");
    } else {
      console.log("📝 Шаг 2/2: Генерация embeddings...\n");

      progress1.start(items1.length);

      // Создаём Map для сохранения mainIdea
      const mainIdeasMap = new Map(
        items1.map((item) => [item.id, item.text])
      );

      const stats1 = await processEmbeddingsBatch({
        items: items1,
        saveEmbedding: async (id, embedding) => {
          const mainIdea = mainIdeasMap.get(id);
          if (!mainIdea) {
            throw new Error(`MainIdea for ${id} not found in map`);
          }

          // Сохраняем оба поля атомарно
          await updateMainIdeaAndEmbedding(id, mainIdea, embedding);
        },
        onProgress: (processed) => progress1.update(processed),
      });

      progress1.stop();

      const elapsed1Sec = Math.round((Date.now() - started1) / 1000);

      console.log("\n📊  Статистика (режим 1: mainIdea + embedding)");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`  📨 Всего постов:        ${stats1.total}`);
      console.log(`  ✔️  Успешно обработано:  ${stats1.succeeded}`);
      console.log(`  ❌ Ошибок:              ${stats1.failed}`);
      console.log(`  ⏱️  Время:               ${elapsed1Sec}s`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      if (stats1.failed > 0) {
        console.log("\n⚠️  Не удалось обработать:");
        for (const item of stats1.failedItems) {
          console.log(`   • ${item.id}: ${item.error}`);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Режим 2: посты с mainIdea, но без embedding
  // ─────────────────────────────────────────────────────────────

  const postsWithoutEmbedding = await getPostsWithoutEmbedding();
  console.log(`\n📥 Найдено постов без embedding: ${postsWithoutEmbedding.length}`);

  if (postsWithoutEmbedding.length > 0) {
    console.log("\n🔄 Режим 2: Генерация embedding (mainIdea уже есть)\n");

    const progress2 = new ProgressBar();
    progress2.start(postsWithoutEmbedding.length);

    const started2 = Date.now();

    const stats2 = await processEmbeddingsBatch({
      items: postsWithoutEmbedding.map((p) => ({
        id: p.id,
        text: p.mainIdea, // Используем готовую mainIdea
      })),
      saveEmbedding: updateEmbedding,
      onProgress: (processed) => progress2.update(processed),
    });

    progress2.stop();

    const elapsed2Sec = Math.round((Date.now() - started2) / 1000);

    console.log("\n📊  Статистика (режим 2: только embedding)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  📨 Всего постов:        ${stats2.total}`);
    console.log(`  ✔️  Успешно обработано:  ${stats2.succeeded}`);
    console.log(`  ❌ Ошибок:              ${stats2.failed}`);
    console.log(`  ⏱️  Время:               ${elapsed2Sec}s`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (stats2.failed > 0) {
      console.log("\n⚠️  Не удалось обработать:");
      for (const item of stats2.failedItems) {
        console.log(`   • ${item.id}: ${item.error}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Итог
  // ─────────────────────────────────────────────────────────────

  if (postsWithoutMainIdea.length === 0 && postsWithoutEmbedding.length === 0) {
    console.log("\n✅ Все посты уже обработаны — нет постов без embeddings.\n");
  } else {
    console.log("\n✨ Генерация embeddings завершена!");
    console.log("\n💡 Запустите команду повторно для обработки оставшихся постов (если были ошибки).\n");
  }
}

// Graceful shutdown: уже сохранённые embeddings не теряются.
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
