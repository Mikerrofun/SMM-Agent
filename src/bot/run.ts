import { startBot } from "./index";

// Запуск бота
void startBot();

// Обработка graceful shutdown
process.once("SIGINT", () => {
  console.log("Received SIGINT, stopping bot...");
  process.exit(0);
});

process.once("SIGTERM", () => {
  console.log("Received SIGTERM, stopping bot...");
  process.exit(0);
});
