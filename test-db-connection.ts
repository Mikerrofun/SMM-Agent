import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { config } from 'dotenv';

// Загружаем .env.local
config({ path: '.env.local' });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function testConnection() {
  try {
    // Простой запрос для проверки подключения
    await prisma.$executeRaw`SELECT 1 as test`;
    console.log('✅ База данных подключена и работает!');
    
    // Получаем версию PostgreSQL
    const result = await prisma.$queryRaw`SELECT version()` as any[];
    console.log('PostgreSQL версия:', result[0]?.version?.substring(0, 50) + '...');
    
  } catch (error) {
    console.error('❌ Ошибка подключения к БД:', error);
    process.exit(1);
  } finally {
    await pool.end();
    await prisma.$disconnect();
  }
}

testConnection();
