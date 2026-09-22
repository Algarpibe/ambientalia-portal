# Diseño — Anticipos en las OV pendientes de facturar (app Contabilidad)

## Objetivo

Que la tabla «OV pendientes de facturar» muestre, para cada OV, cuánto anticipo
se ha cobrado y cuánto de ese dinero sigue sin aplicarse a una factura. Y
avisar de los anticipos que no se pueden enlazar con ninguna OV o que se
quedaron sin aplicar en una OV ya cerrada.

## Lo que dicen los datos (verificado el 2026-09-21)

Las facturas de anticipo `ANT-AAAA-NNN` **no son facturas**. Viven en el
módulo «Facturas de anticipo» de Zoho (Retainer Invoices, API
`/retainerinvoices`). Comprobado por tres vías:

- 0 filas `invoice_number LIKE 'ANT-%'` en `books.invoices`.
- 0 resultados en la API de facturas de Zoho con `invoice_number_startswith=ANT`.
- La URL de ANT-2026-063 en Zoho es `…/app#/retainerinvoices/2251824000060060001`.

Consecuencias:

- **Hoy no están en la réplica.** El worker sincroniza `/contacts`,
  `/customerpayments`, `/invoices`, `/items`, `/purchaseorders` y
  `/salesorders`. Nada más.
- **No hay enlace nativo con la OV.** Según la documentación de la API, el
  anticipo solo se asocia a proyectos. El enlace lo escribe una persona a mano
  en la descripción de la línea: «Anticipo OV-2026-167».
- **Lo cobrado y lo aplicado sí son datos estructurados.** La API documenta
  `payment_made` (lo cobrado) y `payment_drawn` (lo ya aplicado a facturas
  finales). La pantalla lo refleja como «Estado de retirada de anticipo: LISTO
  PARA DRAW». **Los nombres de campo solo están vistos en la documentación**:
  se confirman en el `raw` antes de desplegar hub-api (ver Verificación).

Volumen: al menos ANT-2026-050 a ANT-2026-063 en 2026, del orden de 60 al año.

## Decisiones tomadas

| Pregunta | Decisión |
|---|---|
| Qué se muestra | Columnas de importe; «Por facturar» no cambia |
| Qué importe | Los dos: cobrado y sin aplicar, en columnas ocultables |
| Quién lo ve | Solo quien tiene la app Contabilidad, filtrado en el servidor |
| Qué pasa con lo que no enlaza | Aviso con dos familias: sin enlazar y sin aplicar en OV cerrada |
| Dónde se interpreta el texto | hub-api, en funciones puras de TypeScript con tests |

**Por qué «Por facturar» no se toca.** Zoho aplica el anticipo como un *pago*
contra la factura final, que se emite por el total igual. El anticipo reduce la
**cartera**, no lo que queda por facturar. Restarlo daría una cifra falsa.

## 1. Worker (repo `Desk_2_R1.023`, servicio zoho-hub-sync)

**Tabla nueva `books.retainer_invoices`** en `schema-books.sql`:

```
retainerinvoice_id      text PRIMARY KEY
retainerinvoice_number  text
reference_number        text
date                    date
status                  text
customer_id             text
customer_name           text
currency_code           text
total                   numeric
payment_made            numeric
payment_drawn           numeric
raw                     jsonb
zoho_last_modified      timestamptz
synced_at               timestamptz NOT NULL DEFAULT now()
```

**Sin tabla de líneas.** Una línea de anticipo solo tiene descripción e
importe; la descripción se lee de `raw->'line_items'`. Una tabla hija solo
añadiría código que mantener.

**Sincronización**, calcando las órdenes de compra: `retainerInvoiceRow` en
`mappers.ts`, `upsertRetainerInvoice` en `repo.ts`, y `persistRetainerInvoice`
en `sync.ts`, que trae el detalle (`/retainerinvoices/{id}`) porque la lista no
incluye las líneas. Entra en `incremental` y tiene su `backfill`.

**Barrido de borrados.** Una entrada más en la lista declarativa del sweep, sin
tabla hija. Sin ella, un anticipo borrado en Zoho seguiría en la réplica y
dispararía alertas falsas de «sin aplicar», y una alerta falsa desgasta la
confianza en todas las demás.

## 2. hub-api

### `extraerOV(texto: string): string[]`

Función pura. Devuelve las OV distintas que aparecen en el texto, normalizadas
a `OV-AAAA-NNN` (número con al menos tres cifras). Su entrada es la
concatenación de las descripciones de **todas** las líneas más
`reference_number`: si ambas fuentes nombran la misma OV, cuenta una sola vez;
si nombran OV distintas, el resultado tiene varias y el anticipo es ambiguo.

| Texto | Resultado |
|---|---|
| `Anticipo OV-2026-167` | `[OV-2026-167]` |
| `anticipo ov-2026-167` | `[OV-2026-167]` |
| `Anticipo OV 2026-167` | `[OV-2026-167]` |
| `Anticipo OV2026-167` | `[OV-2026-167]` |
| `Anticipo OV-2026-0167` | `[OV-2026-167]` |
| `Anticipo OV–2026–167` | `[OV-2026-167]` — raya o guion largo, como sale al copiar de Word |
| `Anticipo OV-2026-5` | `[OV-2026-005]` |
| `Anticipo OV-2026-1000` | `[OV-2026-1000]` |
| `Anticipo OV-2026-150 y OV-2026-151` | `[OV-2026-150, OV-2026-151]` |
| `Anticipo 50% del pedido` | `[]` |
| `Anticipo OV-26-167` | `[]` — un año de dos cifras no se adivina, va al aviso |
| `MOV-2026-167` | `[]` — «OV» debe empezar palabra |

### `aplicadoEnMonedaDoc(aplicadoBcy, tasaCambio)` — corrección del 2026-09-22

**Hallazgo contra producción, no anticipado al diseñar.** `payment_drawn` de
Zoho llega en la moneda BASE de la organización (bcy), no en la del
documento — a diferencia de `payment_made`, que sí viene en la del documento.
Restar los dos como si fueran la misma unidad producía un «sin aplicar» falso
en casi todos los anticipos en pesos: **205 de 221** el día del primer
despliegue. Caso que lo destapó: ANT-2026-061 cobró 11.150.331 COP y los
aplicó del todo, pero `payment_drawn` valía 3.612,71 — exactamente el
`bcy_total` de esa factura (11.150.331 × `exchange_rate` 0,000324), no COP.

Corrección: antes de que el anticipo llegue a `enlazarAnticipos`,
`aplicadoEnMonedaDoc` divide `payment_drawn` entre `exchange_rate` (leído de
`raw->>'exchange_rate'`, la única tabla que la trae). Sin tasa de cambio
fiable (0, `null` o ausente) se trata como 0 aplicado — conservador: mejor un
aviso de más que esconder un anticipo de verdad sin aplicar.
`enlazarAnticipos` no cambió: sigue recibiendo `aplicado` ya en la moneda del
documento, exactamente como asumía desde el principio.

Verificado contra la base real tras la corrección: de 220 anticipos no
borrador/anulados, 203 quedan totalmente aplicados y solo 17 con saldo real
pendiente — todos con `payment_drawn = 0` genuino o un `drawn` parcial real,
no un artefacto de moneda.

### `enlazarAnticipos(anticipos, ovs)`

Función pura. Recibe los anticipos (ya sin borradores ni anulados, y con
`aplicado` ya convertido a la moneda del documento) y las OV referenciadas
con su `status` y su `currency_code`. Devuelve:

- **Importes por OV**: `cobrado = Σ payment_made` y
  `sinAplicar = Σ max(0, payment_made − aplicado)`, sumando todos los
  anticipos de esa OV.
- **Lista de atención**, una fila por anticipo con uno de estos motivos:

| Motivo | Cuándo |
|---|---|
| `sin_referencia` | `extraerOV` no encuentra ninguna OV |
| `varias_ov` | encuentra más de una; no se puede repartir el importe |
| `ov_inexistente` | la OV no existe en `books.sales_orders` |
| `moneda_distinta` | la moneda del anticipo no es la de la OV. No se suma, se avisa |
| `sin_aplicar_ov_cerrada` | `sinAplicar > 0` y la OV está `invoiced` o `void` |

Los motivos se evalúan **en el orden de la tabla** y cada anticipo recibe solo
el primero que cumple. Así, uno en otra moneda sobre una OV ya facturada sale
como `moneda_distinta`: hasta aclarar la moneda no se puede afirmar nada de su
saldo.

Un anticipo con motivo `sin_referencia`, `varias_ov`, `ov_inexistente` o
`moneda_distinta` **no suma** en ninguna OV. Uno con `sin_aplicar_ov_cerrada`
tampoco se ve en la tabla, porque su OV ya no está pendiente: por eso necesita
el aviso.

Una OV en `draft` o `pending_approval` no está en la tabla ni genera aviso.

Cada fila de atención lleva: número ANT, cliente, fecha, cobrado, sin aplicar,
motivo, la OV cuando la hay, su estado, y el texto tal cual se escribió.

### Endpoints

| Endpoint | Guarda | Cambio |
|---|---|---|
| `GET /contabilidad/ov-pendientes` | Contabilidad u ov-pendientes | Si el usuario tiene **Contabilidad**, cada fila añade `anticipoCobrado` y `anticipoSinAplicar`. Si no, **esos campos no se envían**, ni siquiera a cero |
| `GET /contabilidad/ov/:numero` | Contabilidad u ov-pendientes | Igual, con la lista `anticipos` (número, fecha, estado, cobrado, sin aplicar) |
| `GET /contabilidad/anticipos-atencion` | **solo Contabilidad** | Nuevo. La lista de atención, de más reciente a más antigua |

«Tiene Contabilidad» significa ser `admin` o tener la app asignada: la misma regla de
`requireApp`, que ya deja pasar a los admin. Un admin ve los anticipos aunque no tenga la app.

**Resiliencia.** La lectura de anticipos va envuelta: si falla (por ejemplo,
porque la tabla aún no existe), `ov-pendientes` y `ov/:numero` responden sin
los campos de anticipo y el error se registra en el log. Los anticipos pueden
fallar; la tabla de OV no.

**Rendimiento.** Con unos 60 anticipos al año se cargan todos y se procesan en
memoria en cada petición. Se revisará cuando haya miles.

## 3. Portal (app Contabilidad)

**Columnas.** Dos entradas nuevas en la configuración de columnas de
`OVPendientes.tsx`, **al final, después de «ESTADO»**: «ANTICIPO COBRADO ($)» y
«ANTICIPO SIN APLICAR ($)». Visibles por defecto, ocultables, ordenables y
redimensionables como las demás. Van al final porque `useColumnPrefs` añade las claves
nuevas al final para quien ya tiene la tabla personalizada: en cualquier otra posición, un
usuario nuevo y uno antiguo las verían en sitios distintos, y a todos los antiguos se les
marcaría la tabla como personalizada.

Las columnas **solo existen si los datos traen los campos**. El componente es
el mismo en Contabilidad, en la app `ov-pendientes` y en el widget; decide el
servidor, y a quien no tiene Contabilidad nunca le llegan.

Celdas: «—» si la OV no tiene ningún anticipo; «$ 0» si lo tuvo pero ya está
aplicado del todo.

**Modal de la OV.** Un bloque «Anticipos» bajo las líneas, con número ANT,
fecha, estado, cobrado y sin aplicar. Solo aparece si la OV tiene alguno.

**Aviso de atención.** Componente nuevo en la pestaña de OV de `App.tsx` de
Contabilidad, encima de la tabla. No aparece en `AppOV.tsx` ni en el widget.
Plegado por defecto: «⚠ N anticipos requieren atención». Desplegado, muestra
una tabla con ANT, cliente, fecha, cobrado, sin aplicar, motivo en lenguaje
llano y el texto original. Con la lista vacía no se pinta nada. Si su petición
falla, no se pinta nada y la tabla de OV sigue funcionando.

**Preferencias guardadas.** La configuración de columnas en `localStorage`
(orden, visibilidad y ancho, por `user_id`) no conoce las dos claves nuevas. Al
cargar una configuración antigua, las columnas nuevas deben aparecer al final,
visibles, sin romper ni descartar el resto.

## 4. Tests (TDD, rojo primero)

- **Worker**: `retainerInvoiceRow` mapea `payment_made`, `payment_drawn` y
  `raw`; `persistRetainerInvoice` pide el detalle y hace upsert; el sweep
  incluye `retainer_invoices`.
- **hub-api**: `extraerOV` con la tabla de ejemplos de arriba;
  `enlazarAnticipos` con cada motivo, las sumas de varios anticipos por OV, el
  tope en 0 de `sinAplicar` y la moneda; un usuario sin Contabilidad no recibe
  los campos; si la lectura de anticipos falla, `ov-pendientes` sigue
  respondiendo.
- **Portal**: columnas ausentes si faltan los campos, aviso oculto con la lista
  vacía, configuración guardada antigua más columnas nuevas.

`apps/contabilidad` no tenía tests: estrena vitest con jsdom, React Testing Library y el
arreglo de `localStorage` para Node 22+ (el mismo del portal).

## 5. Verificación contra la base real

Después del backfill del worker y **antes** de desplegar hub-api:

1. Confirmar en `raw` que `payment_made` y `payment_drawn` existen con esos
   nombres y que las descripciones están en `raw->'line_items'`.
2. Medir la tasa de enlace real: cuántos anticipos dan una OV, cuántos ninguna
   y cuántos varias. Si los que no enlazan son muchos, se revisa el diseño antes
   de seguir.
3. Caso de control: ANT-2026-063 → OV-2026-167, 9.505.784 cobrados, estado
   «listo para aplicar».

## 6. Despliegue

Orden: **worker → backfill → verificación → hub-api → portal**. La resiliencia
de hub-api cubre que alguien se salte el orden, pero el orden sigue siendo el
bueno.

Commits: en este repo hay autorización permanente para commitear y empujar. En
el del worker no: se commitea y se pide permiso antes de empujar.

## Riesgos abiertos, a comprobar lo primero

- **Permisos OAuth del worker.** No se sabe si el token cubre
  `/retainerinvoices`. Si no, hay que regenerar el refresh token en la consola
  de Zoho, y eso lo hace el usuario.
- **Filtro incremental.** Confirmar que `/retainerinvoices` acepta el filtro por
  fecha de modificación que usa `incremental`. Si no, se sincroniza completo en
  cada pasada: con este volumen no cuesta nada.

## Fuera de alcance

- Restar el anticipo de «Por facturar» (ver arriba por qué sería una cifra falsa).
- Mostrar anticipos en la app `ov-pendientes`.
- Llevar los anticipos a la pestaña de Facturación. No hay riesgo de contarlos
  dos veces porque esa pestaña solo lee `books.invoices`.
- Cambiar cómo se registra el anticipo en Zoho. Si la tasa de error resulta
  alta, la mejora natural sería pedir que la OV se escriba también en
  «Referencia», que ya se lee.
