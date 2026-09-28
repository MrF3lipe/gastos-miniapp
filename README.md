# gastos-miniapp

Mini App de Telegram (página estática, sin build) para anotar gastos e ingresos con botones.
No contiene datos ni claves: envía los datos al bot con `Telegram.WebApp.sendData` y se cierra.

## Flujo
1. Gasto / Ingreso, monto con teclado numérico (coma decimal), moneda CUP / USD / UYU.
2. Categoría.
3. Cuenta (Efectivo, Banco, PayPal), fecha (Hoy / Ayer / otra) y nota opcional.
4. Confirmar → Guardar.

Parámetros opcionales de URL: `?mon=USD` preselecciona la moneda; `?bal=texto` muestra una línea informativa arriba (solo texto).
Fuera de Telegram muestra un aviso y, al guardar, el JSON que se enviaría.

## Contrato (v1)
```json
{"v":1,"t":"g|i","monto":1500.5,"mon":"CUP|USD|UYU","cat":"Comida","cuenta":"Efectivo","fecha":"YYYY-MM-DD","nota":""}
```
- `monto`: número positivo, máx. 2 decimales. `nota`: máx. 100 caracteres (puede ser vacía). `fecha`: fecha local del dispositivo.

## Pruebas
```sh
NODE_PATH=/usr/local/lib/node_modules CHROME_PATH=/usr/bin/google-chrome node tests/flow.test.js
```
Requiere `playwright-core`. `SHOTS_DIR=/ruta` guarda capturas 390x844.
