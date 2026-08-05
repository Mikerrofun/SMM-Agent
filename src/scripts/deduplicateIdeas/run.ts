/**
 * CLI: дедупликация идей через векторный поиск.
 * Запуск: npm run deduplicate:ideas
 */

import 'dotenv/config';
import { deduplicateIdeas } from '../../services/idea/deduplicationService';
import { ProgressBar } from '../../shared/utils/progressBar';

async function main(): Promise<void> {
  console.log('\n🔍 Дедупликация идей через векторный поиск\n');

  const progress = new ProgressBar();
  const started = Date.now();

  const stats = await deduplicateIdeas({
    onProgress: (current, total) => {
      if (current === 1) {
        progress.start(total);
      }
      progress.update(current);
    },
  });

  progress.stop();

  const elapsedSec = Math.round((Date.now() - started) / 1000);


  console.log('\n📊 Статистика');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Всего проверено:         ${stats.total}`);
  console.log(`💎 Уникальных (NEW):        ${stats.unique}`);
  console.log(`❌ Дубликатов:              ${stats.duplicates}`);
  console.log(`   ├─ с идеями:             ${stats.duplicatesWithIdeas}`);
  console.log(`   └─ с постами Натальи:    ${stats.duplicatesWithNataliaPosts}`);
  console.log(`⚠️  Ошибок:                 ${stats.failed}`);
  console.log(`⏱️  Время:                  ${elapsedSec}s`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (stats.failed > 0) {
    console.log('\n⚠️  Не удалось обработать:');
    for (const item of stats.failedItems) {
      console.log(`   • ${item.id}: ${item.error}`);
    }
    console.log('\n💡 Запустите команду повторно для оставшихся идей.');
  }

  // ──────────────────────────────────────────────────────
  // Финальное сообщение
  // ──────────────────────────────────────────────────────
  if (stats.total === 0) {
    console.log('\n✨ Нет NEW идей для проверки.');
  } else if (stats.duplicates === 0 && stats.failed === 0) {
    console.log('\n✨ Все идеи уникальны!');
  } else {
    console.log('\n✅ Дедупликация завершена.');
  }

  console.log('');
}

// ──────────────────────────────────────────────────────
// Graceful shutdown
// ──────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n\n🛑 Прервано пользователем.');
  console.log('ℹ️  Все обработанные идеи уже сохранены в БД.');
  process.exit(0);
});

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n💥 Ошибка выполнения:', (error as Error).message);
    console.error(error);
    process.exit(1);
  });
