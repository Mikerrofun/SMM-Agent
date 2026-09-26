import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from 'grammy';
import { commandManager } from '../src/shared/utils/CommandManager/CommandManager';

/**
 * Фейковый ctx в духе createCronContext: только from/chat/reply/api.
 * Telegram API не мокается глубже — механика execute этого не требует.
 */
function createFakeCtx(userId: number): Context {
  return {
    from: { id: userId },
    chat: { id: userId },
    reply: async () => ({ chat: { id: userId }, message_id: 1 }),
    api: {
      editMessageText: async () => ({}),
    },
  } as unknown as Context;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('execute регистрирует команду и снимает учёт после завершения', async () => {
  const manager = commandManager;
  const ctx = createFakeCtx(1);

  assert.equal(manager.isCommandRunning('1_generate_post'), false);

  const result = await manager.execute(
    ctx,
    'generate_post',
    { statusText: 'working' },
    async () => 'ok'
  );

  assert.deepEqual(result, { status: 'completed', value: 'ok' });
  assert.equal(manager.isCommandRunning('1_generate_post'), false);
});

test('cancel → внутри хендлера checkCancelled бросает CommandCancelledError', async () => {
  const manager = commandManager;
  const ctx = createFakeCtx(1);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const executionPromise = manager.execute(
    ctx,
    'generate_post',
    { statusText: 'working' },
    async () => {
      await gate;
      manager.checkCancelled(); // должен бросить CommandCancelledError
      return 'ok';
    }
  );

  // Даём execute зарегистрировать команду и запустить хендлер
  await sleep(20);
  assert.equal(manager.isCommandRunning('1_generate_post'), true);
  assert.equal(manager.cancel('1_generate_post'), true);

  release();

  const result = await executionPromise;
  assert.deepEqual(result, { status: 'cancelled' });
  assert.equal(manager.isCommandRunning('1_generate_post'), false);
});

test('повторный execute блокируется per-user, а с singleton — и для другого userId', async () => {
  const manager = commandManager;
  const ctx1 = createFakeCtx(1);
  const ctx2 = createFakeCtx(2);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const first = manager.execute(
    ctx1,
    'run_pipeline',
    { statusText: 'working' },
    async () => {
      await gate;
      return 'first';
    }
  );

  await sleep(20);

  // Тот же пользователь — блокировка
  const sameUser = await manager.execute(
    ctx1,
    'run_pipeline',
    { statusText: 'working' },
    async () => 'duplicate'
  );
  assert.equal(sameUser?.status, 'already_running');

  // Другой пользователь без singleton — разрешён
  const otherUser = await manager.execute(
    ctx2,
    'run_pipeline',
    { statusText: 'working' },
    async () => 'other'
  );
  assert.equal(otherUser?.status, 'completed');

  // Другой пользователь с singleton — блокировка
  const otherSingleton = await manager.execute(
    ctx2,
    'run_pipeline',
    { statusText: 'working', singleton: true },
    async () => 'duplicate'
  );
  assert.equal(otherSingleton?.status, 'already_running');

  release();
  assert.equal((await first)?.status, 'completed');
});
