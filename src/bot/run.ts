import { startBot } from "./index";
import { initScheduler } from "../cron";

async function main() {
  try {
    // Запуск бота
    console.log("🚀 Запуск SMM Agent...\n");
    
    await startBot();
    
    initScheduler();
    
    console.log("\n✅ Все сервисы запущены успешно!\n");
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
