# WO-sales — DocumentoNúmero persistente e irrepetible

**Fecha:** 2026-11-09
**Estado:** implementado en la rama `feat/wo-sales-documento-numero` (plan:
`docs/superpowers/plans/2026-11-09-wo-sales-documento-numero.md`); pendiente de desplegar hub-api
y la SPA de WO-sales
**Depende de:** WO-sales V1 (`2026-07-15-wo-sales-design.md`) y el envío por correo
(`2026-07-16-wo-sales-email-design.md`), ambos en producción.

## 1. Objetivo

Que la columna D (`DocumentoNúmero`) del archivo de World Office sea un número
**consecutivo, irrepetible y estable**: cada OV recibe un número una sola vez y lo conserva
para siempre, en todos los archivos, se facture o no. Cierra el bloqueante §8.1 (el
consecutivo arrancaba en 1 en cada archivo y chocaba con los pedidos ya cargados en WO).

## 2. Problema actual

`buildWorldOfficeCsv` numera **por posición** en cada generación: ordena las OV por fecha y
número y reparte `config.consecutivoInicial` (= 1), 2, 3… No se guarda nada entre archivos.
Consecuencias:

- Cada archivo vuelve a empezar en 1 → choca con los pedidos que ya están en WO.
- Cuando una OV se factura y sale del archivo, todas las que van detrás se corren un número:
  la misma OV lleva números distintos en archivos distintos.

## 3. Decisiones (cerradas en brainstorming)

- **Contador propio en la base del portal**, no el consecutivo de la OV de Zoho: la
  numeración en WO queda seguida, sin huecos.
- **Un solo contador para todos los prefijos**, que nunca se reinicia: OV_25 y OV_26
  comparten la secuencia, y en 2027 (OV_27) se sigue desde el número que toque.
- **Arranque**: la OV-2026-212 es la **38** y a partir de ahí, consecutivos.
- **Congelación**: las OV anteriores conservan el número con el que salieron en el archivo
  `apps/WO-sales/xlsx/DocumentosVentasEncabezadosMovimientoInventarioWO_2026-10-31.xls`
  (gitignored). Ese archivo trae 37 pedidos numerados del 1 al 37 sin huecos; el último es
  la OV-2026-211 → 37, coherente con que la 212 sea la 38.
- **Solo las OV que emiten filas (al menos una línea) reciben número.** Una OV sin líneas
  (`ov_sin_lineas`) no llega a World Office y no consume número: lo recibe la primera vez que
  aparece con líneas. Así la numeración no deja huecos.
- **Se asigna al generar**, en las cuatro vías (vista previa, `.csv`, `.xls` y correo de
  n8n). Como n8n consulta `/email/pendiente` cada 5 minutos, en la práctica una OV recibe su
  número a los pocos minutos de aparecer en la réplica. Si una OV se cancela después de
  recibirlo, ese número queda sin usar (hueco aceptado).

## 4. Diseño

### 4.1 Datos — migración `070_wo_sales_documento_numero.sql`

```sql
CREATE TABLE IF NOT EXISTS portal.wo_sales_documento_numero (
  numero_ov        text        PRIMARY KEY,           -- 'OV-2026-212'
  documento_numero integer     NOT NULL UNIQUE CHECK (documento_numero > 0),
  origen           text        NOT NULL CHECK (origen IN ('congelado', 'asignado')),
  asignado_at      timestamptz NOT NULL DEFAULT now()
);
```

- Clave = número de OV de Zoho (`SalesOrder.numero`), que es lo único que conoce el archivo
  del 31/10 y lo que el builder ya recibe.
- Las filas **nunca se borran ni se modifican**: eso es lo que hace al número irrepetible.
- La misma migración siembra las 37 OV congeladas con `origen = 'congelado'` y
  `INSERT … ON CONFLICT DO NOTHING` (initDb re-ejecuta las migraciones en cada arranque; la
  siembra tiene que ser idempotente). El número de OV se reconstruye como
  `OV-20{AA}-{Nota}` a partir del prefijo y la Nota del archivo:

| Doc | OV | Doc | OV | Doc | OV | Doc | OV |
|---|---|---|---|---|---|---|---|
| 1 | OV-2022-105 | 11 | OV-2026-143 | 21 | OV-2026-188 | 31 | OV-2026-205 |
| 2 | OV-2025-030 | 12 | OV-2026-146 | 22 | OV-2026-189 | 32 | OV-2026-206 |
| 3 | OV-2025-086 | 13 | OV-2026-153 | 23 | OV-2026-193 | 33 | OV-2026-207 |
| 4 | OV-2025-087 | 14 | OV-2026-155 | 24 | OV-2026-194 | 34 | OV-2026-208 |
| 5 | OV-2025-199 | 15 | OV-2026-156 | 25 | OV-2026-196 | 35 | OV-2026-209 |
| 6 | OV-2026-021 | 16 | OV-2026-157 | 26 | OV-2026-198 | 36 | OV-2026-210 |
| 7 | OV-2026-033 | 17 | OV-2026-160 | 27 | OV-2026-201 | 37 | OV-2026-211 |
| 8 | OV-2026-057 | 18 | OV-2026-167 | 28 | OV-2026-202 | | |
| 9 | OV-2026-081 | 19 | OV-2026-171 | 29 | OV-2026-203 | | |
| 10 | OV-2026-142 | 20 | OV-2026-187 | 30 | OV-2026-204 | | |

- Se registra en `MIGRATIONS` de `apps/hub-api/src/db.ts`.
- Un bloque `DO` al final: si existe el rol `portal_app`, le concede `SELECT, INSERT` y le
  revoca `UPDATE, DELETE, TRUNCATE` sobre la tabla, porque la 068 re-concede todos los permisos
  del esquema en cada arranque (y corre antes que la 070).

### 4.2 Asignación — `documento-numero.ts` (puro) + `documento-numero.repo.ts` (BD)

- **Puro** — `ordenarParaAsignar(numerosOV: string[]): string[]`: orden en el que las OV sin
  número reciben el suyo. Por año y consecutivo **numéricos** de `OV-AAAA-XXX` (así
  `OV-2026-999` va antes que `OV-2026-1000`); lo que no cumpla el patrón va al final, en
  orden de texto.
- **BD** — `asignarDocumentoNumeros(db, numerosOV: string[]): Promise<Map<string, number>>`:
  1. Lista vacía → mapa vacío, sin abrir transacción.
  2. `BEGIN` + `pg_advisory_xact_lock(hashtext('portal.wo_sales_documento_numero'))`, el
     patrón de candado del repo (p. ej. `contratos-repo.ts`), distinto del candado del correo.
  3. Lee las filas existentes de esos números de OV.
  4. A las que faltan, en el orden de `ordenarParaAsignar`, les da `MAX(documento_numero) + 1`,
     `+ 2`… (`origen = 'asignado'`). Con la siembra, el primero es el 38.
  5. `COMMIT` y devuelve el mapa completo (existentes + recién asignados).
  - El candado serializa dos generaciones simultáneas; el `UNIQUE` es la red de seguridad.
  - Se usa `MAX + 1` y no una `SEQUENCE`: una secuencia consume números aunque el `INSERT`
    choque o se revierta, y dejaría huecos sin necesidad.

### 4.3 Builder

- `buildWorldOfficeCsv(ordenes, config, documentoNumeros: ReadonlyMap<string, number>)`.
  Sigue sin tocar la BD: escribe en la columna D el número del mapa para `ov.numero`.
- Si a una OV **con líneas** le falta número en el mapa, **lanza un error** (no saca un archivo con la
  columna vacía ni inventa un número): es un fallo de programación, no un dato de Zoho.
- El orden de las filas del archivo no cambia (fecha y número de OV).
- Se elimina `config.consecutivoInicial` (tipo, valor por defecto y comentarios).

### 4.4 Llamadores

Las cuatro vías hacen lo mismo justo antes de construir:
`const numeros = await asignarDocumentoNumeros(db, numerosANumerar(ordenes));`
(`numerosANumerar`, puro en `documento-numero.ts`, devuelve los números de las OV con al menos
una línea; una OV sin líneas no se numera y el builder solo la avisa).

- `router.ts`: `/wo-sales/preview`, `/wo-sales/csv`, `/wo-sales/xlsx`.
- `email.ts`: `computarPendiente` (ya recibe `db`).
- La OV de prueba `OV-2026-1000-01` (`config.ordenesExcluidas`) se descarta en la fuente,
  antes de llegar aquí: nunca recibe número.
- `hashMatriz` no cambia. Con números estables, la matriz solo cambia cuando cambia el
  contenido de una OV.

## 5. Errores

- Falla la asignación (BD caída, choque inesperado) → la transacción se revierte entera, el
  endpoint responde 500 con `sendError` y **no sale ningún archivo**. Nunca hay numeración a
  medias.
- Se eliminó del correo el bloque «ATENCIÓN … mismo número de documento … no lo subas»: dejó
  de ser cierto al numerar por OV.
- Dos OV distintas de Zoho con el mismo número (p. ej. una borrada y recreada antes de la
  barrida nocturna de huérfanos) compartirían DocumentoNúmero, que se asigna por número.
  Decisión: **avisar y seguir**. Nuevo `WarningTipo` `ov_numero_repetido`, un solo aviso por
  número (no por aparición ni por línea); el archivo no cambia. El correo añade la línea «OV con
  número repetido en Zoho» (`resumen.repetidas`) antes de «Advertencias». Se sincronizó
  `apps/WO-sales/src/App.tsx` (unión `WarningTipo` y `WARNING_META`).

## 6. Pruebas (TDD estricto)

- `builder.test.ts`: escribe el número del mapa y no uno por posición; dos builds con
  distinto subconjunto de OV dan a la misma OV el mismo número; lanza si falta una OV en el
  mapa; un número repetido en la entrada da un único aviso `ov_numero_repetido` (también con
  tres apariciones), ambos pedidos siguen en la matriz con el mismo número, y sin repetidos no
  hay aviso.
- `email.test.ts`: con dos OV del mismo número el cuerpo trae la línea de OV repetida y
  `resumen.repetidas` la nombra; una corrida normal trae `repetidas: []` y ninguna línea.
- `documento-numero.test.ts`: orden numérico por año y consecutivo; `OV-2026-999` antes que
  `OV-2026-1000`; no conformes al final.
- `documento-numero.db.test.ts` (contra Postgres real):
  - las 37 congeladas están sembradas (`OV-2026-211` → 37);
  - la primera OV nueva recibe el 38; un lote `[OV-2026-213, OV-2026-212]` da 212 → 38 y
    213 → 39;
  - volver a pedir las mismas OV devuelve los mismos números sin crear filas;
  - una OV que deja de pedirse no libera su número (la siguiente nueva no lo reutiliza);
  - dos asignaciones concurrentes con OV nuevas solapadas no repiten número ni dejan huecos.
- `router.test.ts` / `email.test.ts`: se ajustan para inyectar la asignación.

## 7. Despliegue y verificación

- Orden: desplegar hub-api y la SPA de WO-sales juntas. Si la SPA es más vieja, muestra el slug
  crudo `ov_numero_repetido` (`metaDe` cae al tipo), lo cual es inofensivo pero confuso.
- **Antes del primer archivo real**: si hoy hay abierta alguna OV **anterior a la 212** que no
  esté entre las 37 congeladas, se llevará el 38 y la 212 bajará al 39. El plan incluye la
  consulta SQL contra la réplica (`books.*`, base `zoho-hub`) que lista las OV vivas sin
  número congelado, para revisarlo antes de desplegar.
- **Después de desplegar**: consulta que muestra las últimas filas de
  `portal.wo_sales_documento_numero` para confirmar 212 → 38 y los siguientes.

## 8. Fuera de alcance

- Mostrar el DocumentoNúmero en la tabla de la SPA.
- Una pantalla para corregir o reasignar números (si hiciera falta, se hace con SQL).
- Validación bloqueante por pedido, lista maestra y golden de regresión (otros pendientes).
