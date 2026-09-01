import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

/**
 * Парсит DATABASE_URL и извлекает компоненты подключения
 * Для Supabase pooler URL не меняем хост, т.к. pooler тоже работает с psql
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
 * Скрипт для восстановления базы данных из последнего бэкапа
 * Использует psql для импорта данных
 */
async function restoreBackup() {
  console.log('🔄 Начинаю восстановление базы данных из бэкапа...\n');

  // Пробуем использовать DIRECT_URL, если нет - DATABASE_URL
  let databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ Ошибка: DIRECT_URL или DATABASE_URL не найден в .env файле');
    process.exit(1);
  }

  console.log(`📡 Используется: ${process.env.DIRECT_URL ? 'DIRECT_URL' : 'DATABASE_URL'}\n`);

  // Парсим URL для извлечения компонентов
  const dbConfig = parseDatabaseUrl(databaseUrl);

  // Проверяем наличие папки с бэкапами
  const backupDir = join(process.cwd(), 'db-backups');
  try {
    readdirSync(backupDir);
  } catch {
    console.error('❌ Ошибка: Папка db-backups/ не найдена или пуста');
    console.error('💡 Сначала создайте бэкап командой: npm run db:backup');
    process.exit(1);
  }

  // Получаем список всех файлов бэкапов
  const backupFiles = readdirSync(backupDir)
    .filter((file) => file.startsWith('backup-') && file.endsWith('.sql'))
    .map((file) => ({
      name: file,
      path: join(backupDir, file),
      time: statSync(join(backupDir, file)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time); // Сортируем по времени, новые первыми

  if (backupFiles.length === 0) {
    console.error('❌ Ошибка: В папке db-backups/ не найдено файлов бэкапа');
    console.error('💡 Сначала создайте бэкап командой: npm run db:backup');
    process.exit(1);
  }

  // Берём самый свежий бэкап
  const latestBackup = backupFiles[0];
  const backupDate = new Date(latestBackup.time).toLocaleString('ru-RU');

  console.log(`📦 Найден последний бэкап: ${latestBackup.name}`);
  console.log(`📅 Дата создания: ${backupDate}`);
  console.log(
    `📊 Размер: ${(statSync(latestBackup.path).size / 1024 / 1024).toFixed(2)} MB\n`
  );

  console.log('⚠️  ВНИМАНИЕ: Это действие перезапишет текущую базу данных!');
  console.log('🔄 Начинаю восстановление...\n');

  try {
    // Используем PGPASSWORD для безопасной передачи пароля
    const env = {
      ...process.env,
      PGPASSWORD: dbConfig.password,
    };

    // Используем явный путь к psql версии 17 (совместима с сервером 17.6)
    const psqlPath = '/opt/homebrew/opt/postgresql@17/bin/psql';

    // Выполняем psql для восстановления
    execSync(
      `${psqlPath} -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${latestBackup.path}"`,
      {
        stdio: 'inherit',
        env,
      }
    );

    console.log('\n✅ База данных успешно восстановлена!');
    console.log(`📍 Использован файл: ${latestBackup.name}`);
  } catch (error) {
    console.error('\n❌ Ошибка при восстановлении базы данных:', error);
    console.error(
      '\n💡 Убедитесь, что psql установлен. Установка: brew install postgresql'
    );
    process.exit(1);
  }
}

// Запускаем скрипт
restoreBackup().catch((error) => {
  console.error('❌ Неожиданная ошибка:', error);
  process.exit(1);
});
