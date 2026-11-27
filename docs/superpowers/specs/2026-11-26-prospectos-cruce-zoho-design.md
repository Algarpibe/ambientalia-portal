# Diseño — Cruce de los prospectos con Zoho (Laboratorios ambientales)

Aprobado el 2026-11-26.

## Objetivo

La vista «Prospectos de grasas y aceites» lista los 90 laboratorios con esa
acreditación activa, pero no dice cuáles ya son clientes de Ambientalia. Esta
pieza cruza cada laboratorio con Zoho Books por NIT y añade una columna
**«Cliente»**:

- su estado comercial: cliente activo, cliente antiguo, en Zoho sin compras, no
  está en Zoho o sin NIT;
- la fecha de la última factura;
- si se le vendió un OCMA-500 y cuándo;
- si compra repuestos o consumibles de OCMA y cuándo fue la última vez.

Así se distingue a quién ofrecer un OCMA, a quién servicio y consumibles, y a
quién recuperar.

## Contexto

- Los datos de Zoho se leen siempre por hub-api, que es el único que habla con
  la réplica `zoho-hub` (`docs/dev/conectar-una-app-a-zoho-hub.md`). La app de
  Laboratorios hoy solo consulta datos.gov.co.
- `books.contacts` tiene el NIT como columna propia (`nit`), ya usada por WO-sales
  y Contabilidad. En Zoho el campo es `cf_nit`: solo dígitos, sin dígito de
  verificación.
- El dataset de datos.gov.co trae el NIT con puntos y dígito de verificación
  (por ejemplo, `900.000.001-7`). De los 90 laboratorios, 85 tienen NIT.
- Comprobación previa con el conector de Zoho (2026-11-26): 77 de los 90
  laboratorios tienen un contacto en Zoho con su NIT. Hay contactos con NIT de
  relleno (menos de 6 dígitos) y NIT repetidos en varios contactos.
- En Zoho, los equipos OCMA son la categoría de artículo «OCMA-500 Series» y
  sus repuestos y consumibles, «C&R OCMA-500».
- La existencia del contacto no dice si es cliente: el estado sale de las
  facturas.

## Reglas

**NIT base.** Se toma lo que hay antes del primer `-` y se quitan los caracteres
que no son dígitos: `900.000.001-7` da `900000001`. Un NIT base de menos de 6
dígitos (relleno) o de más de 10 se ignora, en la app y en hub-api: la app no lo
envía y el laboratorio queda «Sin NIT».

**Hechos de Zoho por NIT base**, sumando todos los contactos de tipo cliente con
ese NIT. Facturas sin estado `void` ni `draft`:

- `ultimaFactura`: la fecha de la factura más reciente;
- `ocmaVendido`: la fecha de la factura más reciente con alguna línea de un
  artículo de la categoría «OCMA-500 Series»;
- `ultimosRepuestos`: lo mismo con la categoría «C&R OCMA-500».

Cada una es `AAAA-MM-DD` o `null`.

**Estado del cliente**, con `hoy` (`AAAA-MM-DD`) pasado como argumento:

| Estado | Etiqueta | Cuándo |
|---|---|---|
| `sin-nit` | Sin NIT | El laboratorio no trae NIT, o su NIT base se ignora. |
| `no-en-zoho` | No está en Zoho | Ningún contacto cliente tiene ese NIT base. |
| `sin-compras` | En Zoho sin compras | Está en Zoho y `ultimaFactura` es `null`. |
| `activo` | Cliente activo | `ultimaFactura` ≥ `hoy` − 36 meses de calendario (límite incluido). |
| `antiguo` | Cliente antiguo | `ultimaFactura` < `hoy` − 36 meses. |

La resta de meses usa `sumarMeses` de `src/lib/fechas.ts`, que ajusta al último
día del mes.

**Qué se muestra y qué no.** Solo estados y fechas. Ningún importe, nombre de
contacto ni identificador de Zoho sale de hub-api: no basta con ocultarlo en
pantalla.

**Quién lo ve.** Quien tenga la app de Laboratorios asignada (y el admin, que
entra siempre). Es la regla de `requireApp`.

## Diseño técnico

### hub-api

| Pieza | Qué hace |
|---|---|
| `src/laboratorios/clientes.ts` (nuevo) | La consulta y las funciones puras `nitBase` y `agruparPorNit`. |
| `src/laboratorios/router.ts` (nuevo) | `createLaboratoriosRouter(pool)` con la ruta. |
| `src/index.ts` | Monta el router junto a los demás. |

**Ruta.** `POST /api/laboratorios/clientes`, con `requireAuth` y
`requireApp('laboratorios-ambientales')`.

- Cuerpo: `{ "nits": string[] }`.
- 400 si `nits` no es una lista, si trae más de 150 elementos o si alguno no
  da un NIT base de 6 a 10 dígitos.
- 429 a partir de la sexta petición en un minuto del mismo usuario (límite
  propio de la ruta, por usuario; el global de `/api/` es por IP). Va detrás de
  `requireApp`: un 401 o un 403 no gasta cupo.
- 200: `{ "clientes": [{ "nit", "ultimaFactura", "ocmaVendido", "ultimosRepuestos" }] }`
  con solo los NIT pedidos que están en Zoho. Cada objeto lleva exactamente esos
  cuatro campos.

**Consulta.** Una fila por contacto cliente con NIT, con sus tres fechas
(`MAX(fecha)` con `FILTER` por categoría, uniendo `books.invoices`,
`books.invoice_line_items` y `books.items` como `customerValuation.ts`). El tipo
de contacto se lee de `raw ->> 'contact_type'` (`customer`).
`agruparPorNit` normaliza el NIT de cada fila y se queda, por NIT base, con la
fecha más reciente de cada tipo. Las categorías van como parámetros (`$1`, `$2`).

**Caché.** El resultado completo de `agruparPorNit` se guarda con `cached`
(clave `laboratorios:clientes`, 2 minutos). Cada respuesta filtra ese mapa con
los NIT pedidos.

**Barrido.** El servidor no sabe qué NIT son prospectos: la app envía solo los
del dataset público, pero alguien con la app podría enviar NIT inventados o de
un registro público y saber cuáles son clientes. No se impide; se frena por
volumen: 150 NIT por petición y 5 peticiones por minuto y usuario dejan el
barrido en unos 750 NIT por minuto (antes, con 500 NIT y solo el límite global
de 60 por IP, eran unos 30 000). Decidido con el usuario el 2026-11-27 (opción
A de la revisión de la Tarea 2); validar los NIT contra el dataset del IDEAM
desde hub-api se descartó por la dependencia de datos.gov.co.

**Verificación contra la réplica**, antes de dar la pieza por buena, con un
comando SQL completo que se le pasa al usuario:

- que `category_name` en `books.items` sea exactamente «OCMA-500 Series» y
  «C&R OCMA-500»;
- que `raw ->> 'contact_type'` exista en `books.contacts` y valga `customer`
  para los clientes;
- cuántos contactos tienen un NIT de 10 dígitos sin guion (podría ser un dígito
  de verificación pegado, que no cruzaría).

### App de Laboratorios

| Pieza | Qué hace |
|---|---|
| `src/lib/clientes.ts` (nuevo) | Puras: `nitBase` (la misma regla que hub-api; las pruebas de las dos repiten los mismos casos), `estadoCliente(nit, cruce, hoy)`, `hechosDe`, `nitsParaConsultar`, `ETIQUETA_ESTADO_CLIENTE`, `filtrarPorCliente`. Tipos `HechosZoho`, `CruceZoho`, `EstadoCliente` y `EstadoCruce`. Comprobado el 2026-11-27: los 85 NIT de grasas y aceites del dataset traen guion, así que ninguno lleva el dígito de verificación pegado. |
| `src/services/clientesZoho.ts` (nuevo) | `fetchClientesZoho(nits, signal?)`: un `POST` con `authHeaders` de `@suite/auth-client`, el mismo tope de tiempo que datos.gov.co, y devuelve un `Map` por NIT base. |
| `src/lib/exportProspects.ts` | Cuatro columnas más: Cliente, Última factura, OCMA vendido, Últimos repuestos OCMA. |
| `src/pages/Prospectos.tsx` | La consulta al abrir, la columna, el filtro y el aviso. |
| `src/components/CeldaCliente.tsx` (nuevo) | La celda: etiqueta de color y las fechas debajo. Sale aparte para no engordar `Prospectos.tsx`. |
| `package.json` | La dependencia `@suite/auth-client`, como equipos-taller. |

- La URL sale de `VITE_HUB_API_URL`, como en las demás apps.
- `Prospecto` y `groupProspects` no cambian: el cruce se aplica al pintar la
  tabla y al exportar.
- Se envían los NIT base de los 90 laboratorios (las dos pestañas) en una sola
  petición al abrir la vista, sin duplicados.
- **Mientras carga**: la tabla sale con los datos de datos.gov.co y la columna
  dice «Consultando…». El filtro «Cliente» está desactivado.
- **Si falla** (red, tope de tiempo, 4xx, 5xx): aviso ámbar «No se pudo
  consultar Zoho; la columna Cliente queda vacía» con un botón «Reintentar». La
  columna muestra «—», el filtro sigue desactivado y el Excel sale con las cuatro
  columnas vacías. Un 401 lo gestiona el interceptor del portal, como en las
  demás apps.
- **Filtro «Cliente»**: «Todos» y los cinco estados, junto a departamento y
  búsqueda. Cuenta para el número de cada pestaña, como los otros filtros.
- **Tabla**: la columna «Cliente» va después de «Laboratorio». Debajo de la
  etiqueta, en letra pequeña y solo si existen, «Última factura», «OCMA vendido»
  y «Repuestos OCMA» con su fecha.
- Accesibilidad: la etiqueta lleva texto, no solo color; el aviso de error usa
  `role="alert"`; «Consultando…» va dentro de una región `aria-live="polite"`.

## Errores

- hub-api: 400 con cuerpo inválido, 401 sin sesión, 403 sin la app, 429 por
  encima de 5 peticiones por minuto del mismo usuario, 500 si
  falla la réplica, con el `sendError` propio del router (como los demás:
  `{ error: 'internal error' }`, sin detalle).
- La app trata todo fallo igual (aviso y reintento). La vista nunca se cae por
  Zoho.

## Tests

TDD estricto. Los NIT y las fechas de las pruebas son ficticios (el repositorio
es público).

**hub-api** (`src/laboratorios/*.test.ts`):

- `nitBase`: con puntos y dígito de verificación, sin guion, con espacios, y uno
  de relleno de menos de 6 dígitos.
- `agruparPorNit`: dos contactos con el mismo NIT se quedan con la fecha más
  reciente de cada tipo; un contacto sin facturas da las tres fechas `null`; los
  NIT de relleno no aparecen.
- Router con un pool falso: 401 sin token; 403 con un usuario sin la app; 200 con
  un admin sin la app asignada; 400 con un cuerpo que no es una lista, con 151
  NIT y con un NIT inválido; el 200 devuelve solo los NIT pedidos y cada objeto
  tiene exactamente los cuatro campos (con la caché sembrada con campos de más);
  la segunda llamada no vuelve a consultar el pool; la sexta petición en un
  minuto da 429, otro usuario no lo nota y un 403 del mismo usuario no gasta
  cupo.
- La consulta SQL no tiene prueba con BD (el arnés de hub-api no crea el
  esquema `books`): se verifica contra la réplica como se indica arriba.

**App** (`src/lib/clientes.test.ts`, `src/services/clientesZoho.test.ts`,
`src/lib/exportProspects.test.ts`):

- `nitBase` con el formato del dataset y con NIT vacío.
- `estadoCliente` en los cinco estados y en el borde exacto de los 36 meses (ese
  día cuenta como activo; el anterior, como antiguo), incluido un `hoy` a final
  de mes.
- `filtrarPorCliente` con «Todos» y con un estado.
- Las cuatro columnas nuevas del Excel, con datos y vacías (sin cruce).
- `fetchClientesZoho` con `fetch` simulado: envía los NIT y la cabecera de
  autorización, convierte la respuesta en `Map`, lanza error con un 500 y con el
  tope de tiempo.

`Prospectos.tsx` y `CeldaCliente.tsx` no llevan tests, como el resto de páginas
de la app (no hay jsdom). Se comprueban con `tsc -b` de la app y del portal y en
el navegador.

## Despliegue

- Primero hub-api y después el portal. Si el portal llega antes, el endpoint da
  404 y la vista funciona con el aviso.
- No hay migración ni variables nuevas.

## Fuera de alcance

- Importes facturados.
- Una vista o un filtro por «tiene OCMA» aparte del que da la columna.
- El cruce en el Buscador o en el Dashboard.
- El marcado manual de prospectos.
- Detectar el dígito de verificación pegado al NIT en Zoho (se mide en la
  verificación; si hay casos, se decide aparte).
