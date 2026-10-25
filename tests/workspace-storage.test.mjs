import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

test('an unresponsive database fails within a deadline, closes a late connection, and permits retry', async () => {
  const source = await readFile(new URL('../services/workspaceStorage.ts', import.meta.url), 'utf8');
  const code = buildSync({ stdin:{contents:source,loader:'ts',resolveDir:fileURLToPath(new URL('../services',import.meta.url))}, bundle:true,write:false,format:'cjs',platform:'node',target:'es2022' }).outputFiles[0].text;
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  const module = { exports: {} };
  const storage = new Function('module', 'indexedDB', 'setTimeout', 'clearTimeout', code + '\nreturn module.exports;')(
    module,
    { open: () => { const request = {}; requests.push(request); return request; } },
    (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    id => timers.delete(id),
  );
  const stalled = assert.rejects(storage.readWorkspaceData('current'), /数据库打开超时/);
  assert.equal(timers.size, 1);
  const timeout = [...timers.values()][0];
  assert.ok(timeout.delay > 0 && timeout.delay <= 10000);
  timeout.callback();
  await stalled;
  let closed = false;
  requests[0].result = { close: () => { closed = true; } };
  requests[0].onsuccess();
  assert.equal(closed, true, 'a late connection must not leak or replace the retry');

  const retry = storage.readWorkspaceData('current');
  assert.equal(requests.length, 2);
  const tx = { objectStore: () => ({ get: () => ({ result: undefined }) }) };
  requests[1].result = { transaction: () => { queueMicrotask(() => tx.oncomplete()); return tx; } };
  requests[1].onsuccess();
  assert.equal(await retry, undefined);
  assert.equal(timers.size, 0, 'a successful retry must clear its deadline');
});
