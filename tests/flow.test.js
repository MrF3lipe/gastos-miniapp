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
  initData: location.search.indexOf('menu=1') >= 0 ? 'query_id=TEST&user=%7B%7D&auth_date=1&hash=x' : '', version: '7.0', platform: 'android',
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

// Fragmento #m= como lo arma el bot (WebAppData::fragment): ids por diferencia, tipo 0/1, índices de
// moneda/categoría/cuenta, días antes de "d", nota opcional y 1 = nota recortada.
function fragment(obj) { return '#m=' + Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url'); }
function fixture(hoy) {
  return {
    v: 1, t: 1790616300, d: hoy,
    c: ['Comida', 'Transporte', 'Otros'], a: ['Banco', 'Efectivo', 'Tarjeta Visa'],
    m: [
      [104000, 0, 12.5, 1, 0, 0, 1, 'almuerzo con Ana'],       // 104000 · gasto · USD · Comida · Banco · ayer
      [-3, 1, 200, 2, 2, 1, 0],                                // 103997 · ingreso · UYU · Otros · Efectivo · hoy · sin nota
      ['wa-77', 0, 3, 0, 1, 2, 10, 'ñandú en el zoo', 1],      // id literal · cuenta propia · hace 10 días · nota recortada
      [-7, 0, 1500.5, 0, 2, 1, null]                           // 103990 · fecha desconocida
    ]
  };
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
      const expected = '{"v":1,"t":"g","monto":1500.5,"mon":"USD","cat":"Comida","cuenta":"Efectivo","fecha":"hoy","nota":""}';
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
      const expected = '{"v":1,"t":"i","monto":200,"mon":"CUP","cat":"Sueldo","cuenta":"Efectivo","fecha":"hoy","nota":""}';
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
      assert.deepStrictEqual(JSON.parse(s.sent[0]), { v: 1, t: 'g', monto: 7.25, mon: 'CUP', cat: 'Transporte', cuenta: 'Banco', fecha: 'ayer', nota: 'taxi al trabajo' });
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
      assert.strictEqual(json, '{"v":1,"t":"g","monto":42,"mon":"USD","cat":"Otros","cuenta":"Efectivo","fecha":"hoy","nota":""}');
      assert.deepStrictEqual(errors, []);
      await shot(page, '6-fuera-de-telegram-json.png');
      ok('navegador (sin Telegram) -> ' + json);
      await ctx.close();
    }
    // 5) Abierta desde el menú (initData presente): sendData no sirve, aviso visible y no envía
    {
      const { ctx, page, errors } = await newPage(browser, base, '?menu=1', true);
      assert.ok(await page.isVisible('#notice'));
      assert.ok((await page.textContent('#notice')).includes('➕ Anotar'));
      await keys(page, ['5']);
      await mainClick(page);
      await page.click('#cats button[data-cat="Otros"]');
      await mainClick(page); await mainClick(page);
      const s = await tg(page);
      assert.deepStrictEqual(s.sent, []);
      assert.ok(await page.isVisible('#notice'));
      assert.deepStrictEqual(errors, []);
      ok('abierta desde el menú -> aviso, sin envío');
      await ctx.close();
    }
    // 6) Lista desde el fragmento (con los parámetros que Telegram añade al mismo fragmento)
    {
      const q = fragment(fixture(hoy)) + '&tgWebAppData=&tgWebAppVersion=7.0&tgWebAppPlatform=android';
      const { ctx, page, errors } = await newPage(browser, base, q, true);
      assert.ok(await page.isVisible('#s1'));                         // arranca en «Nuevo»
      assert.strictEqual(await page.textContent('#tabList'), '📋 Movimientos (4)');
      await page.click('#tabs button[data-view="list"]');
      assert.ok(await page.isVisible('#sL'));
      assert.ok(await page.isHidden('#listEmpty'));
      const items = await page.$$eval('#list .item', (b) => b.map((x) => [x.getAttribute('data-id'), x.querySelector('b').textContent, x.querySelector('small').textContent, x.querySelector('.ia').textContent]));
      assert.deepStrictEqual(items, [
        ['104000', 'almuerzo con Ana', 'Ayer · Comida · Banco', '−12,50 USD'],
        ['103997', 'Otros', 'Hoy · Otros · Efectivo', '+200 UYU'],
        ['wa-77', 'ñandú en el zoo…', ymdInTz(-10).split('-').reverse().join('/').replace(/\/(\d\d)(\d\d)$/, '/$2') + ' · Transporte · Tarjeta Visa', '−3 CUP'],
        ['103990', 'Otros', '¿fecha? · Otros · Efectivo', '−1.500,50 CUP']
      ]);
      assert.ok((await page.textContent('#listAt')).startsWith('Lista del '));
      let s = await tg(page); assert.strictEqual(s.main.visible, false); assert.strictEqual(s.back.visible, false);
      await shot(page, '7-movimientos.png');
      await page.click('#list .item[data-id="104000"]');
      assert.ok(await page.isVisible('#sD'));
      assert.ok((await page.textContent('#detSum')).includes('12,50 USD'));
      s = await tg(page); assert.strictEqual(s.back.visible, true);
      await shot(page, '8-detalle.png');
      await page.evaluate(() => window.__tg.back.cb());
      assert.ok(await page.isVisible('#sL'));
      assert.deepStrictEqual(errors, []);
      ok('lista desde el fragmento -> ' + items.length + ' movimientos');
      await ctx.close();
    }

    // 7) Editar: carga los valores, cambia monto y nota -> op "edit" con el id
    {
      const { ctx, page, errors } = await newPage(browser, base, fragment(fixture(hoy)), true);
      await page.click('#tabs button[data-view="list"]');
      await page.click('#list .item[data-id="104000"]');
      await page.click('#editBtn');
      assert.ok(await page.isVisible('#s1'));
      assert.ok(await page.isHidden('#tabs'));
      assert.strictEqual(await page.textContent('#title'), 'Editar movimiento');
      assert.strictEqual(await page.textContent('#amtNum'), '12,5');
      assert.strictEqual(await page.textContent('#amtCur'), 'USD');
      // atrás desde el paso 1 de la edición vuelve al detalle sin enviar nada
      await page.evaluate(() => window.__tg.back.cb());
      assert.ok(await page.isVisible('#sD'));
      await page.click('#editBtn');
      await keys(page, ['del', 'del', 'del', 'del', '2', '0']);
      assert.strictEqual(await page.textContent('#amtNum'), '20');
      await mainClick(page);                                            // categoría ya elegida
      assert.strictEqual(await page.getAttribute('#cats button.on', 'data-cat'), 'Comida');
      await mainClick(page);
      assert.strictEqual(await page.getAttribute('#cuentas button.on', 'data-cuenta'), 'Banco');
      assert.strictEqual(await page.getAttribute('#fechas button.on', 'data-f'), 'ayer');
      assert.strictEqual(await page.inputValue('#nota'), 'almuerzo con Ana');
      await page.fill('#nota', 'almuerzo con Ana y Pedro');
      await shot(page, '9-editar-detalles.png');
      await mainClick(page);
      let s = await tg(page); assert.strictEqual(s.main.text, 'Guardar cambios');
      assert.ok((await page.textContent('#sum')).includes('20 USD'));
      await mainClick(page);
      s = await tg(page);
      assert.deepStrictEqual(s.sent, ['{"v":1,"op":"edit","id":"104000","t":"g","monto":20,"mon":"USD","cat":"Comida","cuenta":"Banco","fecha":"ayer","nota":"almuerzo con Ana y Pedro"}']);
      assert.deepStrictEqual(errors, []);
      ok('editar -> ' + s.sent[0]);
      await ctx.close();
    }

    // 8) Editar sin tocar la nota recortada (nota:null), cuenta propia y fecha «otra»; ingreso sin nota
    {
      const { ctx, page, errors } = await newPage(browser, base, fragment(fixture(hoy)), true);
      await page.click('#tabs button[data-view="list"]');
      await page.click('#list .item[data-id="wa-77"]');
      await page.click('#editBtn');
      await mainClick(page); await mainClick(page);
      assert.strictEqual(await page.getAttribute('#cuentas button.on', 'data-cuenta'), 'Tarjeta Visa');
      assert.strictEqual(await page.getAttribute('#fechas button.on', 'data-f'), 'otra');
      assert.strictEqual(await page.inputValue('#fechaInput'), ymdInTz(-10));
      assert.ok(await page.isVisible('#notaCut'));
      await mainClick(page);
      assert.ok((await page.textContent('#sum')).includes('ñandú en el zoo… (se conserva)'));
      await mainClick(page);
      let s = await tg(page);
      assert.deepStrictEqual(JSON.parse(s.sent[0]), { v: 1, op: 'edit', id: 'wa-77', t: 'g', monto: 3, mon: 'CUP', cat: 'Transporte', cuenta: 'Tarjeta Visa', fecha: ymdInTz(-10), nota: null });
      ok('editar nota recortada -> ' + s.sent[0]);
      await ctx.close();

      const p2 = await newPage(browser, base, fragment(fixture(hoy)), true);
      await p2.page.click('#tabs button[data-view="list"]');
      await p2.page.click('#list .item[data-id="103997"]');
      await p2.page.click('#editBtn');
      await mainClick(p2.page); await mainClick(p2.page);
      await p2.page.click('#fechas button[data-f="ayer"]');
      await mainClick(p2.page); await mainClick(p2.page);
      s = await tg(p2.page);
      assert.deepStrictEqual(s.sent, ['{"v":1,"op":"edit","id":"103997","t":"i","monto":200,"mon":"UYU","cat":"Otros","cuenta":"Efectivo","fecha":"ayer","nota":""}']);
      assert.deepStrictEqual(errors.concat(p2.errors), []);
      ok('editar ingreso -> ' + s.sent[0]);
      await p2.ctx.close();
    }

    // 9) Borrar con confirmación -> op "del"
    {
      const { ctx, page, errors } = await newPage(browser, base, fragment(fixture(hoy)), true);
      await page.click('#tabs button[data-view="list"]');
      await page.click('#list .item[data-id="103990"]');
      await page.click('#delBtn');
      assert.ok(await page.isVisible('#delConfirm'));
      assert.ok(await page.isHidden('#editBtn'));
      await shot(page, '10-borrar-confirmar.png');
      await page.click('#delNo');                                       // cancelar no envía nada
      assert.ok(await page.isHidden('#delConfirm'));
      assert.deepStrictEqual((await tg(page)).sent, []);
      await page.click('#delBtn');
      await page.click('#delYes');
      const s = await tg(page);
      assert.deepStrictEqual(s.sent, ['{"v":1,"op":"del","id":"103990"}']);
      assert.deepStrictEqual(errors, []);
      ok('borrar -> ' + s.sent[0]);
      await ctx.close();

      // fuera de Telegram: muestra el JSON del borrado
      const p2 = await newPage(browser, base, fragment(fixture(hoy)), false);
      await p2.page.click('#tabs button[data-view="list"]');
      await p2.page.click('#list .item[data-id="wa-77"]');
      await p2.page.click('#delBtn'); await p2.page.click('#delYes');
      assert.strictEqual(await p2.page.textContent('#delJson'), '{"v":1,"op":"del","id":"wa-77"}');
      await p2.ctx.close();
    }

    // 10) Sin fragmento / fragmento roto: aviso «Manda /app»; lista vacía: aviso propio
    {
      for (const q of ['', '#m=esto-no-es-json', '#tgWebAppData=&tgWebAppPlatform=android']) {
        const { ctx, page, errors } = await newPage(browser, base, q, true);
        assert.strictEqual(await page.textContent('#tabList'), '📋 Movimientos');
        await page.click('#tabs button[data-view="list"]');
        assert.strictEqual(await page.textContent('#listEmpty'), 'Manda /app para cargar tus movimientos.');
        assert.strictEqual(await page.$$eval('#list .item', (b) => b.length), 0);
        await page.click('#tabs button[data-view="new"]');               // volver a «Nuevo» sigue funcionando
        assert.ok(await page.isVisible('#s1'));
        assert.deepStrictEqual(errors, []);
        if (!q) await shot(page, '11-sin-fragmento.png');
        await ctx.close();
      }
      const { ctx, page } = await newPage(browser, base, fragment({ v: 1, t: 1, d: hoy, c: [], a: [], m: [] }), true);
      await page.click('#tabs button[data-view="list"]');
      assert.ok((await page.textContent('#listEmpty')).startsWith('Todavía no hay movimientos'));
      await ctx.close();
      ok('sin fragmento -> «Manda /app para cargar tus movimientos.»');
    }

    // 11) Fragmento generado por el bot (PHP, WebAppData::url) se decodifica igual
    {
      const botUrl = 'https://mrf3lipe.github.io/gastos-miniapp/?v=3#m=eyJ2IjoxLCJ0IjoxNzkwNjE3NTAwLCJkIjoiMjAyNi0wOS0yOCIsImMiOlsiT3Ryb3MiLCJDb21pZGEiXSwiYSI6WyJFZmVjdGl2byIsIkJhbmNvIl0sIm0iOltbMTIwNSwxLDIwMC43NSwyLDAsMCwwLCJWZW50YSJdLFstMSwwLDE1MDAuNSwwLDEsMCwxXSxbIndhLTc3IiwwLDMsMCwwLDAsOF0sWy0xNCwwLDEyLDEsMSwxLDI2OSwiQWxtdWVyem8gQ29uIEFuYSBZIFBlZHJvIEVuIEVsIENlbnRybyBEZSIsMV0sWzExMCwwLDUsMCwwLDAsbnVsbCwibm90YSDDsWFuZMO6Il1dfQ'; // salida de php: WebAppData::url(...) con los datos de WebAppDataTest::testFragmentFormat
      const { ctx, page, errors } = await newPage(browser, base, botUrl.slice(botUrl.indexOf('#')), true);
      await page.click('#tabs button[data-view="list"]');
      const ids = await page.$$eval('#list .item', (b) => b.map((x) => x.getAttribute('data-id') + '|' + x.querySelector('b').textContent + '|' + x.querySelector('.ia').textContent));
      assert.deepStrictEqual(ids, ['1205|Venta|+200,75 UYU', '1204|Comida|−1.500,50 CUP', 'wa-77|Otros|−3 CUP', '1190|Almuerzo Con Ana Y Pedro En El Centro De…|−12 USD', '1300|nota ñandú|−5 CUP']);
      assert.deepStrictEqual(errors, []);
      ok('fragmento del bot -> ' + ids.length + ' movimientos');
      await ctx.close();
    }

    console.log(`\n${passed} pruebas OK`);
  } catch (e) {
    console.error('FALLO:', e); process.exitCode = 1;
  } finally {
    await browser.close(); srv.close();
  }
})();
