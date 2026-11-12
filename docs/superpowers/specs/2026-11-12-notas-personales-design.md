# Ausencias — Notas personales del administrador

**Fecha:** 2026-11-12
**Estado:** implementado en la rama `feat/ausencias-notas` (plan:
`docs/superpowers/plans/2026-11-12-notas-personales.md`); pendiente de desplegar hub-api y el portal
**Depende de:** la app de Vacaciones y Permisos (`apps/ausencias` + `apps/hub-api/src/ausencias`),
en producción, y la partición en barriles de ARQ-612.

## 1. Objetivo

Una pestaña nueva, **«Notas»**, en la app de Vacaciones y Permisos donde el administrador
apunta las solicitudes personales que no pasan por el flujo formal (avisos de retraso,
peticiones sueltas, otros asuntos) y lleva su registro: quién lo pidió, de qué tipo es, qué
se dijo, una imagen de apoyo y si ya está atendido.

## 2. Decisiones (cerradas en brainstorming)

- **Visible solo para el rol `admin`.** No existe un rol «super administrador»: `portal.users`
  solo admite `admin` y `reader`, y `esAdmin` sale de `role === 'admin'` en el JWT
  (`apps/hub-api/src/ausencias/router.ts`). Verificado en producción el 2026-11-12: hay un
  único usuario `admin`, que es quien pidió esta pestaña. (Este repo es público: no se anota
  aquí qué cuenta es.)
- **Cada nota es de quien la escribe.** Además del candado de rol, toda consulta filtra por
  `autor_email`. Si algún día hay un segundo administrador, no verá estas notas. Es la única
  excepción a «un admin lo tiene todo», y se acepta porque son notas personales, no datos de
  la empresa.
  Ojo: la propiedad va por el correo, no por el id de usuario. Si se borra un usuario
  administrador, sus notas quedan sin dueño visible, y una cuenta nueva con el mismo correo
  las heredaría. Se acepta: el correo es la identidad que usa toda la app.
- **Con estado:** `abierta` / `resuelta`, filtrable.
- **Tabla propia, fuera de `solicitudes_ausencia`.** Meterlas como un tipo más obligaría a
  excluirlas en cada consulta de saldo, KPIs, calendario y Registro general; un olvido las
  mezclaría con los números de la empresa (ya pasó con el otorgamiento en estacionalidad).
- **Una imagen como máximo por nota.**
- **Editables y borrables de verdad.** Son notas propias: no se deja rastro de auditoría.

## 3. Datos (migración 076)

### `portal.ausencias_notas`

| Columna | Tipo | Regla |
|---|---|---|
| `id` | `UUID` PK | `gen_random_uuid()` |
| `empleado_id` | `UUID` NULL | `REFERENCES portal.empleados(id) ON DELETE SET NULL` |
| `empleado_nombre` | `VARCHAR(255)` NOT NULL | Copia del nombre al crear la nota |
| `categoria` | `VARCHAR(20)` NOT NULL | `CHECK IN ('retraso', 'solicitud', 'otro')` |
| `fecha` | `DATE` NOT NULL | El día al que se refiere la nota |
| `comentario` | `TEXT` NOT NULL | `CHECK (comentario ~ '\S' AND char_length(comentario) <= 2000)`. No `btrim`: sin segundo argumento solo quita espacios y dejaría pasar un comentario de tabuladores o saltos de línea |
| `estado` | `VARCHAR(10)` NOT NULL DEFAULT `'abierta'` | `CHECK IN ('abierta', 'resuelta')` |
| `resuelta_at` | `TIMESTAMPTZ` NULL | Coherente con `estado` (CHECK: `resuelta` ⇔ no nulo) |
| `autor_email` | `VARCHAR(254)` NOT NULL | En minúsculas |
| `created_at`, `updated_at` | `TIMESTAMPTZ` NOT NULL DEFAULT `NOW()` | |

Índice: `(autor_email, fecha DESC)`. Todos los CHECK llevan nombre explícito (`*_ck` y
`ausencias_notas_resuelta_coherente`), y `notas.estatico.test.ts` vigila que sus listas y su
tope digan lo mismo que las constantes de `types.ts`.

`ON DELETE SET NULL` + `empleado_nombre` y no `RESTRICT` ni `CASCADE`: `RESTRICT` haría que
borrar una ficha mal dada de alta fallara por una nota que nadie más ve, y `CASCADE` borraría
notas sin avisar. Con la copia del nombre la nota sigue legible aunque la ficha desaparezca.

Etiquetas en pantalla: `retraso` → *Informar retraso*, `solicitud` → *Solicitudes*,
`otro` → *Otros*.

### `portal.ausencias_nota_imagenes`

| Columna | Tipo | Regla |
|---|---|---|
| `id` | `UUID` PK | |
| `nota_id` | `UUID` NOT NULL UNIQUE | `REFERENCES portal.ausencias_notas(id) ON DELETE CASCADE` |
| `nombre_archivo` | `VARCHAR(255)` NOT NULL | |
| `mime` | `VARCHAR(20)` NOT NULL | `CHECK IN ('image/jpeg', 'image/png', 'image/webp')` |
| `contenido` | `BYTEA` NOT NULL | Hasta 8 MB |
| `created_at` | `TIMESTAMPTZ` NOT NULL DEFAULT `NOW()` | |

Tabla aparte, como `solicitud_adjuntos`, para que listar notas no arrastre los bytes.
`UNIQUE (nota_id)` impone la regla de una imagen por nota en la base.

## 4. API (hub-api)

Código en `repo/notas.ts` y `service/notas.ts`, exportados desde sus barriles; rutas en
`router.ts`. Todas van detrás de `requireAuth, requireAdmin`, como el resto de rutas de
administración del router.

| Método y ruta | Cuerpo / respuesta |
|---|---|
| `GET /api/ausencias/notas` | Todas las notas del autor, ordenadas por `fecha DESC, created_at DESC`. Cada una trae `imagen: { id, nombreArchivo, mime, bytes } \| null`, sin el contenido |
| `POST /api/ausencias/notas` | `{ empleadoId, categoria, fecha, comentario, imagen?: { nombreArchivo, mime, contenidoBase64 } }` → la nota creada |
| `PATCH /api/ausencias/notas/:id` | Cualquier subconjunto de `categoria`, `fecha`, `comentario`, `estado`, `empleadoId`, `imagen`. `imagen: null` la quita; `imagen: {...}` la sustituye. Cambiar `empleadoId` vuelve a copiar `empleado_nombre`. Al pasar a `resuelta` se fija `resuelta_at`; al reabrir se vacía. Un cuerpo sin ningún campo reconocido es 400 `sin_cambios` |
| `DELETE /api/ausencias/notas/:id` | 204. La imagen cae por cascada |
| `GET /api/ausencias/notas/:id/imagen` | Los bytes, con su `Content-Type`, `Content-Disposition: inline` (sin nombre de fichero: lo escribe el cliente y un carácter fuera de latin1 haría lanzar a Node), `X-Content-Type-Options: nosniff` y `Cache-Control: no-store` |

### Errores

- **403** `forbidden` si la sesión no es `admin` (lo contesta `requireAdmin`). Es el candado
  de verdad: la pestaña oculta no basta.
- **404** `nota_no_encontrada` si la nota no existe **o es de otro autor**. 404 y no 403
  para no revelar que existe.
- **404** `empleado_no_encontrado` si `empleadoId` no es una ficha activa. Mismo código y
  estado que ya usa la app para ese caso.
- **404** `imagen_no_encontrada` al pedir la imagen de una nota que no tiene o que es ajena.
- **400** con código propio: `categoria_invalida`, `estado_invalido`, `fecha_invalida` (también
  una fecha anterior a `0001-01-01`, que Postgres no admite), `comentario_vacio`,
  `comentario_invalido` (un carácter NUL, que Postgres no admite en `text`),
  `comentario_demasiado_largo`, `sin_cambios`, `nombre_archivo_invalido`, `imagen_no_admitida`,
  `imagen_demasiado_grande`.
- En el front, `api/notas.ts` conserva el código de los 404 (si no, `mensajeDeError` los
  convertiría en «No se pudieron cargar los datos») y `notas.ts` pone cada código en palabras.

### Imagen

- Se valida el MIME declarado **y** los primeros bytes: JPEG `FF D8 FF`, PNG
  `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP`. La imagen se pinta dentro de la página;
  fiarse solo del MIME declarado dejaría colar otra cosa (p. ej. un SVG con script).
- Límite 8 MB decodificados (`MAX_ADJUNTO_BYTES`, el mismo de los PDF).
- **Parser propio:** `app.use('/api/ausencias/notas', express.json({ limit: '12mb' }))`
  registrado en `index.ts` **antes** del parser global de 2 MB. Sin él, cualquier foto de
  móvil da 413.

## 5. Pantalla (apps/ausencias)

- `'notas'` se añade a `PESTANAS_VALIDAS` (abre con `/ausencias#notas`). La pestaña se
  muestra solo con `contexto.esAdmin`, junto a Empleados y Organigrama.
- **Alta**, plegable bajo un botón «Nueva nota»:
  - Persona: desplegable con las fichas activas por orden alfabético (la lista que ya usa
    Empleados). Sin buscador: se quitó a petición del usuario tras verlo en producción.
  - Categoría: tres botones (*Informar retraso* / *Solicitudes* / *Otros*).
  - Fecha: hoy por defecto.
  - Comentario: obligatorio, con contador hasta 2000.
  - Imagen: `<input type="file" accept="image/jpeg,image/png,image/webp">` con vista previa.
- **Lista:**
  - Filtros: categoría (*Todas* + las tres), estado (*Abiertas* por defecto / *Resueltas* /
    *Todas*) y persona. Se aplican en el cliente.
  - Orden: fecha descendente.
  - Fila: fecha, persona, chip de categoría, comentario, «📎 imagen» si la tiene, y
    *Marcar resuelta* / *Reabrir*, *Editar*, *Borrar*.
  - La imagen se descarga solo al pulsar el indicador: `fetch` con token → blob → URL de
    objeto, que se revoca al cerrarla.
  - Borrar pide confirmación dentro de la fila, sin `window.confirm`.

## 6. Verificación

- **hub-api, unitarios:** validación pura de categoría, estado, fecha, comentario, MIME,
  primeros bytes y tamaño.
- **hub-api, BD (`repo.notas.db.test.ts`):** filtro por autor en listar, leer, editar,
  borrar y descargar la imagen; cascada de la imagen; `SET NULL` al borrar la ficha;
  `UNIQUE (nota_id)`; los CHECK de la migración.
- **hub-api, router:** 403 a quien no es admin en las cinco rutas; 404 a la nota ajena;
  cuerpo de ~10 MB aceptado en `POST` (el parser propio).
- **Candados falsados:** cada uno se rompe en el código de verdad y debe matar su test.
  Commit antes de mutar.
- **Front:** `tsc --noEmit` + `vite build`, y comprobación en navegador real antes de empujar.

## 7. Despliegue

hub-api primero (migración 076), portal después. Mientras solo esté hub-api, la pestaña no
existe y nada cambia para nadie.

## 8. Fuera de alcance

- Varias imágenes por nota, PDF u otros ficheros.
- Recordatorios, avisos por correo o integración con n8n.
- Exportar las notas.
- Que las notas cuenten en saldos, KPIs, calendario o Registro general.
