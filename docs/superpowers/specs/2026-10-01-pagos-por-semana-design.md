# Diseño — Pagos recibidos por semana (app Contabilidad)

## Objetivo

Una pestaña nueva en Contabilidad que muestre los pagos de clientes recibidos,
organizados por semana del mes, con el detalle de a qué órdenes de venta y a
qué facturas se aplicó cada pago.

## Los datos (verificado el 2026-10-01)

`books.customer_payments` ya replica la cabecera de cada pago y
`books.customer_payment_invoices` el desglose por factura aplicada (una fila
por `payment_id` × factura; un pago sin ninguna aplicación no tiene fila ahí).
Volumen real: **1.465 pagos**, 2019-11-29 a 2026-09-28 (casi 7 años), **1.471
líneas aplicadas**. Mismo orden de magnitud que anticipos (221) o facturas
(1.259): se carga todo y se agrupa en memoria, sin paginar.

`customer_payment_invoices` no guarda la OV — solo `invoice_id`/
`invoice_number`. El salto hasta la OV ya tiene un camino probado en el
repo (`apps/hub-api/src/contabilidad/source.ts`): **`books.invoices.
salesorder_id`**, poblado al 100 %. `reference_number` de la factura es solo
una etiqueta de visualización, no se usa como enlace.

Ya existe una consulta cercana en `apps/hub-api/src/reconciliation.ts`
(`getPayments`), del Conciliador de Pagos — pero usa `JOIN` normal
(perdería los pagos sin ninguna aplicación) y no llega hasta la OV. No se
reutiliza tal cual; se adapta.

**No existe en todo el repo** ninguna lógica de "semana del mes" — ni ISO-semana
ni bucketing por semana de ningún tipo. Se escribe desde cero.

## Decisiones tomadas

| Pregunta | Decisión |
|---|---|
| Inicio de semana | Lunes. Si el mes no empieza en lunes, la semana 1 queda corta |
| Alcance temporal | Todo el histórico, sin selector de mes/año |
| Agrupación visual | Una fila por semana (con pagos), colapsable, con el detalle de pagos dentro |
| Dónde se calcula la semana | TypeScript puro y testeado, no SQL |
| Quién lo ve | Solo Contabilidad — es información de cobro, igual que los anticipos |
| Columnas configurables | No. Son pocas y fijas; no amerita la maquinaria de `useColumnPrefs` |

## 1. Backend (hub-api)

### La consulta

```sql
SELECT p.payment_id, p.payment_number, p.customer_name, p.date::text AS fecha,
       p.payment_mode, p.reference_number, p.amount, p.unused_amount,
       cpi.invoice_number, cpi.amount_applied,
       so.salesorder_number
  FROM books.customer_payments p
  LEFT JOIN books.customer_payment_invoices cpi ON cpi.payment_id = p.payment_id
  LEFT JOIN books.invoices i ON i.invoice_id = cpi.invoice_id
  LEFT JOIN books.sales_orders so ON so.salesorder_id = i.salesorder_id
 ORDER BY p.date, p.payment_number, cpi.invoice_number
```

`LEFT JOIN` desde `customer_payments`, no `JOIN`: un pago cuyo saldo entero
sigue sin aplicar no debe desaparecer de la vista — es justo el caso que esta
pestaña tiene que hacer visible. Una fila SQL por (pago, factura aplicada); si
no hay ninguna, sale una sola fila con los campos de factura en `NULL`.

### `semanaDelMes(fecha)` — función pura

La regla aprobada: la semana 1 siempre empieza el día 1 del mes y termina en
el primer domingo (o en el fin de mes si es antes); cada semana siguiente es
un bloque lunes-domingo completo, salvo la última si el mes se acaba antes.

```
semanaDelMes(día, díaISOdelDía1) = floor((día − 1 + díaISOdelDía1) / 7) + 1
```

donde `díaISOdelDía1` es el día de la semana del día 1 del mes, `0`=lunes …
`6`=domingo.

Ejemplo, septiembre 2026 (el día 1 es martes, `díaISOdelDía1 = 1`):

| Día del mes | Semana |
|---|---|
| 1 (martes) – 6 (domingo) | 1 |
| 7 (lunes) – 13 (domingo) | 2 |
| 14 – 20 | 3 |
| 21 – 27 | 4 |
| 28 (lunes) – 30 (miércoles) | 5 |

### Agregación — también TypeScript puro

1. Agrupar las filas SQL por `payment_id`: cada pago acumula su lista de
   `{ factura, ov, importe }` (una entrada por línea aplicada; ninguna si no
   hay aplicaciones).
2. La semana se calcula sobre **`p.date`** (fecha del pago), no sobre la
   fecha de aplicación de cada línea: es «pagos recibidos», no «aplicaciones
   registradas».
3. Agrupar los pagos por (año, mes, semana). Cada grupo acumula
   `cantidadPagos`, `totalCobrado` (suma de `amount`) y la lista de pagos.
4. Ordenar los grupos de más reciente a más antiguo.

Un pago con `unused_amount > 0` queda marcado con saldo sin aplicar, conviva
o no con líneas sí aplicadas (aplicación parcial).

### Endpoint

```
GET /contabilidad/pagos
```

Guardado solo por `requireApp(APP_ID)` (no `APP_ID_OV`): es información de
cobro, misma regla que `anticipos-atencion`. Cacheado con `cached()`, clave
`contabilidad:pagos`.

### Contrato de datos

```ts
export interface AplicacionPago {
  factura: string;
  ov: string | null;   // null si la factura no tiene OV enlazada
  importe: number;
}

export interface Pago {
  numero: string;          // payment_number
  cliente: string;
  fecha: string;
  modo: string | null;     // payment_mode
  referencia: string | null;
  importe: number;         // amount
  sinAplicar: number;      // unused_amount
  aplicaciones: AplicacionPago[];
}

export interface SemanaDePagos {
  anio: number;
  mes: number;              // 1-12
  semana: number;            // 1-5
  etiqueta: string;          // "1-6 sep 2026", ya formateada en el servidor
  desde: string;              // ISO
  hasta: string;               // ISO
  cantidadPagos: number;
  totalCobrado: number;
  pagos: Pago[];
}
```

Respuesta: `{ semanas: SemanaDePagos[] }`.

## 2. Portal (app Contabilidad)

**Pestaña nueva en `App.tsx`**: tercera entrada tras «OV pendientes de
facturar» → `'pagos'` / **«Pagos recibidos»**. Mismo patrón de montaje con
`hidden` que las otras dos (se queda montada al cambiar de pestaña).

**Componente nuevo `PagosPorSemana.tsx`.** Sin `useColumnPrefs` /
`ColumnasMenu` / redimensionado: pocas columnas fijas y un detalle corto no
lo necesitan.

- Una fila por semana con pagos, más reciente primero, **todas colapsadas
  por defecto** (7 años de historia — expandidas de entrada sería demasiado).
  Columnas: Periodo (`Semana {semana} · {etiqueta}`, ej. «Semana 1 · 1-6 sep
  2026»), cantidad de pagos, total cobrado, flecha de expandir.
- Al expandir: sub-tabla con cada pago — número, cliente, fecha, modo,
  importe, **Aplicado a** (una línea por factura, con su OV cuando lo hay,
  ej. `AM1492 (OV-2026-162): $11.150.331`), y **Sin aplicar** si
  `unused_amount > 0`.
- Estado de expansión: un `Set<string>` de semanas abiertas (a diferencia del
  aviso de anticipos, aquí puede haber varias filas abiertas a la vez).
- Si la petición falla, mensaje de error como en las demás pestañas
  (`setError(e.message)` y el banner rojo ya usado en `OVPendientes.tsx`).

## 3. Tests (TDD)

- **`semanaDelMes`**: la tabla del ejemplo de arriba, más los bordes: un mes
  que empieza en lunes (semana 1 completa desde el día 1), un mes de 28 días
  que empieza en lunes (exactamente 4 semanas, sin semana 5).
- **La agregación** (agrupar filas SQL en pagos, agrupar pagos en semanas,
  sumar totales): con filas sintéticas que crucen un fin de semana del mes a
  fin de otro, un pago con varias aplicaciones, un pago sin ninguna.
- **El endpoint**: guardia de permiso, igual que `anticipos-atencion`
  (`contabilidad` sí, `ov-pendientes` no). No hace falta la resiliencia
  especial de los anticipos: este endpoint no se mezcla con otra respuesta,
  así que un fallo simplemente devuelve 500 y la pestaña muestra su error.

## Fuera de alcance

- Buscador de cliente o filtro por rango de fechas.
- Columnas configurables / orden / ancho ajustable.
- Mostrarlo en la app `ov-pendientes` o en el widget del dashboard.

No se pidieron y añadirlos ahora sería construir de más. Si hacen falta
después, se agregan como una tarea aparte.
