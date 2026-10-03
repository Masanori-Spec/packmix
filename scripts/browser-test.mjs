// Optional UI suite: npm install --no-save playwright; npx playwright install chromium
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {demoProject} from '../src/demo.mjs';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const port = 4187;
const root = new URL('../', import.meta.url);
const server = spawn(process.execPath, ['scripts/serve.mjs'], {cwd: root, env: {...process.env, PORT: String(port)}, stdio: ['ignore', 'pipe', 'inherit']});
await new Promise((resolve, reject) => {server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(new Error(`Server exited: ${code}`)));});
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
let browser;
try { browser = await chromium.launch({headless: true, executablePath}); } catch (error) { server.kill(); throw error; }
const checks = [], errors = [], requests = [];
let context, page;
try {
  context = await browser.newContext({viewport: {width: 1440, height: 1100}, acceptDownloads: true});
  page = await context.newPage();
} catch (error) { server.kill(); await browser.close().catch(() => {}); throw error; }
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => requests.push(r.url()));
const check = async (name, fn) => {await fn(); checks.push(name); console.log(`PASS ${name}`);};
const load = async () => {await page.goto(`http://127.0.0.1:${port}`); await page.locator('.shopping').waitFor();};
const importData = async (obj, filename = 'test.json') => {await page.getByRole('button', {name: 'JSONを読込', exact: true}).click(); await page.locator('#import-file').setInputFiles({name: filename, mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj))});};
try {
  await mkdir(new URL('../artifacts/', import.meta.url), {recursive: true});
  await load();
  await check('default demo shows both exact-price options', async () => {
    assert.match(await page.locator('[data-mode=minPrice]').innerText(), /2,480/);
    assert.match(await page.locator('[data-mode=minSurplus]').innerText(), /2,580/);
    assert.match(await page.locator('.shopping').innerText(), /50枚パック × 1/);
    assert.match(await page.locator('.shopping').innerText(), /購入分の余り 18枚/);
  });
  await page.screenshot({path: new URL('../artifacts/desktop.png', import.meta.url).pathname, fullPage: true});
  await check('choosing less-surplus plan changes list', async () => {
    await page.locator('[data-mode=minSurplus]').click();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.mode), 'minSurplus');
    assert.match(await page.locator('.shopping').innerText(), /12枚パック × 1/);
    assert.match(await page.locator('.shopping').innerText(), /20枚パック × 1/);
    assert.match(await page.locator('.shopping').innerText(), /購入分の余り 0枚/);
  });
  await check('participants update and zero-demand inventory edge', async () => {
    await page.locator('#participants').fill('0');
    assert.match(await page.locator('.shopping-total').innerText(), /0円/);
    assert.equal(await page.locator('#minus').isDisabled(), true);
    await page.locator('#participants').fill('32');
  });
  await check('invalid input hides stale results and disables export; recovery works', async () => {
    await page.locator('#participants').fill('501');
    assert.equal(await page.locator('.shopping').count(), 0); assert.equal(await page.locator('#export').isDisabled(), true);
    assert.ok((await page.locator('[data-need]').allTextContents()).every(text => !/\d/.test(text) && text.includes('再計算')));
    await page.locator('#participants').fill('32'); assert.equal(await page.locator('.shopping').count(), 1);
    assert.match(await page.locator('[data-need=badge]').innerText(), /あと 32枚/);
    assert.match(await page.locator('[data-need=pen]').innerText(), /あと 24本/);
    await page.locator('#participants').fill(''); assert.equal(await page.locator('.shopping').count(), 0);
    assert.ok((await page.locator('[data-need]').allTextContents()).every(text => !/\d/.test(text)));
    await page.locator('#participants').fill('32');
  });
  await check('invalid rows can be removed without losing unrelated draft edits', async () => {
    await page.locator('#title').fill('削除テストの計画');
    await page.locator('[data-id=pen] [data-field=name]').fill('変更した水性ペン');
    await page.locator('[data-id=badge] [data-id=small] [data-pack=price]').fill('');
    await page.locator('[data-id=badge] [data-id=small] .remove-pack').click();
    assert.equal(await page.locator('[data-id=badge] .pack-row').count(), 2);
    assert.equal(await page.locator('#title').inputValue(), '削除テストの計画');
    assert.equal(await page.locator('[data-id=pen] [data-field=name]').inputValue(), '変更した水性ペン');
    assert.equal(await page.locator('.shopping').count(), 1);
    // A separate unfinished row must remain unfinished after another row is removed.
    await page.locator('[data-id=pen] [data-field=name]').fill('');
    await page.locator('[data-id=badge] [data-id=medium] [data-pack=label]').fill('');
    await page.locator('[data-id=badge] [data-id=medium] .remove-pack').click();
    assert.equal(await page.locator('[data-id=badge] .pack-row').count(), 1);
    assert.equal(await page.locator('[data-id=pen] [data-field=name]').inputValue(), '');
    assert.equal(await page.locator('.shopping').count(), 0);
    await page.locator('[data-id=pen] [data-field=name]').fill('残す品目');
    await page.locator('[data-id=badge] [data-field=perPerson]').fill('');
    await page.locator('[data-id=badge] .item-head button').click();
    assert.equal(await page.locator('.item-card').count(), 1);
    assert.equal(await page.locator('[data-id=pen] [data-field=name]').inputValue(), '残す品目');
    assert.equal(await page.locator('#title').inputValue(), '削除テストの計画');
    assert.equal(await page.locator('.shopping').count(), 1);
    await importData(demoProject()); await page.locator('#import-dialog').waitFor({state: 'hidden'});
  });
  await check('add/remove item and pack limits', async () => {
    for (let i = 0; i < 3; i++) await page.locator('#add-item').click();
    assert.equal(await page.locator('.item-card').count(), 5); assert.equal(await page.locator('#add-item').isDisabled(), true);
    const first = page.locator('.item-card').first();
    for (let i = 0; i < 3; i++) await first.locator('.add-pack').click();
    assert.equal(await first.locator('.pack-row').count(), 6); assert.equal(await first.locator('.add-pack').isDisabled(), true);
    await first.locator('.remove-pack').last().click(); assert.equal(await first.locator('.pack-row').count(), 5);
    await page.locator('.item-card').last().locator('.item-head button').click(); assert.equal(await page.locator('.item-card').count(), 4);
  });
  await check('import cancel, reopen and Escape preserve current plan', async () => {
    await page.getByRole('button', {name: 'JSONを読込', exact: true}).click();
    await page.getByRole('button', {name: 'キャンセル', exact: true}).click();
    await page.getByRole('button', {name: 'JSONを読込', exact: true}).click(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#import-dialog').isVisible(), false); assert.equal(await page.locator('.item-card').count(), 4);
  });
  await check('cancelled in-flight file read cannot replace a reopened dialog or current draft', async () => {
    await page.evaluate(() => {
      window.__originalFileText = File.prototype.text;
      File.prototype.text = function () {
        return new Promise(resolve => {window.__releaseFileRead = () => {window.__fileReadDone = window.__originalFileText.call(this).then(text => resolve(text));};});
      };
    });
    try {
      const pending = demoProject(); pending.title = '適用されてはいけない計画';
      await importData(pending);
      await page.waitForFunction(() => typeof window.__releaseFileRead === 'function');
      await page.getByRole('button', {name: 'キャンセル', exact: true}).click();
      await page.getByRole('button', {name: 'JSONを読込', exact: true}).click();
      await page.evaluate(async () => {window.__releaseFileRead(); await window.__fileReadDone;});
      assert.equal(await page.locator('#import-dialog').isVisible(), true);
      assert.equal(await page.locator('#title').inputValue(), '週末ワークショップ');
      assert.equal(await page.locator('.item-card').count(), 4);
      await page.getByRole('button', {name: 'キャンセル', exact: true}).click();
    } finally {
      await page.evaluate(() => {File.prototype.text = window.__originalFileText; delete window.__originalFileText; delete window.__releaseFileRead; delete window.__fileReadDone;});
    }
  });
  await check('malicious JSON rejected; old plan retained', async () => {
    await importData('{"__proto__":{"polluted":true}}');
    await page.waitForFunction(() => document.querySelector('#import-error').textContent.includes('安全でない'));
    assert.match(await page.locator('#import-error').innerText(), /安全でない/);
    assert.equal(await page.locator('.item-card').count(), 4);
    assert.equal(await page.evaluate(() => ({}).polluted), undefined);
    await page.getByRole('button', {name: 'キャンセル', exact: true}).click();
  });
  await check('HTML-shaped labels remain inert text after import', async () => {
    const payload = demoProject(); payload.title = '<img src=x onerror=alert(1)>'; payload.items[0].name = '<svg onload=alert(1)>';
    await importData(payload); await page.locator('#import-dialog').waitFor({state: 'hidden'});
    assert.equal(await page.locator('img').count(), 0); assert.equal(await page.locator('.shopping svg').count(), 0);
    assert.match(await page.locator('.shopping').innerText(), /<svg onload=alert\(1\)>/);
  });
  await check('JSON export round trips exact current data', async () => {
    const wait = page.waitForEvent('download'); await page.locator('#export').click(); const download = await wait;
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(exported.participants, 32); assert.equal(exported.title, '<img src=x onerror=alert(1)>');
    assert.equal(exported.items.length, 2);
  });
  await check('shopping-list file contains quantities and exclusions', async () => {
    const wait = page.waitForEvent('download'); await page.locator('#download-list').click(); const download = await wait;
    const text = await readFile(await download.path(), 'utf8'); assert.match(text, /税込合計/); assert.match(text, /送料・クーポン/); assert.match(text, /12枚パック/);
  });
  await check('threshold details lazy-render and have inclusive coverage', async () => {
    assert.equal(await page.locator('.threshold-table').count(), 0);
    await page.locator('.threshold-item summary').first().click(); await page.locator('.threshold-table').waitFor();
    assert.match(await page.locator('.threshold-table tbody tr').first().innerText(), /0〜0人/);
    assert.match(await page.locator('.threshold-table tbody tr').last().innerText(), /500人/);
  });
  await importData(demoProject()); await page.locator('#import-dialog').waitFor({state: 'hidden'});
  const timing = await page.evaluate(async () => {
    const samples = [], input = document.querySelector('#participants');
    for (let i = 0; i < 30; i++) {await new Promise(r => requestAnimationFrame(r)); const start = performance.now(); input.value = String(30 + i % 6); input.dispatchEvent(new Event('input', {bubbles: true})); document.body.offsetHeight; samples.push(performance.now() - start);}
    samples.sort((a, b) => a - b); return {samples: samples.length, medianMs: samples[15], p95Ms: samples[28], maxMs: samples.at(-1), scope: 'Event dispatch through synchronous calculation, DOM updates and forced layout; excludes paint'};
  });
  await check('ordinary browser interactions remain under 200ms p95', async () => assert.ok(timing.p95Ms < 200, JSON.stringify(timing)));
  await page.locator('#participants').fill('32');
  await check('mobile has no horizontal overflow and preserves controls', async () => {
    await page.setViewportSize({width: 390, height: 844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('[data-mode=minPrice]').click();
    assert.match(await page.locator('.shopping').innerText(), /50枚パック/);
    await page.screenshot({path: new URL('../artifacts/mobile.png', import.meta.url).pathname, fullPage: true});
    await page.setViewportSize({width: 320, height: 740});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
  await check('long valid labels and maximum totals fit narrow screens', async () => {
    const large = {version: 1, title: 'A'.repeat(80), participants: 500, items: Array.from({length: 5}, (_, i) => ({id: `i${i}`, name: 'N'.repeat(60), unit: '個', perPerson: 20, stock: 0, packs: [{id: 'p', label: 'L'.repeat(60), quantity: 1, price: 1000000}]}))};
    await importData(large); await page.locator('#import-dialog').waitFor({state: 'hidden'});
    assert.match(await page.locator('.shopping-total').innerText(), /50,000,000,000円/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
  await check('no page errors and no external requests', async () => {
    assert.deepEqual(errors, []); assert.ok(requests.every(url => url.startsWith(`http://127.0.0.1:${port}/`) || url.startsWith('blob:')), JSON.stringify(requests));
  });
  const report = {measuredAt: new Date().toISOString(), chromium: browser.version(), checks, timing, errors, network: 'Only localhost static resources; no external requests observed', viewports: ['1440×1100', '390×844', '320×740']};
  await writeFile(new URL('../docs/browser-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({path: new URL('../artifacts/failure.png', import.meta.url).pathname, fullPage: true}).catch(() => {});
  throw error;
} finally {server.kill(); await browser.close();}
