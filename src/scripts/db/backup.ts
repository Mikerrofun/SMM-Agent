import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

/**
 * Парсит DATABASE_URL и извлекает компоненты подключения
 * Для Supabase pooler URL не меняем хост, т.к. pooler тоже работает с pg_dump
 */
function parseDatabaseUrl(url: string) {
  const urlObj = new URL(url);
  
  return {
    user: urlObj.username,
    password: urlObj.password,
    host: urlObj.hostname,
    port: urlObj.port || '5432',
    database: urlObj.pathname.slice(1),
  };
}

/**
 * Скрипт для создания бэкапа базы данных Supabase
 * Использует pg_dump для экспорта всей структуры и данных
 */
async function createBackup() {
  console.log('🔄 Начинаю создание бэкапа базы данных...\n');

  // Пробуем использовать DIRECT_URL, если нет - DATABASE_URL
  let databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ Ошибка: DIRECT_URL или DATABASE_URL не найден в .env файле');
    process.exit(1);
  }

  console.log(`📡 Используется: ${process.env.DIRECT_URL ? 'DIRECT_URL' : 'DATABASE_URL'}\n`);

  // Парсим URL для извлечения компонентов
  const dbConfig = parseDatabaseUrl(databaseUrl);

  // Создаём папку для бэкапов, если её нет
  const backupDir = join(process.cwd(), 'db-backups');
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
    console.log('📁 Создана папка db-backups/\n');
  }

  // Генерируем имя файла с текущей датой и временем
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/T/, '-')
    .replace(/\..+/, '')
    .replace(/:/g, '-');
  const filename = `backup-${timestamp}.sql`;
  const filepath = join(backupDir, filename);

  console.log(`📦 Создаю бэкап: ${filename}\n`);

  try {
    // Используем PGPASSWORD для безопасной передачи пароля
    // PGGSSENCMODE=disable отключает проверку версии
    const env = {
      ...process.env,
      PGPASSWORD: dbConfig.password,
      PGGSSENCMODE: 'disable',
    };

    // Используем явный путь к pg_dump версии 17 (совместима с сервером 17.6)
    const pgDumpPath = '/opt/homebrew/opt/postgresql@17/bin/pg_dump';

    // Выполняем pg_dump
    execSync(
      `${pgDumpPath} -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${filepath}"`,
      {
        stdio: 'inherit',
        env,
      }
    );

    console.log('\n✅ Бэкап успешно создан!');
    console.log(`📍 Путь: ${filepath}`);
    
    const sizeBytes = Number(execSync(`stat -f%z "${filepath}"`).toString().trim());
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);
    console.log(`📊 Размер: ${sizeMB} MB`);
  } catch (error) {
    console.error('\n❌ Ошибка при создании бэкапа:', error);
    console.error(
      '\n💡 Убедитесь, что pg_dump установлен. Установка: brew install postgresql'
    );
    process.exit(1);
  }
}

// Запускаем скрипт
createBackup().catch((error) => {
  console.error('❌ Неожиданная ошибка:', error);
  process.exit(1);
});
