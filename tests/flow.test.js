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
      await page.click('#tabs button[data-view="list"]');
      assert.ok(await page.isVisible('#sL'));
      assert.strictEqual(await page.textContent('#steps'), '4');              // cantidad de movimientos
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
        assert.strictEqual(await page.textContent('#tabList .tl'), 'Movimientos'); // nombre fijo
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

    // 12) Presupuestos desde el fragmento (clave "b"): lista con gastado / presupuesto y nivel
    const withBudgets = () => {
      const f = fixture(hoy);
      f.c.push('Supermercado');
      f.b = [[0, 0, 10000, 8200], [0, 1, 50, 60], [1, 2, 300, 0], [3, 0, 500, 100]];
      return fragment(f);
    };
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    {
      const { ctx, page, errors } = await newPage(browser, base, withBudgets(), true);
      await page.click('#tabs button[data-view="budgets"]');
      assert.ok(await page.isVisible('#sB'));
      assert.strictEqual(await page.textContent('#title'), 'Presupuestos');
      assert.ok((await page.textContent('#budNote')).startsWith('Gastado en ' + MESES[+hoy.slice(5, 7) - 1] + ' ' + hoy.slice(0, 4)));
      const rows = await page.$$eval('#budList .item', (b) => b.map((x) => [x.getAttribute('data-cat'), x.querySelector('small').textContent, x.querySelector('.lv').textContent]));
      assert.strictEqual(rows.length, 12);                               // 11 categorías de gasto + la propia
      assert.deepStrictEqual(rows[0], ['Comida', '8.200 / 10.000 CUP · 60 / 50 USD', '🚨 120%']);
      assert.deepStrictEqual(rows[1], ['Transporte', '0 / 300 UYU', '✅ 0%']);
      assert.deepStrictEqual(rows[2], ['Vivienda', 'Sin presupuesto', '＋']);
      assert.deepStrictEqual(rows[11], ['Supermercado', '100 / 500 CUP', '✅ 20%']);
      let s = await tg(page); assert.strictEqual(s.main.visible, false); assert.strictEqual(s.back.visible, false);
      await shot(page, '12-presupuestos.png');

      // cambiar Comida CUP
      await page.click('#budList .item[data-cat="Comida"]');
      assert.ok(await page.isVisible('#sBE'));
      assert.ok(await page.isHidden('#tabs'));
      assert.strictEqual(await page.textContent('#title'), 'Comida');
      assert.strictEqual(await page.getAttribute('#budMon button.on', 'data-mon'), 'CUP');
      assert.strictEqual(await page.inputValue('#budAmt'), '10.000');
      assert.strictEqual(await page.textContent('#budInfo'), 'Gastado este mes: 8.200 CUP de 10.000 (82%).');
      assert.ok(await page.isVisible('#budDel'));
      s = await tg(page); assert.strictEqual(s.back.visible, true);
      await shot(page, '13-presupuesto-editar.png');
      await page.fill('#budAmt', '12.000');
      await page.click('#budSave');
      s = await tg(page);
      assert.deepStrictEqual(s.sent, ['{"v":1,"op":"budget","cat":"Comida","mon":"CUP","monto":12000}']);
      assert.deepStrictEqual(errors, []);
      ok('presupuestos desde el fragmento + cambiar -> ' + s.sent[0]);
      await ctx.close();
    }

    // 13) Poner uno nuevo (otra moneda), monto inválido no envía; quitar envía monto 0; atrás vuelve a la lista
    {
      const { ctx, page, errors } = await newPage(browser, base, withBudgets(), true);
      await page.click('#tabs button[data-view="budgets"]');
      await page.click('#budList .item[data-cat="Vivienda"]');
      await page.click('#budMon button[data-mon="USD"]');
      assert.strictEqual(await page.inputValue('#budAmt'), '');
      assert.ok(await page.isHidden('#budDel'));
      assert.strictEqual(await page.textContent('#budSave'), 'Poner presupuesto');
      for (const bad of ['', 'abc', '0', '1,234', '-5']) {
        await page.fill('#budAmt', bad);
        await page.click('#budSave');
        assert.ok((await page.getAttribute('#budInfo', 'class')).includes('err'), bad);
      }
      assert.deepStrictEqual((await tg(page)).sent, []);
      await page.fill('#budAmt', '1.500,5');
      await page.click('#budSave');
      assert.deepStrictEqual((await tg(page)).sent, ['{"v":1,"op":"budget","cat":"Vivienda","mon":"USD","monto":1500.5}']);
      ok('poner presupuesto -> ' + (await tg(page)).sent[0]);
      await ctx.close();

      const p2 = await newPage(browser, base, withBudgets(), true);
      await p2.page.click('#tabs button[data-view="budgets"]');
      await p2.page.click('#budList .item[data-cat="Comida"]');
      await p2.page.click('#budMon button[data-mon="USD"]');
      assert.strictEqual(await p2.page.inputValue('#budAmt'), '50');
      assert.strictEqual(await p2.page.textContent('#budInfo'), 'Gastado este mes: 60 USD de 50 (120%).');
      await p2.page.evaluate(() => window.__tg.back.cb());              // atrás: lista, sin enviar
      assert.ok(await p2.page.isVisible('#sB'));
      await p2.page.click('#budList .item[data-cat="Comida"]');
      await p2.page.click('#budMon button[data-mon="USD"]');
      await p2.page.click('#budDel');
      const s = await tg(p2.page);
      assert.deepStrictEqual(s.sent, ['{"v":1,"op":"budget","cat":"Comida","mon":"USD","monto":0}']);
      assert.deepStrictEqual(errors.concat(p2.errors), []);
      ok('quitar presupuesto -> ' + s.sent[0]);
      await p2.ctx.close();
    }

    // 14) Sin fragmento: aviso, todas las categorías sin presupuesto y se puede poner uno (fuera de Telegram, JSON)
    {
      const { ctx, page, errors } = await newPage(browser, base, '', false);
      await page.click('#tabs button[data-view="budgets"]');
      assert.ok((await page.textContent('#budNote')).startsWith('Manda /app para ver tus presupuestos'));
      const rows = await page.$$eval('#budList .item small', (b) => b.map((x) => x.textContent));
      assert.strictEqual(rows.length, 11);
      assert.ok(rows.every((r) => r === 'Sin presupuesto'));
      await page.click('#budList .item[data-cat="Comida"]');
      assert.strictEqual(await page.textContent('#budInfo'), 'Sin datos del mes (manda /app para verlos).');
      await page.fill('#budAmt', '5000');
      await page.click('#budSave');
      assert.strictEqual(await page.textContent('#budJson'), '{"v":1,"op":"budget","cat":"Comida","mon":"CUP","monto":5000}');
      await page.click('#back');
      assert.ok(await page.isVisible('#sB'));
      assert.deepStrictEqual(errors, []);
      ok('presupuestos sin fragmento -> aviso y alta posible');
      await ctx.close();
    }

    // 15) Fragmento con presupuestos generado por el bot (PHP)
    {
      const botUrl = 'https://mrf3lipe.github.io/gastos-miniapp/?v=4#m=eyJ2IjoxLCJ0IjoxNzkwNjE3NTAwLCJkIjoiMjAyNi0wOS0yOCIsImMiOlsiQ29taWRhIiwiU3VtaW5pc3Ryb3MgKGx1eiwgYWd1YSwgZ2FzLCBldGMuKSJdLCJhIjpbIkVmZWN0aXZvIl0sIm0iOltbNzcsMCw4MjAwLDAsMCwwLDAsIlBhbiJdXSwiYiI6W1swLDAsMTAwMDAsODIwMF0sWzEsMSw0MC41LDQ1LjI1XV19'; // php: WebAppData::url(...) con 2 presupuestos
      const { ctx, page, errors } = await newPage(browser, base, botUrl.slice(botUrl.indexOf('#')), true);
      await page.click('#tabs button[data-view="budgets"]');
      const rows = await page.$$eval('#budList .item', (b) => b.map((x) => x.getAttribute('data-cat') + '|' + x.querySelector('small').textContent + '|' + x.querySelector('.lv').textContent));
      assert.ok(rows.includes('Comida|8.200 / 10.000 CUP|⚠️ 82%'), rows.join('\n'));
      assert.ok(rows.includes('Suministros (luz, agua, gas, etc.)|45,25 / 40,50 USD|🚨 111%'), rows.join('\n'));
      assert.deepStrictEqual(errors, []);
      ok('presupuestos del bot -> ' + rows.filter((r) => !r.includes('Sin presupuesto')).length + ' con presupuesto');
      await ctx.close();
    }

    // 16) Pestaña Fijos desde el fragmento: 4 pestañas caben, lista con pausados
    {
      const f = fixture(hoy);
      f.c.push('Suministros (luz, agua, gas, etc.)', 'Sueldo');
      f.f = [['fk3x9', 0, 1500, 0, 3, 0, 5, 1, 'Luz'], ['fk3xa', 1, 20.5, 1, 4, 1, 31, 0], ['fbad', 0, 0, 0, 0, 0, 1, 1], ['123', 0, 5, 0, 0, 0, 1, 1]];
      const { ctx, page, errors } = await newPage(browser, base, fragment(f), true);
      const fits = await page.$$eval('#tabs button', (bs) => bs.map((b) => b.querySelector('.tl').scrollWidth <= b.querySelector('.tl').clientWidth + 1 && b.getBoundingClientRect().width >= 70));
      assert.deepStrictEqual(fits, [true, true, true, true, true]);          // 5 pestañas (con Gráficos)
      await page.click('#tabFix');
      assert.strictEqual(await page.textContent('#title'), 'Fijos');
      assert.strictEqual(await page.textContent('#steps'), '2');                 // los 2 inválidos se ignoran
      const rows = await page.$$eval('#fxList .item', (b) => b.map((x) => [x.getAttribute('data-id'), x.className, x.querySelector('b').textContent, x.querySelector('small').textContent, x.querySelector('.ia').textContent].join('|')));
      assert.deepStrictEqual(rows, [
        'fk3x9|item|Luz|Día 5 · Suministros (luz, agua, gas, etc.) · Banco|−1.500 CUP',
        'fk3xa|item off|Sueldo|Día 31 · Sueldo · Efectivo · ⏸ pausado|+20,50 USD'
      ]);
      const s = await tg(page); assert.strictEqual(s.main.visible, false); assert.strictEqual(s.back.visible, false);
      await shot(page, '16-fijos.png');
      assert.deepStrictEqual(errors, []);
      ok('fijos del fragmento -> 2 en la lista, pausado atenuado, 5 pestañas caben');

      // 17) editar: monto, día y pausar -> fijo_edit exacto (por sendData)
      await page.click('#fxList .item[data-id="fk3x9"]');
      assert.strictEqual(await page.textContent('#title'), 'Editar fijo');
      assert.strictEqual(await page.inputValue('#fxAmt'), '1.500');
      assert.strictEqual(await page.inputValue('#fxCat'), 'Suministros (luz, agua, gas, etc.)');
      assert.strictEqual(await page.inputValue('#fxDia'), '5');
      assert.ok(await page.isVisible('#fxActBox'));
      assert.strictEqual((await tg(page)).back.visible, true);
      await page.fill('#fxAmt', '1.700,5');
      await page.fill('#fxDia', '10');
      await page.click('#fxAct button[data-a="0"]');
      await shot(page, '17-fijo-editar.png');
      await page.click('#fxSave');
      let sent = (await tg(page)).sent;
      assert.deepStrictEqual(sent.map((x) => JSON.parse(x)), [{ v: 1, op: 'fijo_edit', id: 'fk3x9', t: 'g', monto: 1700.5, mon: 'CUP', cat: 'Suministros (luz, agua, gas, etc.)', cuenta: 'Banco', nota: 'Luz', dia: 10, activo: false }]);
      ok('editar fijo -> fijo_edit con activo false');
      await ctx.close();
    }

    // 18) quitar con confirmación y reanudar un pausado (sin Telegram: JSON en pantalla)
    {
      const f = fixture(hoy);
      f.c.push('Sueldo');
      f.f = [['fk3xa', 1, 20.5, 1, 3, 1, 31, 0]];
      const { ctx, page, errors } = await newPage(browser, base, fragment(f), false);
      await page.click('#tabFix');
      await page.click('#fxList .item');
      assert.ok(await page.isVisible('#fxAct button[data-a="0"].on'));
      await page.click('#fxAct button[data-a="1"]');
      await page.click('#fxSave');
      assert.strictEqual(await page.textContent('#fxJson'), '{"v":1,"op":"fijo_edit","id":"fk3xa","t":"i","monto":20.5,"mon":"USD","cat":"Sueldo","cuenta":"Efectivo","nota":"","dia":31,"activo":true}');
      await page.click('#fxDel');
      assert.ok(await page.isVisible('#fxConfirm')); assert.ok(await page.isHidden('#fxSave'));
      await page.click('#fxNo');
      assert.ok(await page.isHidden('#fxConfirm')); assert.ok(await page.isVisible('#fxDel'));
      await page.click('#fxDel'); await page.click('#fxYes');
      assert.strictEqual(await page.textContent('#fxJson'), '{"v":1,"op":"fijo_del","id":"fk3xa"}');
      await page.click('#back');
      assert.ok(await page.isVisible('#sF'));
      assert.deepStrictEqual(errors, []);
      ok('reanudar y quitar fijo (con confirmación)');
      await ctx.close();
    }

    // 19) agregar fijo sin fragmento: aviso, validación de monto y día, ingreso cambia categorías
    {
      const { ctx, page, errors } = await newPage(browser, base, '', false);
      await page.click('#tabFix');
      assert.ok((await page.textContent('#fxNote')).includes('Manda /app'));
      await page.click('#fxNew');
      assert.strictEqual(await page.textContent('#title'), 'Nuevo fijo');
      assert.ok(await page.isHidden('#fxActBox')); assert.ok(await page.isHidden('#fxDel'));
      assert.strictEqual(await page.inputValue('#fxDia'), '1');
      await page.click('#fxSave');
      assert.ok((await page.textContent('#fxInfo')).includes('monto mayor que 0'));
      await page.fill('#fxAmt', '3.000');
      await page.fill('#fxDia', '32');
      await page.click('#fxSave');
      assert.strictEqual(await page.textContent('#fxInfo'), 'El día del mes va de 1 a 31.');
      assert.ok(await page.isHidden('#fxOut'));
      await page.fill('#fxDia', '15');
      await page.click('#fxTipo button[data-t="i"]');
      assert.strictEqual(await page.inputValue('#fxCat'), 'Sueldo');
      assert.strictEqual(await page.inputValue('#fxAmt'), '3.000');            // cambiar tipo no borra lo escrito
      await page.click('#fxTipo button[data-t="g"]');
      await page.selectOption('#fxCat', 'Vivienda');
      await page.click('#fxCuentas button[data-cuenta="Banco"]');
      await page.click('#fxMon button[data-mon="USD"]');
      await page.fill('#fxNota', '  =Alquiler   del  depto con nombre muy largo  ');
      assert.strictEqual(await page.textContent('#fxNotaCount'), '30/30');
      await page.click('#fxSave');
      assert.strictEqual(await page.textContent('#fxJson'), '{"v":1,"op":"fijo_add","t":"g","monto":3000,"mon":"USD","cat":"Vivienda","cuenta":"Banco","nota":"Alquiler del depto con n","dia":15}');
      await shot(page, '19-fijo-nuevo.png');
      assert.deepStrictEqual(errors, []);
      ok('agregar fijo -> validación y fijo_add limpio');
      await ctx.close();
    }

    // 20) Fragmento con fijos generado por el bot (PHP)
    {
      const botUrl = 'https://mrf3lipe.github.io/gastos-miniapp/?v=5#m=eyJ2IjoxLCJ0IjoxNzkwNjE2MzAwLCJkIjoiMjAyNi0wOS0yOCIsImMiOlsiU3VtaW5pc3Ryb3MgKGx1eiwgYWd1YSwgZ2FzLCBldGMuKSIsIlN1ZWxkbyJdLCJhIjpbIkJhbmNvIiwiRWZlY3Rpdm8iXSwibSI6W1siZmlqbzpmazE6MjAyNi0wOSIsMCwxNTAwLDAsMCwwLDI3LCJMdXoiXV0sImYiOltbImZrMSIsMCwxNTAwLDAsMCwwLDEsMSwiTHV6Il0sWyJmazIiLDEsMjAuNSwxLDEsMSwzMSwwXV19'; // php: WebAppData::url(...) con 2 fijos y 1 movimiento fijo:fk1:2026-09
      const { ctx, page, errors } = await newPage(browser, base, botUrl.slice(botUrl.indexOf('#')), true);
      await page.click('#tabFix');
      const rows = await page.$$eval('#fxList .item', (b) => b.map((x) => x.getAttribute('data-id') + '|' + x.querySelector('b').textContent + '|' + x.querySelector('small').textContent + '|' + x.querySelector('.ia').textContent));
      assert.deepStrictEqual(rows, ['fk1|Luz|Día 1 · Suministros (luz, agua, gas, etc.) · Banco|−1.500 CUP', 'fk2|Sueldo|Día 31 · Sueldo · Efectivo · ⏸ pausado|+20,50 USD']);
      await page.click('#tabList');
      assert.strictEqual(await page.getAttribute('#list .item', 'data-id'), 'fijo:fk1:2026-09');   // el movimiento anotado por el fijo se puede editar
      assert.deepStrictEqual(errors, []);
      ok('fijos del bot -> ' + rows.length + ' fijos');
      await ctx.close();
    }

    // 21) Tasas desde el fragmento: sección en Presupuestos, equivalente en CUP en presupuesto y detalle
    {
      const f = fixture(hoy);
      f.b = [[0, 1, 100, 12.5]];
      f.r = [[1, 410.5, 0], [2, 9.5, 8], [0, 1, 0], [1, -3, 0]];                 // CUP y tasa negativa se ignoran
      const { ctx, page, errors } = await newPage(browser, base, fragment(f), true);
      await page.click('#tabBud');
      const p8 = ymdInTz(-8).split('-');
      const rows = await page.$$eval('#rateList .item', (b) => b.map((x) => x.getAttribute('data-rate') + '|' + x.querySelector('b').textContent + '|' + x.querySelector('small').textContent));
      assert.deepStrictEqual(rows, ['USD|1 USD = 410,5 CUP|Actualizada hoy', 'UYU|1 UYU = 9,5 CUP|Actualizada el ' + p8[2] + '/' + p8[1] + '/' + p8[0].slice(2)]);
      if (SHOTS) await page.locator('#rateList').screenshot({ path: path.join(SHOTS, '21-tasas.png') });
      await page.click('#budList .item[data-cat="Comida"]');
      assert.strictEqual(await page.textContent('#budInfo'), 'Gastado este mes: 12,50 USD de 100 (12%). Presupuesto ≈ 41.050 CUP.');
      await page.evaluate(() => window.__tg.back.cb());
      await page.click('#tabList');
      await page.click('#list .item[data-id="104000"]');                          // 12,50 USD
      const det = await page.$$eval('#detSum .row', (r) => r.map((x) => x.textContent));
      assert.deepStrictEqual(det.slice(1, 3), ['Monto12,50 USD', 'En CUP≈ 5.131,25 CUP']);
      await page.evaluate(() => window.__tg.back.cb()); await page.click('#list .item[data-id="103990"]');   // CUP: sin fila extra
      assert.ok(!(await page.textContent('#detSum')).includes('En CUP'));
      assert.deepStrictEqual(errors, []);
      ok('tasas del fragmento -> 2 tasas, equivalente en CUP en presupuesto y detalle');

      // 22) cambiar la tasa de USD (por sendData), con vista previa y validación
      await page.evaluate(() => window.__tg.back.cb()); await page.click('#tabBud');
      await page.click('#rateList .item[data-rate="USD"]');
      assert.strictEqual(await page.textContent('#title'), 'Tasa USD');
      assert.strictEqual(await page.inputValue('#rateAmt'), '410,5');
      assert.strictEqual(await page.textContent('#rateInfo'), '100 USD ≈ 41.050 CUP. Actual: 410,5 (Hoy).');
      assert.ok(await page.isVisible('#rateDel'));
      await page.fill('#rateAmt', '4,12345');
      await page.click('#rateSave');
      assert.ok((await page.textContent('#rateInfo')).includes('hasta 4 decimales'));
      assert.deepStrictEqual((await tg(page)).sent, []);
      await page.fill('#rateAmt', '1.250,1234');
      assert.ok((await page.textContent('#rateInfo')).startsWith('100 USD ≈ 125.012,34 CUP.'));
      await shot(page, '22-tasa-editar.png');
      await page.click('#rateSave');
      assert.deepStrictEqual((await tg(page)).sent.map((x) => JSON.parse(x)), [{ v: 1, op: 'rate', mon: 'USD', tasa: 1250.1234 }]);
      ok('cambiar tasa -> {"v":1,"op":"rate","mon":"USD","tasa":1250.1234}');
      await ctx.close();
    }

    // 23) sin fragmento: tasas «sin tasa», poner y quitar (JSON en pantalla)
    {
      const { ctx, page, errors } = await newPage(browser, base, '', false);
      await page.click('#tabBud');
      const rows = await page.$$eval('#rateList .item', (b) => b.map((x) => x.querySelector('b').textContent + '|' + x.querySelector('small').textContent));
      assert.deepStrictEqual(rows, ['1 USD = sin tasa|Manda /app para ver la actual', '1 UYU = sin tasa|Manda /app para ver la actual']);
      await page.click('#rateList .item[data-rate="UYU"]');
      assert.ok(await page.isHidden('#rateDel'));
      assert.strictEqual(await page.textContent('#rateSave'), 'Poner tasa');
      await page.fill('#rateAmt', '9,5');
      await page.click('#rateSave');
      assert.strictEqual(await page.textContent('#rateJson'), '{"v":1,"op":"rate","mon":"UYU","tasa":9.5}');
      await page.click('#back');
      assert.ok(await page.isVisible('#sB'));
      assert.deepStrictEqual(errors, []);
      ok('poner tasa sin fragmento -> {"v":1,"op":"rate","mon":"UYU","tasa":9.5}');
      await ctx.close();
    }

    // 24) quitar tasa + fragmento generado por el bot (PHP)
    {
      const botUrl = 'https://mrf3lipe.github.io/gastos-miniapp/?v=6#m=eyJ2IjoxLCJ0IjoxNzkwNjE2MzAwLCJkIjoiMjAyNi0wOS0yOCIsImMiOlsiQ29taWRhIl0sImEiOlsiRWZlY3Rpdm8iXSwibSI6W1s1MDEsMCwxNS41LDEsMCwwLDAsImFsbXVlcnpvIl1dLCJiIjpbWzAsMSwxMDAsMTUuNV1dLCJyIjpbWzEsNDEwLjUsMV0sWzIsOS41LDhdXX0'; // php: WebAppData::url(...) con 1 movimiento USD, 1 presupuesto USD y 2 tasas
      const { ctx, page, errors } = await newPage(browser, base, botUrl.slice(botUrl.indexOf('#')), false);
      await page.click('#tabBud');
      const rows = await page.$$eval('#rateList .item b', (b) => b.map((x) => x.textContent));
      assert.deepStrictEqual(rows, ['1 USD = 410,5 CUP', '1 UYU = 9,5 CUP']);
      await page.click('#rateList .item[data-rate="UYU"]');
      await page.click('#rateDel');
      assert.strictEqual(await page.textContent('#rateJson'), '{"v":1,"op":"rate","mon":"UYU","tasa":0}');
      await page.click('#back'); await page.click('#tabList'); await page.click('#list .item');
      assert.ok((await page.textContent('#detSum')).includes('≈ 6.362,75 CUP'));    // 15,50 USD x 410,5
      assert.deepStrictEqual(errors, []);
      ok('tasas del bot -> 2 tasas; quitar -> tasa 0');
      await ctx.close();
    }

    // ---- Gráficos ----
    const CH_URL = 'https://mrf3lipe.github.io/gastos-miniapp/?v=7#m=eyJ2IjoxLCJ0IjoxNzkwNjE2MzAwLCJkIjoiMjAyNi0wOS0yOCIsImMiOlsiQ29taWRhIiwiU3VlbGRvIiwiVHJhbnNwb3J0ZSIsImNvbWlkYSIsIlJlZ2Fsb3MiLCJGcmVlbGFuY2UiLCJWaWFqZXMiXSwiYSI6WyJFZmVjdGl2byJdLCJtIjpbWzcwMSwwLDE1MDAuNSwwLDAsMCwwLCJhbG11ZXJ6byJdLFsxLDEsMjAwMDAsMCwxLDAsMV0sWy0yLDAsMzAwLDAsMiwwLDEsInRheGkiXSxbLTEsMCwxMi4yNSwxLDMsMCwyLCJwaXp6YSJdLFstMSwwLDI1MC42LDIsNCwwLDMsImZsb3JlcyJdLFstNDgsMCw4MDAsMCwwLDAsNDksIngiXSxbLTMwLDEsMTAwLDEsNSwwLDYzLCJ4Il0sWy0yMCwwLDQwLDEsNiwwLDExMCwieCJdXSwiciI6W1sxLDQwMCwxXV0sInAiOltbMCwwLDE1MDEsMiwzMDBdLFsxLDAsMTIuMjVdLFsyLDQsMjUxXV0sImgiOltbMCwwLDAsMCwwLDgwMCwxODAxLDAsMCwwLDAsMCwyMDAwMF0sWzEsMCwwLDQwLDAsMCwxMi4yNSwwLDAsMCwxMDAsMCwwXSxbMiwwLDAsMCwwLDAsMjUxLDAsMCwwLDAsMCwwXV19'; // php /tmp gen: WebAppData::url(...) con Charts::aggregate (CUP, USD, UYU) y tasa USD 400
    const DARK = `(() => { const v = { 'bg-color': '#17212b', 'secondary-bg-color': '#232e3c', 'text-color': '#f5f5f5', 'hint-color': '#708499',
      'link-color': '#6ab3f3', 'button-color': '#5288c1', 'button-text-color': '#ffffff', 'destructive-text-color': '#ec3942' };
      document.addEventListener('DOMContentLoaded', () => { for (const k in v) document.documentElement.style.setProperty('--tg-theme-' + k, v[k]); document.body.style.colorScheme = 'dark'; }); })();`;
    const OUT = '/workspace/miniapp-shots';
    fs.mkdirSync(OUT, { recursive: true });
    const chartState = (page) => page.evaluate(() => ({
      chips: Array.from(document.querySelectorAll('#gMon .chip')).map((c) => c.textContent + (c.classList.contains('on') ? '*' : '')),
      pie: Array.from(document.querySelectorAll('#gPie circle[data-cat]')).map((c) => c.getAttribute('data-cat') + '=' + c.getAttribute('data-v')),
      arcs: Array.from(document.querySelectorAll('#gPie circle[data-cat]')).map((c) => Math.round(parseFloat(c.getAttribute('stroke-dasharray')) * 1000 / (2 * Math.PI * 70)) / 10),
      legend: Array.from(document.querySelectorAll('#gLeg .lg')).map((r) => Array.from(r.querySelectorAll('span')).map((x) => x.textContent).join('|')),
      total: document.getElementById('gPieTot').textContent + ' ' + document.getElementById('gPieCur').textContent,
      g: Array.from(document.querySelectorAll('#gBars rect.bg')).map((r) => +r.getAttribute('data-v')),
      i: Array.from(document.querySelectorAll('#gBars rect.bi')).map((r) => +r.getAttribute('data-v')),
      gh: Array.from(document.querySelectorAll('#gBars rect.bg')).map((r) => +r.getAttribute('height')),
      ih: Array.from(document.querySelectorAll('#gBars rect.bi')).map((r) => +r.getAttribute('height')),
      months: Array.from(document.querySelectorAll('#gBars text[text-anchor="middle"]')).map((t) => t.textContent),
      axis: Array.from(document.querySelectorAll('#gBars text[text-anchor="end"]')).map((t) => t.textContent),
      tbl: Array.from(document.querySelectorAll('#gTbl .tr:not(.th)')).map((r) => Array.from(r.children).map((x) => x.textContent).join('|')),
      note: document.getElementById('gNote').classList.contains('hidden') ? '' : document.getElementById('gNote').textContent,
      empty: document.getElementById('gEmpty').classList.contains('hidden') ? '' : document.getElementById('gEmpty').textContent,
      body: !document.getElementById('gBody').classList.contains('hidden'),
    }));

    // 25) fragmento del bot (PHP): torta y barras con los valores exactos; cambian con el selector de moneda
    {
      const { ctx, page, errors } = await newPage(browser, base, CH_URL.slice(CH_URL.indexOf('#')), true);
      await page.click('#tabCh');
      assert.ok(await page.isVisible('#sG'));
      assert.strictEqual(await page.textContent('#title'), 'Gráficos');
      assert.strictEqual(await page.textContent('#gPieT'), 'Gastos de septiembre 2026 por categoría');
      let c = await chartState(page);
      assert.deepStrictEqual(c.chips, ['CUP*', 'USD', 'UYU', 'Total en CUP']);
      assert.deepStrictEqual(c.pie, ['Comida=1501', 'Transporte=300']);
      assert.deepStrictEqual(c.arcs, [83.3, 16.7]);                                   // % de la circunferencia
      assert.deepStrictEqual(c.legend, ['🍽️ Comida|1.501 CUP|83%', '🚕 Transporte|300 CUP|17%']);
      assert.strictEqual(c.total, '1.801 CUP');
      assert.deepStrictEqual(c.months, ['abr', 'may', 'jun', 'jul', 'ago', 'sep']);
      assert.deepStrictEqual(c.g, [0, 0, 0, 0, 800, 1801]);
      assert.deepStrictEqual(c.i, [0, 0, 0, 0, 0, 20000]);
      assert.deepStrictEqual(c.axis, ['0', '10 mil', '20 mil']);                        // escala redonda: 20.000
      assert.strictEqual(c.ih[5], 138);                                                  // 20.000 = alto completo
      assert.ok(Math.abs(c.gh[5] - 138 * 1801 / 20000) < 0.01 && Math.abs(c.gh[4] - 138 * 800 / 20000) < 0.01);
      assert.deepStrictEqual(c.gh.slice(0, 4), [0, 0, 0, 0]);                            // meses sin movimientos
      assert.deepStrictEqual(c.tbl, ['sep 26|1.801|20.000', 'ago 26|800|0', 'jul 26|0|0', 'jun 26|0|0', 'may 26|0|0', 'abr 26|0|0']);
      assert.strictEqual(c.note, '');
      assert.deepStrictEqual(await page.$$eval('#gTbl .tr[data-m="2026-08"] span', (x) => x.map((e) => e.className)), ['', 'g', 'z']);   // ceros en gris
      const chipsTop = await page.$$eval('#gMon .chip', (x) => new Set(x.map((e) => Math.round(e.getBoundingClientRect().top))).size);
      assert.strictEqual(chipsTop, 1);                                                   // selector en una sola fila
      await page.screenshot({ path: path.join(OUT, 'fase5-claro-cup.png'), fullPage: true });

      await page.click('#gMon .chip[data-gmon="USD"]');
      c = await chartState(page);
      assert.deepStrictEqual(c.chips, ['CUP', 'USD*', 'UYU', 'Total en CUP']);
      assert.deepStrictEqual(c.pie, ['Comida=12.25']);
      assert.deepStrictEqual(c.legend, ['🍽️ Comida|12,25 USD|100%']);
      assert.deepStrictEqual(c.g, [0, 0, 40, 0, 0, 12.25]);
      assert.deepStrictEqual(c.i, [0, 0, 0, 100, 0, 0]);
      assert.deepStrictEqual(c.axis, ['0', '50', '100']);
      assert.strictEqual(c.tbl[0], 'sep 26|12,25|0');

      await page.click('#gMon .chip[data-gmon="UYU"]');
      c = await chartState(page);
      assert.deepStrictEqual([c.pie, c.g, c.i.every((v) => v === 0)], [['Regalos=251'], [0, 0, 0, 0, 0, 251], true]);

      // Total en CUP: USD x 400, UYU sin tasa -> no incluido (se avisa, no se inventa)
      await page.click('#gMon .chip[data-gmon="TOTAL"]');
      c = await chartState(page);
      assert.deepStrictEqual(c.pie, ['Comida=6401', 'Transporte=300']);                // 1.501 + 12,25 x 400
      assert.deepStrictEqual(c.legend, ['🍽️ Comida|6.401 CUP|96%', '🚕 Transporte|300 CUP|4%']);
      assert.strictEqual(c.total, '6.701 CUP');
      assert.deepStrictEqual(c.g, [0, 0, 16000, 0, 800, 6701]);
      assert.deepStrictEqual(c.i, [0, 0, 0, 40000, 0, 20000]);
      assert.strictEqual(c.note, '≈ Con tasas: 1 USD = 400 CUP. Solo para mostrar. ⚠️ Sin tasa de UYU, no incluido.');
      await page.screenshot({ path: path.join(OUT, 'fase5-claro-total.png'), fullPage: true });
      const s = await tg(page);
      assert.deepStrictEqual([s.sent, s.main.visible, s.back.visible], [[], false, false]);
      await page.click('#tabs button[data-view="list"]');                                 // las otras pestañas siguen andando
      assert.strictEqual(await page.$$eval('#list .item', (x) => x.length), 8);
      await page.click('#tabCh');
      assert.strictEqual((await chartState(page)).chips[3], 'Total en CUP*');            // recuerda la moneda elegida
      assert.deepStrictEqual(errors, []);
      ok('gráficos del bot -> torta y barras exactas en CUP, USD, UYU y Total en CUP (sin tasa de UYU avisado)');
      await ctx.close();
    }

    // 26) tema oscuro de Telegram (themeParams como variables CSS) + capturas
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: TZ, locale: 'es-ES', colorScheme: 'dark' });
      await ctx.route('https://telegram.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
      await ctx.addInitScript(STUB); await ctx.addInitScript(DARK);
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(base + '/' + CH_URL.slice(CH_URL.indexOf('#')));
      await page.click('#tabCh');
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.strictEqual(bg, 'rgb(23, 33, 43)');
      const fills = await page.evaluate(() => ({ g: getComputedStyle(document.querySelector('#gBars rect.bg')).fill, t: getComputedStyle(document.querySelector('#gBars text')).fill,
        leg: getComputedStyle(document.querySelector('#gLeg .lg')).color }));
      assert.deepStrictEqual(fills, { g: 'rgb(236, 57, 66)', t: 'rgb(112, 132, 153)', leg: 'rgb(245, 245, 245)' });
      await page.screenshot({ path: path.join(OUT, 'fase5-oscuro-cup.png'), fullPage: true });
      await page.click('#gMon .chip[data-gmon="TOTAL"]');
      await page.screenshot({ path: path.join(OUT, 'fase5-oscuro-total.png'), fullPage: true });
      await page.click('#gMon .chip[data-gmon="UYU"]');
      await page.screenshot({ path: path.join(OUT, 'fase5-oscuro-uyu.png'), fullPage: true });
      assert.deepStrictEqual(errors, []);
      ok('gráficos en tema oscuro -> colores del tema, capturas en ' + OUT);
      await ctx.close();
    }

    // 27) anchos 360 y 420: sin desborde horizontal, 5 pestañas legibles, torta y barras dentro de la pantalla
    for (const w of [360, 420]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2, timezoneId: TZ, locale: 'es-ES' });
      await ctx.route('https://telegram.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
      await ctx.addInitScript(STUB);
      const page = await ctx.newPage();
      await page.goto(base + '/' + CH_URL.slice(CH_URL.indexOf('#')));
      await page.click('#tabCh');
      const m = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        tabsCut: Array.from(document.querySelectorAll('#tabs .tl')).filter((t) => t.scrollWidth > t.clientWidth + 1).map((t) => t.textContent),
        pie: document.getElementById('gPie').getBoundingClientRect().right <= window.innerWidth,
        bars: document.getElementById('gBars').getBoundingClientRect().right <= window.innerWidth,
        legendCut: Array.from(document.querySelectorAll('#gLeg .lv2')).some((x) => x.getBoundingClientRect().right > window.innerWidth),
        chipRows: new Set(Array.from(document.querySelectorAll('#gMon .chip')).map((e) => Math.round(e.getBoundingClientRect().top))).size,
      }));
      assert.deepStrictEqual(m, { overflow: 0, tabsCut: [], pie: true, bars: true, legendCut: false, chipRows: 1 }, 'ancho ' + w);
      await page.screenshot({ path: path.join(OUT, 'fase5-claro-' + w + '.png'), fullPage: true });
      await ctx.close();
    }
    ok('gráficos a 360 y 420 px -> sin desborde y pestañas legibles');

    // 28) sin datos: sin fragmento, fragmento sin agregados, y moneda sin datos
    {
      let { ctx, page, errors } = await newPage(browser, base, '', true);
      await page.click('#tabCh');
      let c = await chartState(page);
      assert.deepStrictEqual([c.empty, c.body, c.chips], ['Sin datos todavía. Manda /app para cargarlos.', false, []]);
      await ctx.close();
      ({ ctx, page, errors } = await newPage(browser, base, fragment(fixture(hoy)), true));      // fragmento viejo: sin p ni h
      await page.click('#tabCh');
      c = await chartState(page);
      assert.deepStrictEqual([c.empty, c.body, c.chips], ['Sin datos todavía en CUP.', false, ['CUP*', 'USD', 'UYU']]);  // sin tasas: sin «Total»
      await shot(page, '28-graficos-sin-datos.png');
      await ctx.close();
      const f = fixture(hoy);
      f.p = [[1, 0, 12.5]]; f.h = [[1, 0, 0, 0, 0, 0, 12.5, 0, 0, 0, 0, 0, 0]]; f.r = [[2, 9.5, 0]];
      ({ ctx, page, errors } = await newPage(browser, base, fragment(f), true));
      await page.click('#tabCh');
      c = await chartState(page);
      assert.deepStrictEqual([c.chips, c.pie], [['CUP', 'USD*', 'UYU', 'Total en CUP'], ['Comida=12.5']]);   // arranca en la moneda con datos
      await page.click('#gMon .chip[data-gmon="CUP"]');
      assert.strictEqual((await chartState(page)).empty, 'Sin datos todavía en CUP.');
      await page.click('#gMon .chip[data-gmon="TOTAL"]');                                   // solo hay USD y no tiene tasa
      c = await chartState(page);
      assert.deepStrictEqual([c.body, c.empty], [false, 'Sin datos todavía. ⚠️ Sin tasa de USD, no incluido.']);
      // pie vacío pero barras con datos (mes actual sin gastos)
      f.p = []; f.h = [[0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 500]];
      await ctx.close();
      ({ ctx, page, errors } = await newPage(browser, base, fragment(f), true));
      await page.click('#tabCh');
      c = await chartState(page);
      assert.deepStrictEqual([c.chips[0], c.body, c.pie, c.g[0], c.i[5]], ['CUP*', true, [], 100, 500]);
      assert.ok(await page.isVisible('#gPieEmpty'));
      assert.ok(await page.isHidden('#gPieBox'));
      assert.deepStrictEqual(errors, []);
      ok('gráficos sin datos -> «Sin datos todavía» (sin fragmento, sin agregados, por moneda y total sin tasa)');
      await ctx.close();
    }

    console.log(`\n${passed} pruebas OK`);
  } catch (e) {
    console.error('FALLO:', e); process.exitCode = 1;
  } finally {
    await browser.close(); srv.close();
  }
})();
