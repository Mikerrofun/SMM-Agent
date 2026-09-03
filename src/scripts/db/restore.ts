import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

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


async function restoreBackup() {
  console.log('🔄 Начинаю восстановление базы данных из бэкапа...\n');

  let databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ Ошибка: DIRECT_URL или DATABASE_URL не найден в .env файле');
    process.exit(1);
  }

  console.log(`📡 Используется: ${process.env.DIRECT_URL ? 'DIRECT_URL' : 'DATABASE_URL'}\n`);

  const dbConfig = parseDatabaseUrl(databaseUrl);

  const backupDir = join(process.cwd(), 'db-backups');
  try {
    readdirSync(backupDir);
  } catch {
    console.error('❌ Ошибка: Папка db-backups/ не найдена или пуста');
    console.error('💡 Сначала создайте бэкап командой: npm run db:backup');
    process.exit(1);
  }

  const backupFiles = readdirSync(backupDir)
    .filter((file) => file.startsWith('backup-') && file.endsWith('.sql'))
    .map((file) => ({
      name: file,
      path: join(backupDir, file),
      time: statSync(join(backupDir, file)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time); 

  if (backupFiles.length === 0) {
    console.error('❌ Ошибка: В папке db-backups/ не найдено файлов бэкапа');
    console.error('💡 Сначала создайте бэкап командой: npm run db:backup');
    process.exit(1);
  }

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

    const psqlPath = '/opt/homebrew/opt/postgresql@17/bin/psql';

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

restoreBackup().catch((error) => {
  console.error('❌ Неожиданная ошибка:', error);
  process.exit(1);
});
