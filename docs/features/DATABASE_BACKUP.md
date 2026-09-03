---

**Дата:** 02.09.2026  
**Теги:** #infrastructure #database #backup

---

## 1. Зачем

Supabase на бесплатном тарифе не предоставляет автоматических бэкапов. База может быть потеряна из-за ошибки разработчика, бага в коде, или случайного удаления данных — без возможности восстановления. Это критично, т.к. база содержит распарсенные посты, идеи, сгенерированный контент и настройки пайплайнов. Потеря данных = откат на недели назад. Нужна система локальных бэкапов, которая работает одной командой, не требует сторонних сервисов и хранит данные на машине разработчика.

## 2. Где/что уже было

Ничего не было. База работала без страховки. В проекте использовались:
- `dotenv` для чтения `.env` (уже установлен)
- `execSync` из Node.js для вызова `pg_dump/psql` (нативно)
- `fs` и `path` для работы с файлами (нативно)

Задача — не писать собственный движок бэкапов, а обернуть нативные PostgreSQL утилиты (`pg_dump`, `psql`) в TypeScript-скрипты с удобным интерфейсом.

## 3. Реализация

### 3.1. Скрипт создания бэкапа

```ts
// src/scripts/db/backup.ts
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
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
    console.log(`🗑️ Удаляю старые бэкапы (старше ${maxAgeDays} дней)`);
    oldBackups.forEach((backup) => {
      unlinkSync(backup.path);
      const ageDays = Math.floor(backup.age / (24 * 60 * 60 * 1000));
      console.log(`❌ ${backup.name} (возраст: ${ageDays} дней)`);
    });
  }
}

async function createBackup() {
  let databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DIRECT_URL или DATABASE_URL не найден');
    process.exit(1);
  }

  const dbConfig = parseDatabaseUrl(databaseUrl);
  const backupDir = join(process.cwd(), 'db-backups');
  
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/T/, '-')
    .replace(/\..+/, '')
    .replace(/:/g, '-');
  const filepath = join(backupDir, `backup-${timestamp}.sql`);

  const pgDumpPath = '/opt/homebrew/opt/postgresql@17/bin/pg_dump';
  
  execSync(
    `${pgDumpPath} -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${filepath}"`,
    {
      stdio: 'inherit',
      env: { ...process.env, PGPASSWORD: dbConfig.password },
    }
  );

  console.log(`✅ Бэкап создан: ${filepath}`);
  
  // Автоматическая ротация: удаление бэкапов старше 10 дней
  cleanOldBackups(backupDir, 10);
}

createBackup();
```

**Ключевые моменты:**
- Парсинг URL через нативный `new URL()` — безопасное извлечение хоста, юзера, пароля
- `PGPASSWORD` в env вместо передачи пароля в CLI (пароль содержит `$`, который ломает shell)
- Явный путь к `pg_dump@17` (на машине установлены и 16, и 17 — выбираем 17 для совместимости с Supabase 17.6)
- Timestamp в имени файла — уникальность, сортировка по дате

### 3.2. Скрипт восстановления бэкапа

```ts
// src/scripts/db/restore.ts
import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function restoreBackup() {
  let databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  const dbConfig = parseDatabaseUrl(databaseUrl);
  const backupDir = join(process.cwd(), 'db-backups');

  // Находим все файлы backup-*.sql
  const backupFiles = readdirSync(backupDir)
    .filter((file) => file.startsWith('backup-') && file.endsWith('.sql'))
    .map((file) => ({
      name: file,
      path: join(backupDir, file),
      time: statSync(join(backupDir, file)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time); // Новые первыми

  if (backupFiles.length === 0) {
    console.error('❌ Файлы бэкапа не найдены');
    process.exit(1);
  }

  const latestBackup = backupFiles[0]; // Самый свежий
  console.log(`📦 Восстанавливаю: ${latestBackup.name}`);

  const psqlPath = '/opt/homebrew/opt/postgresql@17/bin/psql';
  execSync(
    `${psqlPath} -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${latestBackup.path}"`,
    {
      stdio: 'inherit',
      env: { ...process.env, PGPASSWORD: dbConfig.password },
    }
  );

  console.log('✅ База восстановлена');
}

restoreBackup();
```

**Отличия от backup:**
- Не создаёт файл, а ищет существующие через `readdirSync`
- Сортировка по `mtime` (дата модификации файла) — автоматический выбор последнего
- `psql -f` вместо `pg_dump` — импорт SQL-дампа обратно в базу

### 3.3. Регистрация команд

```json
// package.json (scripts)
"db:backup": "tsx src/scripts/db/backup.ts",
"db:restore": "tsx src/scripts/db/restore.ts"
```

### 3.4. Игнорирование бэкапов в Git

```
// .gitignore
/db-backups
```

Бэкапы содержат полный дамп базы (включая приватные данные, токены). Не коммитим.

## 4. Поток данных

### Создание бэкапа:
```
npm run db:backup
↓
tsx backup.ts
↓
dotenv.config() → читает DIRECT_URL из .env
↓
parseDatabaseUrl() → извлекает host, port, user, password
↓
mkdirSync(db-backups) → создаёт папку (если нет)
↓
execSync(pg_dump) → вызывает PostgreSQL утилиту
↓
pg_dump → подключается к Supabase → выгружает таблицы + данные
↓
записывает в db-backups/backup-2026-09-02-14-30-15.sql (3.6 MB)
↓
cleanOldBackups(backupDir, 10) → удаляет файлы старше 10 дней
↓
Выводит статистику: сколько удалено, сколько осталось
```

### Восстановление:
```
npm run db:restore
↓
tsx restore.ts
↓
readdirSync(db-backups) → читает все backup-*.sql
↓
sort((a,b) => b.time - a.time) → сортирует по mtime, выбирает последний
↓
execSync(psql -f backup.sql) → импортирует SQL в базу
↓
Supabase перезаписывается содержимым из файла
```

## 5. Почему так, а не иначе

1. **Почему `pg_dump`, а не Prisma Migrate или ORM-экспорт?**  
   Prisma не умеет делать полные дампы данных (только схема). `pg_dump` — стандарт индустрии, поддерживает всё: таблицы, индексы, sequences, данные. Бэкап 1:1 с оригинальной базой.

2. **Почему локально, а не в S3/облако?**  
   Бесплатный тариф Supabase → нет бюджета на S3. Локальные файлы на SSD — достаточно для dev-окружения. Быстрый доступ, нет сетевых задержек, не нужны credentials.

3. **Почему явный путь к `postgresql@17`, а не системный `pg_dump`?**  
   На macOS через Homebrew могут быть установлены несколько версий PostgreSQL. Supabase использует 17.6, а дефолтный `pg_dump` может быть 16.x → ошибка "version mismatch". Явный путь гарантирует правильную версию.

4. **Почему автоматический выбор последнего бэкапа в restore, а не ручное указание файла?**  
   95% кейсов — восстановление после свежего факапа. Сортировка по mtime снимает необходимость вручную искать файл. Если нужен старый бэкап — можно вызвать `psql` напрямую с путём к файлу.

5. **Почему `DIRECT_URL` приоритетнее `DATABASE_URL`?**  
   `DATABASE_URL` использует pooler (pgBouncer) через порт 6543 с параметром `?pgbouncer=true`. `pg_dump` не работает с pgBouncer (транзакционный режим конфликтует с утилитами). `DIRECT_URL` — прямое подключение к Postgres через порт 5432.

6. **Почему timestamp в имени файла, а не перезапись одного `backup.sql`?**  
   Несколько бэкапов = история изменений. Можно откатиться не на последний, а на предыдущий. Timestamp в формате `YYYY-MM-DD-HH-MM-SS` — читаемо и сортируется лексикографически. Автоматическая ротация (10 дней) предотвращает переполнение диска.

## Преимущества

- ✅ Одна команда для полного дампа всей базы (структура + данные + 3.6 MB контента)
- ✅ Автоматическое восстановление последнего бэкапа без ручного выбора файла
- ✅ Автоматическая ротация — бэкапы старше 10 дней удаляются после создания нового
- ✅ Нет зависимости от облачных сервисов — работает оффлайн на локальной машине
- ✅ Использует нативные PostgreSQL утилиты (pg_dump/psql) вместо самописных парсеров SQL
- ✅ Совместимость версий — явный путь к PostgreSQL 17 для работы с Supabase 17.6
- ✅ Безопасная передача пароля через `PGPASSWORD` env, без утечки в CLI history
- ✅ Автоматическое создание папки `db-backups/` при первом запуске
- ✅ Timestamp в именах файлов — уникальность, сортировка, история изменений
- ✅ Игнорирование `/db-backups` в Git — приватные данные не попадают в репозиторий
- ✅ Fallback с `DIRECT_URL` на `DATABASE_URL` — работает даже если одна переменная отсутствует
- ✅ Готов к использованию в cron — ротация предотвращает переполнение диска


## Использование в cron

### Проверка пути к pg_dump

Перед добавлением в cron убедись, что путь к `pg_dump` правильный:

```bash
/opt/homebrew/opt/postgresql@17/bin/pg_dump --version
```

Если команда не найдена, найди правильный путь:

```bash
which pg_dump
# или
brew --prefix postgresql@17
```

### Настройка crontab

Открой редактор cron:
```bash
crontab -e
```

Добавь строку для ежедневного бэкапа в 3:00 ночи:
```bash
# Ежедневный бэкап базы данных в 3:00
0 3 * * * cd /Users/admin/Mikerrofun/FullStack/Projects/SMM-Agent && /usr/local/bin/npm run db:backup >> /tmp/db-backup.log 2>&1
```

**Важные моменты:**
- `cd` в директорию проекта — чтобы `dotenv` нашёл `.env`
- Полный путь к `npm` (обычно `/usr/local/bin/npm` или `/opt/homebrew/bin/npm`)
- Логи перенаправляются в `/tmp/db-backup.log` — можно проверить результат

### Проверка настройки

Запусти задачу вручную через 3 минуты для тестирования:
```bash
# Например, если сейчас 14:25, поставь на 14:28
28 14 * * * cd /Users/admin/Mikerrofun/FullStack/Projects/SMM-Agent && /usr/local/bin/npm run db:backup >> /tmp/db-backup.log 2>&1
```

Проверь лог через несколько минут:
```bash
cat /tmp/db-backup.log
```

### Альтернативные расписания

```bash
# Каждые 12 часов (в 3:00 и 15:00)
0 3,15 * * * cd /Users/admin/Mikerrofun/FullStack/Projects/SMM-Agent && npm run db:backup >> /tmp/db-backup.log 2>&1

# Каждый понедельник в 2:00
0 2 * * 1 cd /Users/admin/Mikerrofun/FullStack/Projects/SMM-Agent && npm run db:backup >> /tmp/db-backup.log 2>&1

# Каждый час (для критичных данных)
0 * * * * cd /Users/admin/Mikerrofun/FullStack/Projects/SMM-Agent && npm run db:backup >> /tmp/db-backup.log 2>&1
```
