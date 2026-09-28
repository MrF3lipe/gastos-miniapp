// Prueba headless del flujo de la Mini App (sin datos personales).
// Uso: NODE_PATH=/usr/local/lib/node_modules node tests/flow.test.js
// Opcional: SHOTS_DIR=/ruta para guardar capturas 390x844.
// Opcional: CHROME_PATH=/usr/bin/google-chrome si Playwright no tiene su navegador.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || '';
const TZ = 'America/Havana';

function ymdInTz(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const STUB = `
window.__tg = { sent: [], closed: 0, main: { text: '', visible: false, active: true, cb: null }, back: { visible: false, cb: null }, haptics: 0 };
window.Telegram = { WebApp: {
  initData: 'query_id=TEST&user=%7B%7D&auth_date=1&hash=x', version: '7.0', platform: 'test',
  isVersionAtLeast: function () { return true; },
  ready: function () {}, expand: function () {},
  close: function () { window.__tg.closed++; },
  sendData: function (d) { window.__tg.sent.push(d); },
  MainButton: {
    setText: function (t) { window.__tg.main.text = t; }, show: function () { window.__tg.main.visible = true; },
    hide: function () { window.__tg.main.visible = false; }, enable: function () { window.__tg.main.active = true; },
    disable: function () { window.__tg.main.active = false; }, onClick: function (cb) { window.__tg.main.cb = cb; }
  },
  BackButton: {
    show: function () { window.__tg.back.visible = true; }, hide: function () { window.__tg.back.visible = false; },
    onClick: function (cb) { window.__tg.back.cb = cb; }
  },
  HapticFeedback: { impactOccurred: function () { window.__tg.haptics++; }, selectionChanged: function () { window.__tg.haptics++; }, notificationOccurred: function () { window.__tg.haptics++; } }
} };`;

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function newPage(browser, base, query, withStub) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: TZ, locale: 'es-ES' });
  // El script real de Telegram sobrescribiría el stub: se sirve vacío.
  await ctx.route('https://telegram.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  if (withStub) await ctx.addInitScript(STUB);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + '/' + (query || ''));
  return { ctx, page, errors };
}

const tg = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__tg)));
const mainClick = (page) => page.evaluate(() => window.__tg.main.cb());
const keys = async (page, seq) => { for (const k of seq) await page.click(`#pad button[data-k="${k}"]`); };
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }); }

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const hoy = ymdInTz(0);
  let passed = 0;
  const ok = (m) => { passed++; console.log('ok -', m); };

  try {
    // 1) Gasto 1.500,50 USD Comida Efectivo Hoy
    {
      const { ctx, page, errors } = await newPage(browser, base, '', true);
      let s = await tg(page);
      assert.strictEqual(s.main.text, 'Siguiente'); assert.strictEqual(s.main.active, false); assert.strictEqual(s.back.visible, false);
      assert.ok(await page.isHidden('#notice'));
      await keys(page, ['1', '5', '0', '0', ',', '5', '0', '9', ',']); // 3er decimal y 2ª coma se ignoran
      await page.click('#mon button[data-mon="USD"]');
      assert.strictEqual(await page.textContent('#amtNum'), '1.500,50');
      assert.strictEqual(await page.textContent('#amtCur'), 'USD');
      s = await tg(page); assert.strictEqual(s.main.active, true);
      await shot(page, '1-monto-gasto.png');
      await mainClick(page);
      s = await tg(page); assert.strictEqual(s.back.visible, true); assert.strictEqual(s.main.visible, false);
      await shot(page, '2-categorias-gasto.png');
      await page.click('#cats button[data-cat="Comida"]');
      assert.ok(await page.isVisible('#s3'));
      await shot(page, '3-detalles.png');
      await mainClick(page);
      s = await tg(page); assert.strictEqual(s.main.text, 'Guardar');
      assert.ok((await page.textContent('#sum')).includes('1.500,50 USD'));
      await shot(page, '4-confirmar.png');
      await mainClick(page);
      s = await tg(page);
      const expected = '{"v":1,"t":"g","monto":1500.5,"mon":"USD","cat":"Comida","cuenta":"Efectivo","fecha":"' + hoy + '","nota":""}';
      assert.deepStrictEqual(s.sent, [expected]);
      assert.ok(s.haptics > 0);
      assert.deepStrictEqual(errors, []);
      ok('gasto -> ' + s.sent[0]);
      await ctx.close();
    }

    // 2) Ingreso 200 CUP (Sueldo, Efectivo, Hoy) + BackButton
    {
      const { ctx, page, errors } = await newPage(browser, base, '', true);
      await page.click('#tipo button[data-t="i"]');
      await keys(page, ['0', '2', '0', '0']); // cero inicial se reemplaza
      assert.strictEqual(await page.textContent('#amtNum'), '200');
      await mainClick(page);
      const cats = await page.$$eval('#cats button', (b) => b.map((x) => x.getAttribute('data-cat')));
      assert.ok(cats.includes('Sueldo') && cats.includes('Otros') && !cats.includes('Comida'));
      await shot(page, '5-categorias-ingreso.png');
      await page.evaluate(() => window.__tg.back.cb()); // volver y seguir
      assert.ok(await page.isVisible('#s1'));
      await mainClick(page);
      await page.click('#cats button[data-cat="Sueldo"]');
      await mainClick(page);
      await mainClick(page);
      const s = await tg(page);
      const expected = '{"v":1,"t":"i","monto":200,"mon":"CUP","cat":"Sueldo","cuenta":"Efectivo","fecha":"' + hoy + '","nota":""}';
      assert.deepStrictEqual(s.sent, [expected]);
      assert.deepStrictEqual(errors, []);
      ok('ingreso -> ' + s.sent[0]);
      await ctx.close();
    }

    // 3) Ayer + cuenta Banco + nota
    {
      const { ctx, page } = await newPage(browser, base, '', true);
      await keys(page, ['7', ',', '2', '5']);
      await mainClick(page);
      await page.click('#cats button[data-cat="Transporte"]');
      await page.click('#cuentas button[data-cuenta="Banco"]');
      await page.click('#fechas button[data-f="ayer"]');
      await page.fill('#nota', '  taxi   al trabajo ');
      await mainClick(page); await mainClick(page);
      const s = await tg(page);
      assert.deepStrictEqual(JSON.parse(s.sent[0]), { v: 1, t: 'g', monto: 7.25, mon: 'CUP', cat: 'Transporte', cuenta: 'Banco', fecha: ymdInTz(-1), nota: 'taxi al trabajo' });
      ok('ayer/banco/nota -> ' + s.sent[0]);
      await ctx.close();
    }

    // 4) Fuera de Telegram + ?mon=USD + ?bal (sanitizado, solo texto)
    {
      const bal = encodeURIComponent('<b>Saldo</b> 10 USD<script>x()</script>');
      const { ctx, page, errors } = await newPage(browser, base, '?mon=usd&bal=' + bal, false);
      assert.ok(await page.isVisible('#notice'));
      assert.strictEqual(await page.textContent('#amtCur'), 'USD');
      assert.strictEqual(await page.textContent('#bal'), '<b>Saldo</b> 10 USD<script>x()</script>');
      assert.strictEqual(await page.$$eval('#bal *', (e) => e.length), 0);
      assert.ok(await page.isDisabled('#fbtn'));
      await keys(page, ['4', '2']);
      await page.click('#fbtn');
      await page.click('#back'); assert.ok(await page.isVisible('#s1')); await page.click('#fbtn');
      await page.click('#cats button[data-cat="Otros"]');
      await page.click('#fbtn');
      await page.click('#fbtn');
      const json = await page.textContent('#json');
      assert.strictEqual(json, '{"v":1,"t":"g","monto":42,"mon":"USD","cat":"Otros","cuenta":"Efectivo","fecha":"' + hoy + '","nota":""}');
      assert.deepStrictEqual(errors, []);
      await shot(page, '6-fuera-de-telegram-json.png');
      ok('navegador (sin Telegram) -> ' + json);
      await ctx.close();
    }
    console.log(`\n${passed} pruebas OK`);
  } catch (e) {
    console.error('FALLO:', e); process.exitCode = 1;
  } finally {
    await browser.close(); srv.close();
  }
})();
