import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
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
 * Удаляет бэкапы старше указанного количества дней
 */
function cleanOldBackups(backupDir: string, maxAgeDays: number) {
  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  const backupFiles = readdirSync(backupDir)
    .filter((file) => file.startsWith('backup-') && file.endsWith('.sql'))
    .map((file) => {
      const filePath = join(backupDir, file);
      const stats = statSync(filePath);
      return {
        name: file,
        path: filePath,
        mtime: stats.mtime.getTime(),
        age: now - stats.mtime.getTime(),
      };
    });

  const oldBackups = backupFiles.filter((backup) => backup.age > maxAgeMs);

  if (oldBackups.length > 0) {
    console.log(`\n🗑️  Удаляю старые бэкапы (старше ${maxAgeDays} дней):\n`);
    oldBackups.forEach((backup) => {
      unlinkSync(backup.path);
      const ageDays = Math.floor(backup.age / (24 * 60 * 60 * 1000));
      console.log(`   ❌ ${backup.name} (возраст: ${ageDays} дней)`);
    });
    console.log(`\n✨ Удалено бэкапов: ${oldBackups.length}`);
  } else {
    console.log(`\n✨ Все бэкапы свежие (младше ${maxAgeDays} дней)`);
  }

  const remainingCount = backupFiles.length - oldBackups.length;
  console.log(`📦 Осталось бэкапов: ${remainingCount}\n`);
}


async function createBackup() {
  console.log('🔄 Начинаю создание бэкапа базы данных...\n');

  let databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ Ошибка: DIRECT_URL или DATABASE_URL не найден в .env файле');
    process.exit(1);
  }

  console.log(`📡 Используется: ${process.env.DIRECT_URL ? 'DIRECT_URL' : 'DATABASE_URL'}\n`);

  const dbConfig = parseDatabaseUrl(databaseUrl);

  // create folder
  const backupDir = join(process.cwd(), 'db-backups');
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
    console.log('📁 Создана папка db-backups/\n');
  }

  // backup name
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
    const env = {
      ...process.env,
      PGPASSWORD: dbConfig.password,
      PGGSSENCMODE: 'disable',
    };

    const pgDumpPath = '/opt/homebrew/opt/postgresql@17/bin/pg_dump';

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

    cleanOldBackups(backupDir, 10);
  } catch (error) {
    console.error('\n❌ Ошибка при создании бэкапа:', error);
    console.error(
      '\n💡 Убедитесь, что pg_dump установлен. Установка: brew install postgresql'
    );
    process.exit(1);
  }
}

createBackup().catch((error) => {
  console.error('❌ Неожиданная ошибка:', error);
  process.exit(1);
});
