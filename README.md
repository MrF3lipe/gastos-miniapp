# gastos-miniapp

Mini App de Telegram (página estática, sin build) para anotar gastos e ingresos con botones.
No contiene datos ni claves: envía los datos al bot con `Telegram.WebApp.sendData` y se cierra.

## Flujo
1. Gasto / Ingreso, monto con teclado numérico (coma decimal), moneda CUP / USD / UYU.
2. Categoría.
3. Cuenta (Efectivo, Banco, PayPal), fecha (Hoy / Ayer / otra) y nota opcional.
4. Confirmar → Guardar.

Pestaña **Movimientos**: lista los últimos movimientos que el bot pone en el fragmento de la URL del botón
«➕ Anotar» (`#m=…`, el fragmento no llega a GitHub Pages). Al tocar uno: **Editar** (reusa los pasos 1–4 con
los valores cargados) o **Borrar** (con confirmación). Sin fragmento muestra «Manda /app para cargar tus movimientos».

Pestaña **Presupuestos**: lista las categorías de gasto con lo gastado en el mes y el presupuesto mensual por moneda
(✅ < 80 %, ⚠️ ≥ 80 %, 🚨 ≥ 100 %). Al tocar una: elegir moneda y poner, cambiar o quitar el monto.
Abajo, **💱 Tasas de cambio a CUP** (1 USD = X CUP, 1 UYU = Y CUP, con la fecha de actualización): al tocar una se
cambia (hasta 4 decimales, vista previa «100 USD ≈ … CUP») o se quita. Son solo para mostrar: con tasa, el detalle de un
movimiento en USD/UYU y la edición de un presupuesto muestran el equivalente aproximado en CUP.

Pestaña **Fijos**: gastos/ingresos fijos mensuales (luz, internet, sueldo…) que el bot anota solo cada mes el día
indicado. **➕ Agregar fijo** abre un formulario (tipo, monto, moneda, categoría, cuenta, nota ≤ 30, día 1–31); al tocar
uno se edita, se pausa/reanuda (Estado) o se quita (con confirmación). Los pausados se ven atenuados.

**Gráficos** (botón aparte «📈 Gráficos» del teclado, URL con `?tab=g`: abre directo en esta pantalla, sin pestañas
y solo para mostrar; el botón «➕ Anotar» tiene 4 pestañas y no incluye Gráficos). SVG propio, sin librerías ni CDN: selector de moneda CUP / USD / UYU y, si hay tasas,
**Total en CUP** (convierte con las tasas del fragmento; una moneda con datos y sin tasa no se incluye y se avisa).
Torta (dona) de los gastos del mes por categoría con leyenda, montos y porcentajes; barras de gastos contra ingresos
de los últimos 6 meses, con una tabla con los valores exactos. Sin agregados muestra «Sin datos todavía». Usa los
colores del tema de Telegram (claro u oscuro); a ≤ 440 px las pestañas usan nombres cortos (Movim., Presup.).

Parámetros opcionales de URL: `?tab=g` abre en Gráficos (modo solo gráficos); `?mon=USD` preselecciona la moneda; `?bal=texto` muestra una línea informativa arriba (solo texto).
Fuera de Telegram muestra un aviso y, al guardar, el JSON que se enviaría.

## Contrato (v1)
```json
{"v":1,"t":"g|i","monto":1500.5,"mon":"CUP|USD|UYU","cat":"Comida","cuenta":"Efectivo","fecha":"hoy|ayer|YYYY-MM-DD","nota":""}
{"v":1,"op":"edit","id":"<MessageId>","t":"g|i","monto":20,"mon":"USD","cat":"Comida","cuenta":"Banco","fecha":"ayer","nota":"..."}
{"v":1,"op":"del","id":"<MessageId>"}
{"v":1,"op":"budget","cat":"Comida","mon":"CUP","monto":10000}
{"v":1,"op":"fijo_add","t":"g","monto":1500,"mon":"CUP","cat":"Vivienda","cuenta":"Banco","nota":"Luz","dia":1}
{"v":1,"op":"fijo_edit","id":"f<base36>","t":"g","monto":1700,"mon":"CUP","cat":"Vivienda","cuenta":"Banco","nota":"Luz","dia":5,"activo":false}
{"v":1,"op":"fijo_del","id":"f<base36>"}
{"v":1,"op":"rate","mon":"USD|UYU","tasa":400}
```
- `monto`: número positivo, máx. 2 decimales. `nota`: máx. 100 caracteres (puede ser vacía). `fecha`: `hoy`/`ayer`
  (los resuelve el bot con su reloj) u otra fecha elegida.
- En `budget`, `monto` 0 quita el presupuesto de esa categoría y moneda.
- En `rate`, `tasa` = CUP por 1 unidad de `mon` (número ≥ 0, máx. 4 decimales); 0 quita la tasa. CUP no lleva tasa.
- En `edit`, `"nota":null` = conservar la descripción actual (se usa cuando la nota llegó recortada y no se tocó).

## Fragmento `#m=` (lo arma el bot)
base64url (sin `=`) de
`{"v":1,"t":<unix>,"d":"YYYY-MM-DD","c":[categorías],"a":[cuentas],"m":[[id,tipo,monto,monIdx,catIdx,cuentaIdx,díasAntes(,nota(,1))],…]}`:
id entero = diferencia con el id numérico anterior (el primero, absoluto), texto = id literal; tipo 0 gasto / 1 ingreso;
monIdx en `CUP, USD, UYU`; díasAntes respecto de `d` (`null` = desconocida); `1` final = nota recortada.
Si hay presupuestos: `"b":[[catIdx,monIdx,presupuesto,gastadoEnElMesDe_d]]` (nunca se recortan).
Si hay fijos: `"f":[[id,tipo,monto,monIdx,catIdx,cuentaIdx,día,activo(,nota)]]` (tampoco se recortan).
Si hay tasas: `"r":[[monIdx,tasa,díasAntesDeLaActualización|null]]` (tampoco se recortan).
Gráficos (solo para mostrar): `"p":[[monIdx,catIdx,monto,catIdx,monto,…],…]` gastos del mes de `d` por categoría
(mayor primero) y `"h":[[monIdx,g1..g6,i1..i6],…]` gastos e ingresos de los 6 meses que terminan en el de `d`, del más
viejo al actual. CUP y UYU en unidades, USD con centavos. Solo van en el fragmento del botón «📈 Gráficos» (`?tab=g`),
que lleva `"m":[]`, las tasas (para «Total en CUP») y los gráficos; si alguna vez no entrara, la torta se queda con las
5 categorías mayores por moneda (el resto en «Otros»). El fragmento de «➕ Anotar» no lleva `p`/`h`.
Telegram añade sus parámetros al mismo fragmento (`#m=…&tgWebAppData=…`), por eso se lee solo `m=`.

## Pruebas
```sh
NODE_PATH=/usr/local/lib/node_modules CHROME_PATH=/usr/bin/google-chrome node tests/flow.test.js
```
Requiere `playwright-core`. `SHOTS_DIR=/ruta` guarda capturas 390x844; las de Gráficos (claro/oscuro, 360/390/420 px)
van siempre a `/workspace/miniapp-shots/` (`fase5-*.png` en modo `?tab=g`, `fase6-graficos-*` y `fase6-anotar-*` a 360/420 px).
