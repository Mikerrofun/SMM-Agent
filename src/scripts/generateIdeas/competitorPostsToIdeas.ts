/**
 * CLI: генерация идей из постов конкурентов.
 * Запуск: npm run generate:ideas:competitors
 *
 * Обрабатывает необработанные посты конкурентов (isProcessed = false),
 * генерирует структурированные идеи через GPT-4o, сохраняет в БД.
 * Можно запускать повторно — обрабатывает только новые посты.
 */

import 'dotenv/config';
import { getUnprocessedCompetitorPosts } from '../../repositories/ideaRepository';
import { processIdeaBatch } from '../../services/idea/ideaProcessor';
import { ProgressBar } from '../../shared/utils/progressBar';

async function main(): Promise<void> {
  console.log('\n💡 Генерация идей из постов конкурентов\n');

  const posts = await getUnprocessedCompetitorPosts();

  if (posts.length === 0) {
    console.log('✅ Все посты уже обработаны — нет постов без идей.\n');
    return;
  }

  console.log(`📥 Найдено постов для обработки: ${posts.length}\n`);

  const progress = new ProgressBar();
  progress.start(posts.length);

  const started = Date.now();

  const stats = await processIdeaBatch({
    items: posts,
    onProgress: (current) => progress.update(current),
  });

  progress.stop();

  const elapsedSec = Math.round((Date.now() - started) / 1000);

  console.log('\n📊 Статистика');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📨 Всего постов:        ${stats.total}`);
  console.log(`✔️  Успешно обработано:  ${stats.succeeded}`);
  console.log(`❌ Ошибок:              ${stats.failed}`);
  console.log(`⏱️  Время:               ${elapsedSec}s`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (stats.failed > 0) {
    console.log('\n⚠️  Не удалось обработать:');
    for (const item of stats.failedItems) {
      console.log(`   • ${item.id}: ${item.error}`);
    }
    console.log('\n💡 Запустите команду повторно для оставшихся постов.');
  } else {
    console.log('\n✨ Все посты успешно обработаны!');
  }

  console.log('');
}

process.on('SIGINT', () => {
  console.log('\n\n🛑 Прервано пользователем.');
  process.exit(0);
});

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n💥 Ошибка выполнения:', (error as Error).message);
    process.exit(1);
  });
