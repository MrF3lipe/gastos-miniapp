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

Parámetros opcionales de URL: `?mon=USD` preselecciona la moneda; `?bal=texto` muestra una línea informativa arriba (solo texto).
Fuera de Telegram muestra un aviso y, al guardar, el JSON que se enviaría.

## Contrato (v1)
```json
{"v":1,"t":"g|i","monto":1500.5,"mon":"CUP|USD|UYU","cat":"Comida","cuenta":"Efectivo","fecha":"hoy|ayer|YYYY-MM-DD","nota":""}
{"v":1,"op":"edit","id":"<MessageId>","t":"g|i","monto":20,"mon":"USD","cat":"Comida","cuenta":"Banco","fecha":"ayer","nota":"..."}
{"v":1,"op":"del","id":"<MessageId>"}
```
- `monto`: número positivo, máx. 2 decimales. `nota`: máx. 100 caracteres (puede ser vacía). `fecha`: `hoy`/`ayer`
  (los resuelve el bot con su reloj) u otra fecha elegida.
- En `edit`, `"nota":null` = conservar la descripción actual (se usa cuando la nota llegó recortada y no se tocó).

## Fragmento `#m=` (lo arma el bot)
base64url (sin `=`) de
`{"v":1,"t":<unix>,"d":"YYYY-MM-DD","c":[categorías],"a":[cuentas],"m":[[id,tipo,monto,monIdx,catIdx,cuentaIdx,díasAntes(,nota(,1))],…]}`:
id entero = diferencia con el id numérico anterior (el primero, absoluto), texto = id literal; tipo 0 gasto / 1 ingreso;
monIdx en `CUP, USD, UYU`; díasAntes respecto de `d` (`null` = desconocida); `1` final = nota recortada.
Telegram añade sus parámetros al mismo fragmento (`#m=…&tgWebAppData=…`), por eso se lee solo `m=`.

## Pruebas
```sh
NODE_PATH=/usr/local/lib/node_modules CHROME_PATH=/usr/bin/google-chrome node tests/flow.test.js
```
Requiere `playwright-core`. `SHOTS_DIR=/ruta` guarda capturas 390x844.
