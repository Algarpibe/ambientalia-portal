# Incidente — Facturas "fantasma" duplicadas en zoho-hub (2026-07-17)

## Resumen

En el Conciliador de Pagos, la factura **FP-341** (cliente *Corporación Integral de
Medio Ambiente CIMA*, total COP 1.190.000) aparecía **duplicada**: una fila pagada
(saldo 0) y otra pendiente (saldo 1.190.000). El widget "Facturas Pendientes y
Parciales" y la pestaña de Conciliación la contaban como pendiente y la sumaban al
total por cobrar, aunque en Zoho ya estaba **pagada**.

No era un problema del portal ni de la caché: era un **registro huérfano en la
réplica `zoho-hub`**.

## Evidencia

**En Zoho Books** (verificado por API) existe UNA sola FP-341:
- `invoice_id 2251824000057676058` · status `paid` · balance `0`.

**En la réplica `zoho-hub`** (`books.invoices`) había DOS filas con
`invoice_number = 'FP-341'`:

| invoice_id | status | balance | |
|---|---|---|---|
| `2251824000003417063` | `overdue` | 1.190.000 | huérfana (ya no existe en Zoho) |
| `2251824000057676058` | `paid` | 0 | correcta (coincide con Zoho) |

La fila `...003417063` **no existe en Zoho**: fue borrada o reemplazada allí
(típico de una factura que se reingresa con el mismo número), pero permaneció en la
réplica.

## Remediación manual aplicada (2026-07-17)

Borrado puntual del huérfano en la BD `zoho-hub` (Postgres), anclado a su
`invoice_id` exacto:

```sql
BEGIN;
DELETE FROM books.invoices WHERE invoice_id = '2251824000003417063';  -- DELETE 1
-- verificado: queda solo 2251824000057676058 | paid | 0
COMMIT;
```

Tras el COMMIT y el vencimiento de la caché del hub-api (~2 min), FP-341 dejó de
aparecer duplicada y pendiente.

> Nota: es un arreglo del **síntoma** de un caso. La causa raíz sigue abierta.

## Causa raíz

La sincronización Zoho → `zoho-hub` la hace un worker aparte (**`zoho-hub-sync`**,
repo **`ambientalia-desk`** — no está en este monorepo).

La evidencia indica que el worker **hace upsert por `invoice_id` (las
actualizaciones sí se propagan** — la fila pagada estaba correcta**), pero NO
elimina de la réplica las entidades que se borran/reemplazan en Zoho.** Zoho Books
no devuelve los registros borrados en sus listados, así que un sync puramente
incremental (insert/update) nunca se entera del borrado y deja huérfanos.

Esto no es exclusivo de FP-341 ni de las facturas: cualquier entidad replicada
(facturas, órdenes de venta, pagos, ítems…) puede acumular huérfanos cuando algo se
borra o se reemplaza en Zoho. Reaparecerá.

> Pendiente de confirmar en `ambientalia-desk` (no accesible desde este repo): la
> lógica exacta de upsert y si ya existe algún manejo de borrados.

## Opciones de solución

### 1. Barrido periódico (mark-and-sweep) — **recomendada**
El worker, cada cierto tiempo (p. ej. 1×/día), lista de Zoho **solo los IDs vivos**
de cada entidad y borra de la réplica las filas cuyo ID ya no está en Zoho
(anti-join). 

- **Pros:** corrige TODOS los borrados sin importar la causa; es autosanador; modelo
  mental simple.
- **Contras:** hay que listar todos los IDs desde Zoho (paginado, pero solo IDs →
  barato); el alcance del barrido debe coincidir EXACTAMENTE con lo que el sync
  ingesta, para no borrar filas de entidades que el sync no trae.
- **Riesgo:** un fallo parcial al listar Zoho no debe disparar borrados masivos →
  exigir que la lista de IDs venga completa (todas las páginas OK) antes de barrer.

### 2. Webhooks de Zoho para borrado/void — complementaria
Suscribirse a los eventos de borrado/anulación de Zoho y quitar la fila al recibirlos.

- **Pros:** casi en tiempo real; muy barato en API.
- **Contras:** entrega no garantizada (se pueden perder eventos); requiere endpoint
  público + auth; más piezas móviles. **No sustituye al barrido**, lo complementa
  para timeliness (el barrido queda como red de seguridad de los eventos perdidos).

### 3. Mitigación en hub-api (lado lectura) — defensa en profundidad, en ESTE repo
Independiente del worker, el hub-api puede volverse resistente a duplicados: al leer
facturas, **deduplicar por `invoice_number` quedándose con la fila de
`last_modified_time` más reciente** (o con la que exista en Zoho). El Conciliador
dejaría de ver duplicados aunque la réplica tenga huérfanos.

- **Pros:** implementable ya aquí (no depende de `ambientalia-desk`); protege al
  Conciliador de esta clase de drift.
- **Contras:** enmascara el problema en la réplica (otros consumidores lo siguen
  viendo); es una heurística (asume que `invoice_number` es único por org, que sí lo
  es en Zoho, y que la fila más reciente es la vigente).

## Recomendación

- **Arreglo de fondo:** opción **1 (barrido periódico)** en `zoho-hub-sync`
  (`ambientalia-desk`). Es la única que corrige la réplica de forma general.
- **Refuerzo inmediato (opcional, en este repo):** opción **3** en `hub-api`
  (`reconciliation.ts`), para que el Conciliador sea robusto a duplicados aunque el
  worker aún no esté arreglado.
- **Más adelante:** opción **2 (webhooks)** si se quiere que los borrados se reflejen
  al instante, siempre con el barrido como respaldo.

## Estado

- [x] Síntoma corregido (huérfano de FP-341 borrado el 2026-07-17).
- [ ] Causa raíz — pendiente en `ambientalia-desk` (worker `zoho-hub-sync`).
- [ ] Mitigación opcional en `hub-api` (`reconciliation.ts`), si se decide.
