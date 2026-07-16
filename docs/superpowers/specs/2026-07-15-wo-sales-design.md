# WO-sales — Generador del archivo plano de World Office (V1)

**Fecha:** 2026-07-15
**Estado:** aprobado, pendiente de plan de implementación

## 1. Objetivo

Generar bajo demanda el CSV que World Office importa como "pedidos", a partir de las
órdenes de venta vivas replicadas en `zoho-hub`. La V1 solo genera el archivo y lo deja
descargable desde el portal. El envío por correo (Fase 2) queda como gancho preparado,
sin implementar.

Contexto de negocio en `apps/WO-sales/Analisis_miniapp_Zoho_WorldOffice.docx`: hoy
Xiomara concilia a mano y Marcela redigita cada venta al facturar. El pedido cargado en
WO reserva inventario y precarga la facturación.

## 2. Hallazgos que fijan el diseño

Verificados contra la base real (`psql` sobre `zoho-hub`) y contra la API de Zoho, no
supuestos. Los apunto porque contradicen la documentación de partida.

| Hallazgo | Detalle |
|---|---|
| **57 columnas, no 56** | El prompt y el acta dicen 56. El CSV de muestra tiene 57 en cabecera y en todas las filas. 31 de encabezado + 26 de detalle. Manda el archivo. |
| **Windows-1252, CRLF** | `ú` de "Número" es el byte `0xFA`. Saltos CRLF y CRLF final. |
| **NIT es columna real** | `books.contacts.nit`. Join `sales_orders.customer_id = contacts.contact_id`. Las 33 OV vivas tienen NIT. |
| **Moneda** | La moneda base de la organización es **USD**, pero las OV están en **COP** (33/33). `Valor Unitario` sale de `rate` (COP), nunca de `bcy_rate` (USD). |
| **Centro de costos** | Existe en Zoho como `cf_centro_de_costos` (custom field de artículo, `multiselect`), con formato `"330801 CALIBRACION ENVIRO"` = código + descripción. **El sync no lo baja hoy.** |
| **Consecutivo** | `salesorder_number` es `"OV-2026-138"`, no un número. |
| **Formas de pago** | Ocho etiquetas reales, ninguna es `Credito`/`Contado`. |
| **OV zombis** | 9 OV `open`/`overdue` de 2021 y 2025. |
| **Código Centro Costos** | La muestra lo deja **vacío**, aunque `Descripcion_campos.docx` dice que lleva la descripción. |

## 3. Arquitectura

Sigue el patrón del portal: SPA en `apps/`, datos y dominio en `hub-api`, registro en
tres sitios.

```
apps/hub-api/src/wo-sales/
  config.ts        valores fijos, flags y homologaciones (todo lo VALIDAR)
  types.ts         SalesOrder, SalesOrderLine, Warning
  columns.ts       las 57 columnas en orden — única fuente de verdad
  builder.ts       buildWorldOfficeCsv() — puro, sin red ni DB
  encoding.ts      UTF-8 → Windows-1252 (iconv-lite)
  source.ts        interface SalesOrderSource
  hub.source.ts    implementación contra zoho-hub (SQL)
  router.ts        createWoSalesRouter(pool)
  builder.test.ts + fixtures/
apps/WO-sales/
  src/App.tsx      SPA (default export)
  package.json, vite.config.ts, index.html
```

`buildWorldOfficeCsv(ordenes, config) → { csv: Buffer, warnings: Warning[] }` recibe las
OV ya consultadas y no toca red ni base. Todo el mapeo y las reglas viven ahí, y es lo
único que necesitan los tests. Detrás de `SalesOrderSource` va `HubSalesOrderSource`,
para cambiar el origen a la API de Zoho sin tocar el dominio.

**Registro en el portal** (los tres son obligatorios; si falta el tercero la app existe
pero no aparece ninguna tarjeta):

1. `apps/portal/src/lib/apps.ts` → entrada en `APPS` con `id: 'WO-sales'`
2. `apps/portal/src/App.tsx` → `lazy(() => import('../../WO-sales/src/App'))` + ruta con `<AppGuard appId="WO-sales">`
3. `apps/portal/src/pages/Aplicaciones.tsx` → tarjeta en el array hardcodeado

## 4. Reglas de negocio

**OV viva** = `status IN ('open','overdue','partially_invoiced')` **y** que no exista
factura asociada con estado distinto de `draft`/`void`.

La segunda condición es más amplia que el "Enviado" del acta a propósito: una factura
`paid` deja la OV igual de muerta que una `sent`. Filtrar solo por `sent` dejaría pasar
OV ya cobradas. Y el `status` de la OV por sí solo no basta: hay **4 OV vivas que ya
tienen factura `sent`**, y se cargarían a World Office estando ya facturadas.

Por qué importa: el acta advierte que un pedido cargado **reserva inventario** y que uno
obsoleto puede bloquear una facturación urgente por falta de existencias.

**Rango de fechas**: por defecto el año actual. Las 9 OV de 2021/2025 quedan fuera y se
listan en advertencias. El rango se amplía desde la UI.

**Sin duplicados**: una OV = N filas (una por línea de producto), con el encabezado
repetido idéntico en cada fila.

**Tolerancia a fallos**: un SKU no homologado o un dato faltante no aborta la generación.
El CSV sale con lo válido y las incidencias van al panel de advertencias.

## 5. Mapeo

Origen real de cada campo variable:

| Columna | Origen |
|---|---|
| `Encab: Documento Número` | `salesorder_number` completo (`OV-2026-138`) |
| `Encab: Fecha` | `sales_orders.date` |
| `Encab: Tercero Externo` | `books.contacts.nit` |
| `Encab: FormaPago` | `raw->>'payment_terms_label'` → homologación |
| `Encab: Fecha Entrega` | `raw->>'shipment_date'` |
| `Detalle: Producto` | `books.items.sku` |
| `Detalle: Cantidad` | `salesorder_line_items.quantity` |
| `Detalle: Valor Unitario` | `salesorder_line_items.rate` (COP) |
| `Detalle: Descuento` | `raw->>'discount'` de la línea |
| `Detalle: Nota` | `books.items.name` |
| `Detalle: Centro costos` | `items.raw->'custom_field_hash'->>'cf_centro_de_costos'`, tramo tras el primer espacio → `CALIBRACION ENVIRO` |
| `Detalle: Código Centro Costos` | mismo campo, tramo antes del primer espacio → `330801` |

Fijos: `Tipo Documento`=`FV`, `Tercero Interno`=`51023563`, `Nota`=`Orden de Venta`,
`Verificado`=`-1`, `Bodega`=`Principal`, `UnidadDeMedida`=`Und.`, `IVA`=`0.19`.
Vacíos: `Prefijo`, `Documento Externo`, `Personalizado 1..15` (×2), `Sucursal`,
`Clasificación`.

**Campos en disputa** — la descripción de campos y el CSV de muestra se contradicen. Se
implementan como flags en `config.ts` con este valor por defecto, y se cierran cuando
Xiomara confirme contra World Office real (§12):

| Campo | Por defecto | Por qué |
|---|---|---|
| `Encab: Empresa` | `customer_name` de la OV | La descripción dice "Nombre de Empresa (Cliente) ERP". La muestra trae `WORLD OFFICE PRUEBAS`, que es la empresa del entorno de pruebas, no un dato del cliente. |
| `Encab: Anulado` | vacío | La descripción dice "En blanco / OMITIR". La muestra trae `0`. Manda la descripción por ser la fuente normativa. |
| `Detalle: Vencimiento` | vacío | La descripción dice vacío. La muestra trae fecha. Mismo criterio. |

**Homologación de formas de pago** (por defecto, configurable):

| Zoho | World Office |
|---|---|
| `15/25/30/45 días fecha de factura` | `Credito` |
| `100% Anticipado`, `100% Contra Entrega` | `Contado` |
| `50% Anticipado + 50% Contra Entrega` | `Credito` |
| `50% Contra Entrega + 50% a 30 días ff` | `Credito` |

Todo lo anterior vive en `config.ts`. Nada de esto se toca desde la lógica.

**Saneamiento**: el formato no usa comillas, así que un `;` dentro de un nombre de
producto rompería la fila. Se sanea y se avisa.

## 6. Advertencias (no abortan)

Sin centro de costos (hoy: todas, hasta que el sync lo baje) · sin `shipment_date` (hoy: 1)
· moneda ≠ COP · artículo con más de un centro de costos · SKU vacío · OV anterior al
rango por antigüedad · valor que contenía `;`.

## 7. Endpoints

- `GET /api/wo-sales/preview?from=&to=&cliente=` → `{ ordenes, warnings }` para la vista previa
- `GET /api/wo-sales/csv?from=&to=&cliente=` → descarga, `Content-Type: text/csv; charset=windows-1252`, `Content-Disposition: attachment; filename="DocumentosVentasEncabezadosMovimientoInventarioWO_<fecha>.csv"`

Ambos comprueban `apps[]` del JWT además de `requireAuth` (ver §9).

## 8. Tests (vitest)

Del builder, sin base de datos: 57 columnas con nombres y orden exactos comparados
**contra el CSV de muestra** · separador `;` · valores fijos · encabezado repetido por
línea · fechas `DD/MM/AAAA` · exclusión de OV facturadas · una fila por producto ·
codificación comprobada **a nivel de byte** (`0xFA` = `ú`) · saneo de `;`.

`iconv-lite` para Windows-1252: `Buffer.from(s,'latin1')` sirve para ñ y tildes pero
destroza `–`, `…` o `€` si aparecen en un nombre de producto.

## 9. Privacidad

`docs/PRIVACY-RETENTION.md` dice hoy: *"**No** se expone email, NIT, teléfono, cédula ni
dirección (minimización)"* y *"no añadir email/NIT/teléfono a las queries del hub sin
revisar esta política"*.

WO-sales expone el NIT de cada cliente **por diseño** — es columna obligatoria del
archivo. En Colombia el NIT de persona natural es dato personal (Ley 1581). Por tanto:

1. Se actualiza `PRIVACY-RETENTION.md`: WO-sales trata NIT con finalidad contable.
2. Los endpoints comprueban `apps[]` del JWT, no solo `requireAuth`, para que el NIT solo
   lo vean los usuarios con la app asignada. Hoy ningún endpoint de datos lo hace.

## 10. Trabajo fuera de este repo

PR en `Algarpibe/ambientalia-desk`, `packages/zoho-sync/src/booksHub/sync.ts`: hoy
`persistItem` guarda el `raw` de la página de listado, que no trae `custom_fields`. El
resto de entidades ya usan `fetchDetail()`. Son tres líneas siguiendo ese patrón:

```ts
async function persistItem(header: any): Promise<void> {
  const d = await fetchDetail('items', 'item', header.item_id)
  await upsertItem(db, itemRow(d))
}
```

`itemRow(d)` funciona sin cambios: el detalle trae los mismos campos que el listado más
los `custom_fields`. El coste incremental es de unas pocas llamadas al día (`incremental()`
corta en la marca de agua; el sync corre una vez al día). El backfill son ~1.000 llamadas,
un coste que ya se paga hoy para las 1.237 facturas.

**La V1 no depende de este PR.** Mientras no se despliegue, la expresión del centro de
costos devuelve `NULL`, las dos columnas salen vacías y el panel avisa. Cuando el sync
corra, el dato aparece sin tocar una línea de la app.

## 11. Fase 2 (preparado, no implementado)

Gancho posterior al build para el envío por correo a Xiomara y Marcela ante cada
creación/modificación de OV, según el flujo del acta.

## 12. Pendientes de validar con Xiomara

- `Documento Número`: ¿WO acepta alfanumérico (`OV-2026-138`)? Al recargar el mismo consecutivo, ¿reemplaza o duplica?
- `Encab: Empresa`: ¿cliente o empresa emisora? La descripción dice cliente; la muestra trae el nombre del entorno WO.
- `Encab: Anulado`: ¿vacío u `0`? La descripción dice omitir, la muestra trae `0`.
- `Detalle: Vencimiento`: ¿vacío o fecha? La descripción dice vacío, la muestra trae fecha.
- `Detalle: Código Centro Costos`: ¿el código (`330801`)? La descripción dice descripción, la muestra lo deja vacío, y Zoho tiene ambos.
- Homologación de formas de pago: sobre todo los mixtos (`50% + 50%`).
- IVA distinto de `0.19` (artículos exentos).
- `partially_invoiced` (6 OV): hoy quedan excluidas enteras, perdiendo las líneas aún sin facturar. Resolverlo exige trabajar a nivel de línea (`quantity_invoiced` está en el `raw`).
- `Encab: Nota` = "Orden de Venta": ¿se arrastra a la factura electrónica final?
- Homologación de SKU entre Zoho y World Office antes del piloto.
