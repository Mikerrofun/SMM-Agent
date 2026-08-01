#!/usr/bin/env tsx
/**
 * Скрипт для заполнения таблицы Competitor каналами конкурентов
 * 
 * Запуск: npm run seed:competitors
 */

import 'dotenv/config';
import { prisma } from '../db/client';


const COMPETITORS = [
  { name: 'Максим Батырев', username: 'Maxim_Batyrev' },
  { name: 'Александр Высоцкий', username: 'alexander_visotsky' },
  { name: 'Academy 1984', username: 'academy1984' },
  { name: 'Владимир Моженков', username: 'vmozhenkov' },
  { name: 'Стратегия 69', username: 'strategy69' },
  { name: 'Сколково', username: 'skolkovo_channel' },
  { name: 'Про Управленца', username: 'ProYpravlenca' },
  { name: 'Регулярный менеджмент', username: 'regularmanagement' },
  { name: 'Алексей Фридман', username: 'asfridman' },
  { name: 'iРуководитель', username: 'iRukovoditel' },
  { name: 'Балицкая', username: 'TheBalitskaya' },
  { name: 'Уровень TOP', username: 'uroventop' },
  { name: 'HR Compass School', username: 'schoolhrcompass' },
  { name: 'Экопси Консалтинг', username: 'ecopsy_consulting' },
  { name: 'Безручко', username: 'bezruchko_channel' },
  { name: 'Радислав Гандапас', username: 'radislavgandapascom' },
  { name: 'Евгений Фролов', username: 'frolov_evgenii' },
  { name: 'Александр Белоножко', username: 'BelonozhkoAleksandr' },
  { name: 'Илья Балахнин', username: 'ilyabalahnin' },
  { name: 'How to Make 10x', username: 'howtomake10x' },
  { name: 'Михаил Гребенюк', username: 'grebenukm' },
  { name: 'Михаил Токовинин', username: 'mtokovinin' },
  { name: 'Ольга Паратнова', username: 'trenerolgaparatnova' },
  { name: 'Оскар Хартманн', username: 'Oskar_Hartmann' },
  { name: 'Михаил Спиридонов', username: 'mspiridonov' },
];


function generateChannelUrl(username: string): string {
  return `https://t.me/${username}`;
}

async function main() {
  console.log('🚀 Начинаем заполнение таблицы Competitor...\n');

  let created = 0;
  let skipped = 0;

  for (const competitor of COMPETITORS) {
    const url = generateChannelUrl(competitor.username);
    
    try {
      await prisma.competitor.upsert({
        where: { url },
        update: {},
        create: {
          name: competitor.name,
          url,
          isActive: true,
        },
      });

      console.log(`✅ ${competitor.name.padEnd(30)} @${competitor.username}`);
      created++;
    } catch (error) {
      // Если ошибка не связана с дублем, выводим
      if (error instanceof Error && !error.message.includes('Unique constraint')) {
        console.error(`❌ Ошибка при добавлении ${competitor.name}:`, error.message);
      } else {
        console.log(`⏭️  ${competitor.name.padEnd(30)} уже существует`);
        skipped++;
      }
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Статистика:');
  console.log(`  ✔️  Добавлено новых:     ${created}`);
  console.log(`  ⏭️  Уже существовало:   ${skipped}`);
  console.log(`  📝 Всего конкурентов:   ${COMPETITORS.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const activeCount = await prisma.competitor.count({ where: { isActive: true } });
  const totalCount = await prisma.competitor.count();

  console.log('\n📈 Статус в БД:');
  console.log(`  🟢 Активных:  ${activeCount}`);
  console.log(`  📊 Всего:     ${totalCount}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  });
