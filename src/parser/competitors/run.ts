import 'dotenv/config';
import { initializeTelegramClient, disconnectClient } from '../../shared/telegram/client';
import { parseCompetitorsChannels } from './parser';
import {
  TelegramAuthError,
  ChannelNotFoundError,
  NetworkError,
  ParserError,
} from './errors';

/**
 * Main entry point for competitors channels parser
 * 
 * Orchestrates the entire parsing process:
 * 1. Initialize Telegram client
 * 2. Parse all active competitor channels
 * 3. Display detailed results
 * 4. Cleanup
 */
async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  🚀  Competitors Channels Parser                               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  let client;

  try {
    client = await initializeTelegramClient();

    console.log('\n📥 Fetching and parsing competitor channels...\n');
    
    const stats = await parseCompetitorsChannels(client, (channelName, current, total) => {
      // Optional: можно добавить progress bar для каждого канала
      // Пока используем простое логирование в channelProcessor
    });

    // Display overall results
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  ✅  Парсинг завершен!                                         ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('📊 Общая статистика:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  📡 Обработано каналов:       ${stats.totalChannels}`);
    console.log(`  ✅ Успешно:                  ${stats.successfulChannels}`);
    console.log(`  ❌ С ошибками:               ${stats.failedChannels}`);
    
    if (stats.deactivatedChannels > 0) {
      console.log(`  ⚠️  Недоступны (деактивированы): ${stats.deactivatedChannels}`);
    }
    
    console.log('  ─────────────────────────────────────────────────────────────');
    console.log(`  📝 Всего постов:             ${stats.totalPosts}`);
    console.log(`  ✔️  Сохранено новых:         ${stats.savedPosts}`);
    console.log(`  ⏭️  Пропущено (дубли):       ${stats.skippedPosts}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    // Display details per channel
    if (stats.channels.length > 0) {
      console.log('📋 Детали по каналам:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Group channels by status
      const successful = stats.channels.filter(c => c.isAccessible && c.errors === 0);
      const deactivated = stats.channels.filter(c => !c.isAccessible);
      const withErrors = stats.channels.filter(c => c.isAccessible && c.errors > 0);
      
      // Successful channels
      if (successful.length > 0) {
        console.log('\n  ✅ Успешно обработаны:');
        successful.forEach(channel => {
          const newPosts = channel.saved;
          const duplicates = channel.skipped;
          console.log(`     • ${channel.channelName} (@${channel.channelUsername})`);
          console.log(`       └─ ${channel.total} постов (${newPosts} новых, ${duplicates} дубли)`);
        });
      }
      
      // Deactivated channels
      if (deactivated.length > 0) {
        console.log('\n  ⚠️  Недоступные каналы (деактивированы):');
        deactivated.forEach(channel => {
          console.log(`     • ${channel.channelName} (@${channel.channelUsername})`);
        });
      }
      
      // Channels with errors
      if (withErrors.length > 0) {
        console.log('\n  ❌ Каналы с ошибками:');
        withErrors.forEach(channel => {
          console.log(`     • ${channel.channelName} (@${channel.channelUsername})`);
          console.log(`       └─ Ошибок: ${channel.errors}`);
        });
      }
      
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
    
    console.log('');

    // Summary messages
    if (stats.savedPosts === 0 && stats.skippedPosts > 0) {
      console.log('💡 Все посты уже были загружены ранее (инкрементальная загрузка)');
    } else if (stats.savedPosts > 0) {
      console.log(`✨ Успешно добавлено ${stats.savedPosts} новых постов в базу данных!`);
    }

    if (stats.deactivatedChannels > 0) {
      console.log(
        `\n⚠️  ${stats.deactivatedChannels} канал(ов) недоступны и были деактивированы.`
      );
    }

    if (stats.failedChannels > 0 && stats.failedChannels > stats.deactivatedChannels) {
      console.log(
        '\n⚠️  Некоторые каналы не удалось обработать. Проверьте логи выше.'
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
      console.error('  3. Неверное имя канала в базе данных');
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
