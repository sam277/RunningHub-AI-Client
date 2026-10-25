// Isolated browser regression test. All RunningHub endpoints are mocked.
// RH_PLAYWRIGHT_ROOT may point at a bundled playwright package.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.RH_PLAYWRIGHT_ROOT
  ? pathToFileURL(join(process.env.RH_PLAYWRIGHT_ROOT, 'index.mjs')).href : 'playwright');
const profile = await mkdtemp(join(tmpdir(), 'rh-personal-'));
const launch = () => chromium.launchPersistentContext(profile, {
  headless: true, viewport: { width: 1600, height: 1000 },
  ...(process.env.RH_BROWSER_PATH ? { executablePath: process.env.RH_BROWSER_PATH } : {}),
});
let context;
let page;
const appUrl = process.env.RH_TEST_URL || 'http://127.0.0.1:5187';
const storeRequests = [];
const submissions = [];
const errors = [];
const installMocks = async ctx => {
  await ctx.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!url.hostname.includes('runninghub.')) return route.continue();
    let data = { code: 0, data: {} };
    if (url.pathname.endsWith('/apiCallDemo')) {
      const id = url.searchParams.get('webappId');
      data.data = { webappName: '测试应用 ' + id, nodeInfoList: [
        { nodeId: '1', fieldName: 'prompt', fieldType: 'STRING', fieldValue: '初始提示词', nodeName: '提示词' },
        { nodeId: '2', fieldName: 'image', fieldType: 'IMAGE', fieldValue: '', nodeName: '参考图' },
      ] };
    } else if (url.pathname.endsWith('/webapp/list')) {
      storeRequests.push(JSON.parse(route.request().postData()));
      data.data = { records: [{ id: '999', name: '非精选测试应用', webappName: '非精选测试应用' }], total: 1 };
    } else if (url.pathname.endsWith('/queue/status')) {
      data.data = { concurrentLimit: 1, runningCount: 0, queuedCount: 0, apiKeyType: 'NORMAL' };
    } else if (url.pathname.endsWith('/media/upload/binary')) {
      data.data = { fileName: 'mock-uploaded-image.png' };
    } else if (url.pathname.endsWith('/ai-app/run')) {
      submissions.push(route.request().postData());
      data.data = { taskId: 'mock-task-' + submissions.length, taskStatus: 'RUNNING' };
    } else if (url.pathname.endsWith('/v2/query')) {
      data = { taskId: 'mock-task-1', status: 'SUCCESS', results: [] };
    }
    await route.fulfill({ json: data });
  });
};
const waitSaved = () => page.getByText(/工作区已自动保存 ·/).waitFor();
const readCurrent = () => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('rh-workspaces', 1);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const read = db.transaction('snapshots').objectStore('snapshots').get('current');
    read.onsuccess = () => { resolve(read.result); db.close(); };
  };
}));
try {
  context = await launch();
  await installMocks(context);
  page = context.pages()[0] || await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('rh_terms_agreed', 'true'); });
  await page.goto(appUrl);
  await page.getByRole('button', { name: '我的收藏', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '交流与支持', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '标准模型 API', exact: true }).count(), 0);
  await page.getByRole('button', { name: '个人中心', exact: true }).click();
  await page.getByLabel('账号 1 API Key', { exact: true }).fill('test-personal-account-a');
  await page.getByLabel('账号 1 备注或邮箱', { exact: true }).fill('account-a@example.com');
  await page.getByRole('checkbox', { name: '本地保存 API Key' }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rh_api_keys_v2'))[0].note), 'account-a@example.com');
  await page.getByRole('button', { name: '保存并关闭' }).click();
  await page.reload();
  await page.getByRole('button', { name: '个人中心', exact: true }).click();
  assert.equal(await page.getByLabel('账号 1 API Key', { exact: true }).inputValue(), 'test-personal-account-a');
  assert.equal(await page.getByLabel('账号 1 备注或邮箱', { exact: true }).inputValue(), 'account-a@example.com');
  await page.getByRole('checkbox', { name: '本地保存 API Key' }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('rh_api_keys_v2')), null);
  assert.equal(await page.getByLabel('账号 1 API Key', { exact: true }).inputValue(), 'test-personal-account-a');
  await page.getByRole('checkbox', { name: '本地保存 API Key' }).click();
  await page.getByRole('button', { name: '保存并关闭' }).click();
  await page.getByRole('button', { name: '官方应用商城', exact: true }).click();
  await page.getByText('非精选测试应用', { exact: true }).waitFor();
  assert.equal(Object.hasOwn(storeRequests.at(-1), 'carefullyChosen'), false);
  await page.getByLabel('应用范围').selectOption('curated');
  await page.waitForFunction(() => document.querySelector('select[aria-label="应用范围"]').value === 'curated');
  await page.getByText('非精选测试应用', { exact: true }).waitFor();
  assert.equal(storeRequests.at(-1).carefullyChosen, true);
  await page.getByRole('button', { name: '多任务模式', exact: true }).click();
  await page.getByPlaceholder('请输入 WebApp ID，或粘贴应用详情页链接').fill('111');
  await page.getByRole('button', { name: '加载', exact: true }).click();
  await page.getByPlaceholder('请输入文本...').fill('修改后的首个任务提示词');
  await page.getByLabel('任务名称', { exact: true }).fill('第一组分镜');
  await page.getByRole('button', { name: '复制卡片', exact: true }).click();
  await page.getByLabel('任务名称', { exact: true }).filter({ visible: true }).fill('第二组分镜');
  await page.getByPlaceholder('请输入文本...').filter({ visible: true }).fill('第二个任务独立提示词');
  await page.getByRole('button', { name: '卡片总览', exact: true }).click();
  assert.equal(await page.getByPlaceholder('请输入文本...').count(), 2);
  await page.getByRole('button', { name: '列表编辑', exact: true }).click();
  await page.getByRole('button', { name: /1\. 第一组分镜/ }).click();
  assert.equal(await page.getByPlaceholder('请输入文本...').filter({ visible: true }).inputValue(), '修改后的首个任务提示词');
  await page.getByRole('button', { name: '批量设置', exact: true }).click();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFOsAAAAASUVORK5CYII=', 'base64');
  // Mock only the native picker boundary; real File bytes flow through the UI and IndexedDB.
  await page.evaluate(base64 => {
    const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
    window.showOpenFilePicker = async () => ['frame-a.png', 'frame-b.png'].map(name => ({
      getFile: async () => new File([bytes], name, { type: 'image/png' }),
    }));
  }, png.toString('base64'));
  await page.getByTitle('按选择顺序批量导入图片', { exact: true }).click();
  await page.getByRole('button', { name: '保存设置 (2)', exact: true }).click();
  await page.getByRole('button', { name: '立即保存 / 重试', exact: true }).click();
  await waitSaved();
  let current = await readCurrent();
  assert.equal(current.cards.length, 2);
  assert.equal(current.cards[0].initialBatchList.length, 2);
  // Verify bytes, names, and MIME survived IndexedDB structured cloning.
  assert.deepEqual(await page.evaluate(async () => {
    const { readWorkspaceData } = await import('/services/workspaceStorage.ts');
    const data = await readWorkspaceData('current');
    return Promise.all(Object.values(data.cards[0].initialPendingFiles).map(async f => ({ name: f.name, type: f.type, size: (await f.arrayBuffer()).byteLength })));
  }), [
    { name: 'frame-a.png', type: 'image/png', size: png.length },
    { name: 'frame-b.png', type: 'image/png', size: png.length },
  ]);
  // A storage error must remain visible and be recoverable without losing live parameters.
  await page.evaluate(() => {
    window.rhOriginalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(names, mode, options) {
      if (mode === 'readwrite') throw new DOMException('模拟空间不足', 'QuotaExceededError');
      return window.rhOriginalTransaction.call(this, names, mode, options);
    };
  });
  await page.getByRole('button', { name: '立即保存 / 重试', exact: true }).click();
  await page.getByText('工作区保存失败，请检查存储空间后点击重试保存', { exact: true }).waitFor();
  await page.evaluate(() => { IDBDatabase.prototype.transaction = window.rhOriginalTransaction; });
  await page.getByRole('button', { name: '立即保存 / 重试', exact: true }).click();
  await waitSaved();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByPlaceholder('请输入草稿名称，例如：批量头像生成').fill('包含两张本地图片的草稿');
  await page.getByRole('button', { name: '保存草稿', exact: true }).last().click();
  await page.getByText('保存多任务草稿', { exact: true }).waitFor({ state: 'hidden' });
  await waitSaved();
  await mkdir('.browser-test-output', { recursive: true });
  await page.screenshot({ path: '.browser-test-output/任务列表.png', fullPage: true });
  assert.equal(submissions.length, 0);
  await context.close();
  context = await launch();
  await installMocks(context);
  page = context.pages()[0] || await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(appUrl);
  await page.getByRole('button', { name: '多任务模式', exact: true }).click();
  await page.getByRole('button', { name: /1\. 第一组分镜/ }).waitFor();
  assert.equal(await page.getByPlaceholder('请输入文本...').filter({ visible: true }).inputValue(), '修改后的首个任务提示词');
  await page.getByRole('button', { name: '批量设置', exact: true }).click();
  await page.getByRole('button', { name: '保存设置 (2)', exact: true }).waitFor();
  await page.getByRole('button', { name: '保存设置 (2)', exact: true }).click();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByRole('button', { name: /包含两张本地图片的草稿/ }).click();
  await waitSaved();
  current = await readCurrent();
  assert.equal(current.cards[0].initialBatchList.length, 2);
  assert.equal(Object.keys(current.cards[0].initialPendingFiles).length, 2);
  assert.equal(submissions.length, 0, 'Restoring workspaces must never submit paid tasks');
  // Exercise the existing scheduler with restored Files and verify account notes in logs.
  await page.getByRole('button', { name: '全部运行', exact: true }).click();
  await page.getByRole('button', { name: '全部运行', exact: true }).waitFor();
  assert.equal(submissions.length, 3);
  await page.getByText(/调度到 account-a@example.com/).first().waitFor();
  assert.deepEqual(errors, []);
  console.log('通过：账号备注、先填后勾选保存、重开恢复、关闭保存保留当前输入、商城范围、视图切换、独立参数、批量本地图片字节、命名草稿、浏览器进程重启恢复、恢复时零任务提交，以及手动运行后模拟提交 3 个任务、调度日志显示邮箱。');
} catch (error) {
  if (page) {
    await mkdir('.browser-test-output', { recursive: true });
    await page.screenshot({ path: '.browser-test-output/failure.png', fullPage: true }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 6000));
  }
  throw error;
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
