import { startBot } from "./index";
import { initScheduler } from "../cron";

async function main() {
  try {
    console.log("🚀 Запуск SMM Agent...\n");
    initScheduler();
    
    console.log("\n✅ Все сервисы запущены успешно!\n");
    await startBot();
    
  } catch (error) {
    console.error("❌ Ошибка запуска приложения:", error);
    process.exit(1);
  }
}

void main();

process.once("SIGINT", () => {
  console.log("\n🛑 Received SIGINT, stopping services...");
  process.exit(0);
});

process.once("SIGTERM", () => {
  console.log("\n🛑 Received SIGTERM, stopping services...");
  process.exit(0);
});
