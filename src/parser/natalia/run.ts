import 'dotenv/config';
import { initializeTelegramClient, disconnectClient } from '../../shared/telegram/client';
import { parseNataliaChannel } from './parser';
import {
  TelegramAuthError,
  ChannelNotFoundError,
  NetworkError,
  ParserError,
} from './errors';

/**
 * Main entry point for Natalia's channel parser
 * 
 * Orchestrates the entire parsing process:
 * 1. Initialize Telegram client
 * 2. Parse channel with progress tracking
 * 3. Display results
 * 4. Cleanup
 */
async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  🚀  Natalia Channel Parser - @talant_director                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  let client;

  try {
    client = await initializeTelegramClient();

    console.log('\n📥 Fetching and parsing messages...\n');
    
    let lastProgressUpdate = 0;
    
    const stats = await parseNataliaChannel(client, (current, total) => {
      // Update progress every 5 messages to avoid flooding console
      if (current - lastProgressUpdate >= 5 || current === total) {
        process.stdout.write(
          `\r⏳ Обработано: ${current}/${total} сообщений`
        );
        lastProgressUpdate = current;
      }
    });

    // Clear progress line
    process.stdout.write('\r' + ' '.repeat(60) + '\r');

    // Display results
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  ✅  Парсинг завершен!                                         ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('📊 Статистика:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  📨 Всего найдено постов:     ${stats.total}`);
    console.log(`  ✔️  Сохранено новых:         ${stats.saved}`);
    console.log(`  ⏭️  Пропущено (дубли):       ${stats.skipped}`);
    
    if (stats.errors > 0) {
      console.log(`  ❌ Ошибок при обработке:     ${stats.errors}`);
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    if (stats.saved === 0 && stats.skipped > 0) {
      console.log('💡 Все посты уже были загружены ранее (инкрементальная загрузка)');
    } else if (stats.saved > 0) {
      console.log(`✨ Успешно добавлено ${stats.saved} новых постов в базу данных!`);
    }

    if (stats.errors > 0) {
      console.log(
        '\n⚠️  Некоторые сообщения не удалось обработать. Проверьте логи выше.'
      );
    }

    console.log('');

  } catch (error) {
    console.error('\n');
    console.error('╔════════════════════════════════════════════════════════════════╗');
    console.error('║  ❌  Ошибка выполнения                                         ║');
    console.error('╚════════════════════════════════════════════════════════════════╝');
    console.error('');

    if (error instanceof TelegramAuthError) {
      console.error('🔐 Ошибка авторизации:');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error(`  ${error.message}`);
      console.error('');
      console.error('💡 Проверьте:');
      console.error('  1. TELEGRAM_API_ID и TELEGRAM_API_HASH в .env файле');
      console.error('  2. Получите credentials на https://my.telegram.org/auth');
      console.error('  3. Убедитесь, что TELEGRAM_SESSION_STRING пустой при первой авторизации');
      console.error('');
      
    } else if (error instanceof ChannelNotFoundError) {
      console.error('🔍 Канал не найден:');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error(`  ${error.message}`);
      console.error('');
      console.error('💡 Возможные причины:');
      console.error('  1. Канал является приватным (нужен доступ)');
      console.error('  2. Канал был удален или заблокирован');
      console.error('  3. Неверное имя канала (проверьте @talant_director)');
      console.error('');
      
    } else if (error instanceof NetworkError) {
      console.error('🌐 Сетевая ошибка:');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error(`  ${error.message}`);
      console.error('');
      console.error('💡 Рекомендации:');
      console.error('  1. Проверьте подключение к интернету');
      console.error('  2. Убедитесь, что Telegram API доступен в вашем регионе');
      console.error('  3. Попробуйте запустить парсер позже');
      console.error('');
      
    } else if (error instanceof ParserError) {
      console.error('⚙️  Ошибка парсинга:');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error(`  ${error.message}`);
      console.error('');
      
    } else {
      console.error('❓ Неизвестная ошибка:');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error(`  ${(error as Error).message}`);
      console.error('');
      console.error('Stack trace:');
      console.error((error as Error).stack);
      console.error('');
    }

    process.exit(1);
    
  } finally {
    // Cleanup: disconnect client
    if (client) {
      await disconnectClient(client);
    }
  }
}

// Run the parser
main().catch((error) => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});
