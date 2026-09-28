-- Добавляем generationBatchId для группировки постов одной генерации.
-- Это позволяет точно откатывать только посты конкретной отмененной команды,
-- без риска затронуть параллельные генерации (хотя singleton это и так блокирует).

ALTER TABLE "NataliaChannelPost" ADD COLUMN "generationBatchId" TEXT;

-- Индекс для быстрого поиска постов по batch
CREATE INDEX "NataliaChannelPost_generationBatchId_idx" ON "NataliaChannelPost"("generationBatchId");
