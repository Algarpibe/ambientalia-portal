# Tipos de servicio creables desde Configuración — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans para ejecutar este plan tarea a tarea. Los pasos llevan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** que en «Configuración» → «Plazos por tipo de servicio» quien tiene `config.write` pueda crear tipos de servicio simples (nombre y días hábiles) y borrar los creados en la app que ningún ticket abierto usa, con sus días en la agenda.

**Arquitectura:** la regla pura vive en `dominio.ts` (hub-api, compartido con la sub-app): `errorNombreTipo` (el nombre de un tipo nuevo, con `TIPO_SERVICIO_MAX`), `TIPOS_SEMBRADOS` (los siete de la 043 y la 045, vigilados contra los .sql en `plazos.test.ts`) y `tipoBorrable`. `types.ts` gana `PlazoServicio.borrable`, `parseTipoNuevo` y `parseClaveTipo`; `repo.ts`, `crearTipo` (un `INSERT … ON CONFLICT DO NOTHING` firmado: 409 `tipo_existente` si no inserta) y `borrarTipo` (409 `tipo_sembrado` sin consultar; en una transacción con la fila bloqueada, 404 `tipo_no_encontrado`, 409 `tipo_en_uso` con el recuento de `listarPlazos`, y el borrado de la fila de `tmc_plazos` y de las de `tmc_agenda_duraciones` de esa clave, nunca la `'*'`); `listarPlazos` calcula `borrable`. `router.ts` registra `POST /trazabilidad/plazos` (201, con una clase `Creado` junto a `Fichero`) y `DELETE /trazabilidad/plazos/:clave`, las dos con `escritura('config.write', …)`. En la sub-app, `src/lib/tiposServicio.ts` (puro: `leerDias`, `leerTipoNuevo` y los textos) y `Configuracion.tsx` pintan la fila de crear, «Borrar» con la pregunta en la propia fila y los errores del servidor en la tabla; tras crear o borrar se relee la tabla de duraciones de la agenda. Sin migración ni tabla nuevas.

**Tecnología:** TypeScript, Express + PostgreSQL (`@algarpibe/zoho-sync`) en hub-api, React 19 + Vite + Tailwind en la sub-app, Vitest (unitarias, supertest con un pool de mentira y `*.db.test.ts` contra Postgres en Docker).

**Diseño aprobado:** `docs/superpowers/specs/2026-11-24-tipos-servicio-creables-design.md` (léelo entero antes de empezar).

---

## Convenciones de ejecución (obligatorias)

- **Raíz del repo:** `C:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07` (en Git Bash: `/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07`). Todos los comandos parten de ahí.
- **Rama:** `feat/tipos-servicio-creables` (ya existe, sale de `main` y lleva el commit del diseño, `11c1745`; Alfonso commitea este plan aparte). Se trabaja en ella; al final, `git merge --no-ff` en `main` y `git push origin main` (autorización permanente del usuario). Empujar NO despliega.
- **Ficheros:** se crean y se cambian SOLO con las herramientas Write / Edit. Nunca con `Set-Content`, `Out-File`, `sed`, `perl` ni redirecciones: PowerShell 5.1 destroza las tildes del fichero entero. En disco están en CRLF (`core.autocrlf=true`; en el índice, LF) y Edit lo respeta. Todos los «sustituir» de este plan se comprobaron el 2026-11-24 aplicándolos en orden sobre una copia: cada texto aparece exactamente una vez en su fichero en el momento de aplicarlo; si alguno no casa, lee ese tramo con Read y copia el texto de ahí.
- **Git:** con la herramienta **Bash (Git Bash)**, no con PowerShell. Mensajes con `git commit -F - <<'EOF' … EOF`. Conventional commits en español, **sin línea «Co-Authored-By» ni ninguna atribución**. Se añaden rutas explícitas: nunca `git add -A` ni `git add .`, nunca `git stash`. No se tocan `.gitignore`, `.atl/`, `apps/WO-sales/prompts/`, `img/` ni `openspec/` (ya están modificados o sin seguimiento, y son del usuario).
- **Tamaño y DOS merges:** la regla es menos de 800 líneas cambiadas por merge, sin contar los documentos de diseño y plan: `git diff --shortstat main...HEAD -- . ':(exclude)docs/superpowers'` (inserciones + borrados). Contadas sobre los propios Edit de este plan, el cambio entero son **unas 820** (el `CLAUDE.md` de la sub-app cuenta), así que **va en dos merges desde la misma rama**: **A** = hub-api (Tareas 1-5, unas 490; se mergea en la Tarea 6) y **B** = la sub-app y el documento vivo (Tareas 7-9, unas 330; se mergea en la Tarea 9). El merge A funciona solo: un portal viejo ignora `borrable` y no llama a las rutas nuevas. Se despliega una vez, tras el merge B (Tarea 9, paso 9).
- **Repo público:** datos ficticios siempre («Reparación», «Revisión», «Instalación», correos `@example.com` o los `@ambientalia.com.co` que ya usan las pruebas). Nunca abrir `apps/trazabilidad-mantenimientos/data/*.xlsx`, ni leer `.env*` ni secretos.
- **TDD estricto** en la lógica pura, en el SQL y en las rutas: prueba que falla, verla fallar, código mínimo, verla pasar, commit.
- **Pruebas de hub-api:** `Push-Location apps/hub-api; npx vitest run <fichero>; Pop-Location` (PowerShell). La suite entera es `npm test` desde `apps/hub-api`. Las de BD (`*.db.test.ts`) necesitan Docker Desktop encendido (`docker desktop start`) y van con `npx vitest run --config vitest.db.config.ts <fichero>`; la suite de BD entera, `npm run test:db`. **Nunca lances vitest desde la raíz** (mete los `.db.test.ts` y salen unos 281 fallos falsos). Docker se para con `docker desktop stop`, nunca con `wsl --shutdown`.
- **Pruebas de la sub-app:** desde `apps/trazabilidad-mantenimientos`: `npm test`, `npm run typecheck` y `npm run build` (las pruebas son sólo de lógica pura en `src/lib`, entorno node: la pantalla no tiene pruebas automáticas).
- **Errores conocidos que no son de este trabajo:** `npx tsc -p tsconfig.json --noEmit` en hub-api puede dar un error en `src/ausencias/service/barril.test.ts` (tipos de `micromatch`); no lo persigas. Bajo carga, la prueba 4.4 de usuarios de hub-api puede caer por tiempo: repítela sola antes de investigar.
- **Candados** (pruebas que leen el código fuente o fijan listas cerradas): sólo se amplían, nunca se relajan. Los que toca este plan están en «Candados» más abajo; ninguno se relaja. Si una tarea pareciera necesitar relajar uno, se para y se pregunta a Alfonso.
- **Palabras prohibidas en hub-api** (candado de `envio-avisos.test.ts`, que lee todo `src/trazabilidad`): en el código nuevo de hub-api, comentarios incluidos, no escribas `fetch`, `n8n`, `webhook`, `nodemailer`, `smtp`, `sendMail` ni `outbox`. Y `repo.ts` no puede nombrar la tabla de equipos del inventario más que donde ya la nombra (`seguimiento.test.ts`).

## Decisiones tomadas en el plan

El diseño choca con el código, o no dice nada, en estos puntos. El plan sigue la opción marcada. **D1 quedó resuelto el 2026-11-24: el `POST` contesta 200, no 201** (se sigue el bloque «Si D1 es que no» de la Tarea 5), así que no cambia ninguna aserción de la matriz de roles; las demás no tocan ningún candado.

| # | Choque o silencio | Opción del plan |
|---|---|---|
| D1 | El diseño pide **201** para `POST /trazabilidad/plazos`. En `router.ts` el envoltorio `route` contesta siempre 200 (o un fichero), y dos pruebas de la matriz de roles de `router.test.ts` («`$rol sí puede $ruta`», `:331-335`, y «un administrador del portal puede `$ruta`…», `:349-353`) aceptan sólo `[200, 404]`. No leen el código (no son candados de fuente), pero son guardas de los permisos y cubrirán la ruta nueva. | **201**: una clase `Creado` junto a `Fichero` en `router.ts` (el envoltorio la contesta con `res.status(201)`), y en esas dos pruebas `[200, 404]` pasa a **`[200, 201, 404]`**: se añade el resultado «pasó el permiso y creó»; el 403 sigue fallando igual. **Alternativa si Alfonso no quiere tocar esas aserciones:** 200, como todas las demás escrituras de trazabilidad (ver Tarea 5, «Si D1 es que no»). |
| D2 | «Ningún ticket abierto lo usa, ni con el tipo de Desk ni con el puesto a mano: el mismo recuento que la columna «Tickets abiertos»». Ese recuento (`listarPlazos`) cuenta cada ticket **en su tipo efectivo**: uno con el tipo X de Desk y el Y puesto a mano cuenta en Y, no en X. | El mismo recuento, tal cual (`listarPlazos` dentro de la transacción del borrado). Ese X sale borrable; borrarlo no cambia nada a ese ticket, que sigue con Y. |
| D3 | El orden de los errores del borrado no se dice. | 409 `tipo_sembrado` primero, **sin consultar nada** (es una regla del dominio); después, ya en la transacción, 404 `tipo_no_encontrado` y 409 `tipo_en_uso`. Un sembrado cuya fila se borró a mano por SQL da 409, no 404. |
| D4 | El diseño no dice cómo es `:clave` en `DELETE /trazabilidad/plazos/:clave`. | La clave **ya normalizada** (`claveTipoServicio`: «reparacion», no «Reparación»), no vacía y de 80 como mucho; si no, 400 en `clave` (`parseClaveTipo`, como `parseClaveMarca`). La pantalla manda `p.clave`. |
| D5 | Carrera: el borrado bloquea su fila de `tmc_plazos` (`FOR UPDATE`), pero `PUT /trazabilidad/servicios/:numero/tipo` (`fijarTipoServicio`) la lee sin bloqueo. Si en el mismo instante se le pone ese tipo a un ticket, el ticket puede quedarse con una clave a mano sin fila. | Se acepta sin tocar `fijarTipoServicio`: ese estado ya está previsto (`tmc_servicios_tipo` guarda la etiqueta «por si su fila dejara de existir»; `listarServicios` la enseña y queda «sin plazo»; `listarPlazos` no inventa la fila). |
| D6 | «La validación de la pantalla es la misma que la del servidor» y «va en funciones puras de `src/lib`». | La regla del nombre vive **una vez** en `dominio.ts` (`errorNombreTipo`, `TIPO_SERVICIO_MAX`), que ya comparten servidor y sub-app; el servidor la aplica en `parseTipoNuevo` (y otra vez en `crearTipo`) y la sub-app en `leerTipoNuevo` (`src/lib/tiposServicio.ts`), con el mismo texto. Los días de la sub-app usan `leerEntero` (`src/lib/agenda.ts`, ya probado), con el mismo mensaje que el `leer` que había dentro de `Configuracion.tsx`, que se va. Como `parseEstadoDesk`, también la **clave** tiene que caber en 80 (quitar tildes con NFD alarga algún alfabeto: sin esto, un 500 de Postgres). |
| D7 | «Como hoy en `parsePlazo`» para el compuesto. | 400 en `tipo`, como `parsePlazo`, pero con un texto de crear («… es un tipo compuesto: su plazo es la suma del de sus partes y no se crea aquí»), no el de editar su plazo. El nombre tiene que ser texto (un número es 400 «`tipo` debe ser texto», a diferencia del `PUT`, que lo admite) y se guarda **sin los espacios de los extremos**, sin juntar los de dentro (como `guardarPlazo`). El 409 `tipo_existente` dice el nombre tecleado: no se busca la etiqueta guardada (una sola sentencia, sin carrera). |
| D8 | «Los errores del servidor (409 y 400) se enseñan en la tabla con su mensaje.» | El error al crear sale **bajo la fila de crear**; el error al borrar, **bajo el nombre del tipo en su fila**, y tras él se relee la lista (si ya lo usa un ticket, «Borrar» se va; si otra persona lo borró, la fila desaparece). El aviso rojo de arriba de la tarjeta sigue para los fallos de cargar y de guardar un plazo, como hoy. |
| D9 | El diseño no habla de la tarjeta «Duraciones» de la agenda, que saca sus columnas de `GET /plazos` y se carga una vez. Sin releerla, tras crear no sale la columna nueva y tras borrar se siguen viendo días que ya no existen. | `useAgendaConfig` gana `recargar` (en la misma fila que sus cambios) y `Plazos` la llama tras crear o borrar (prop `onTipos`). |
| D10 | Las pruebas de BD del diseño hablan de «201», «200», «409» y «404». `trazabilidad.db.test.ts` no tiene arnés HTTP, y meterle el `vi.mock('../db.js')` de los otros ficheros le quitaría `aplicarMigraciones`, que usa. | En BD se prueba el repo contra Postgres de verdad (`status` y `code` de cada `TzError`, la fila firmada, las duraciones); los 201/200/400/409/404 de HTTP, en `router.test.ts` con su pool de mentira. |
| D11 | Los botones de la pregunta. `ui.tsx` no tiene variante «peligro». | «Sí, borrar» `primary`, «Cancelar» `ghost`; la fila se tiñe de ámbar mientras pregunta. Tras borrar, el aviso «Tipo «X» borrado» (el diseño sólo da el de crear). |

## Sitios que construyen un `PlazoServicio`

Al añadir el campo obligatorio `borrable` hay que tocarlos todos (los demás sólo lo leen):

1. `apps/hub-api/src/trazabilidad/repo.ts` — `listarPlazos` (líneas 565-615): los dos literales (las filas de `tmc_plazos`, `:580-588`, y los tipos que sólo traen los tickets, `:602-610`). El mapa pasa a `Omit<PlazoServicio, 'borrable'>` y `borrable` se añade al final, con los recuentos ya hechos.
2. `apps/trazabilidad-mantenimientos/src/lib/agenda.test.ts:83` — el fixture `plazo()`.
3. `apps/trazabilidad-mantenimientos/src/lib/servicios.test.ts:242-253` — el fixture `fila()`.
4. Y dos objetos **esperados enteros** (`toEqual`) en `apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts`: `:1441-1452` (el compuesto) y `:1543-1551` («Instalación», sólo en los tickets). Ganan `borrable: false`.

`router.test.ts` no construye ninguno (su base de mentira devuelve listas vacías). `trazabilidad.db.test.ts:971-973` compara `listarPlazos` «antes / después» y sigue valiendo.

## Candados

| Candado | Qué hace este plan |
|---|---|
| `router.test.ts:289-320` «son las veintiséis escrituras del router…» (lee `router.ts`: toda ruta `post`/`put`/`patch`/`delete` con `escritura` o `soloAdmin`, y su permiso igual al de `ESCRITURAS`) | **Se amplía**, como en cada escritura nueva: dos entradas en `ESCRITURAS` (`POST /trazabilidad/plazos` y `DELETE /trazabilidad/plazos/:clave`, las dos `config.write`) y el título dice «veintiocho». La lógica no cambia. |
| `router.test.ts:331-335` y `:349-353` (`[200, 404]`) | Ver **D1**: con el 200, no cambian. |
| `router.test.ts:355-371` «el permiso va antes que la validación» | **Se amplía** con una línea por ruta nueva. |
| `plazos.test.ts:395-489` (043 y 045: semillas normalizadas, idempotencia) | No se tocan. Se **añade** uno nuevo: `TIPOS_SEMBRADOS` es exactamente lo que siembran la 043 y la 045, y ninguna otra migración siembra `tmc_plazos`. |
| `dominio.test.ts:367-372` «dominio.ts no importa nada» | Se respeta: lo nuevo de `dominio.ts` sólo usa `claveTipoServicio` y `partesDeTipo`, del mismo fichero. |
| `envio-avisos.test.ts:227-233` (palabras de red en `src/trazabilidad`), `seguimiento.test.ts` (la tabla de equipos en `repo.ts`), `fst022.test.ts:59-63`, `calibraciones.test.ts:457`, `contratos-repo.test.ts`, `vigencia-repo.test.ts` | No se tocan y deben seguir en verde: el código nuevo no escribe en ninguna de sus tablas ni usa sus palabras. |
| `trazabilidad.db.test.ts:337-383` (la lista de tablas `tmc_*`) | Sin tabla nueva: no cambia. |
| `agenda-config.test.ts` (la semilla de la 050/051) | No se toca: no hay migración. |

## Mapa de ficheros

| Fichero | Tarea | Qué |
|---|---|---|
| `apps/hub-api/src/trazabilidad/dominio.ts` | 1 | `TIPO_SERVICIO_MAX`, `TIPOS_SEMBRADOS`, `errorNombreTipo`, `tipoBorrable` |
| `apps/hub-api/src/trazabilidad/dominio.test.ts` | 1 | Sus casos |
| `apps/hub-api/src/trazabilidad/plazos.test.ts` | 1, 2 | Candado de `TIPOS_SEMBRADOS` contra los .sql (1); `parseTipoNuevo` y `parseClaveTipo` (2) |
| `apps/hub-api/src/trazabilidad/types.ts` | 2, 3 | `diasDePlazo` sacado de `parsePlazo`, `parseTipoNuevo`, `parseClaveTipo` (2); `PlazoServicio.borrable` (3) |
| `apps/hub-api/src/trazabilidad/repo.ts` | 3, 4 | `listarPlazos` calcula `borrable` (3); `crearTipo`, `borrarTipo` (4) |
| `apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts` | 3, 4 | `borrable` en dos esperados y su caso (3); crear y borrar contra Postgres (4) |
| `apps/trazabilidad-mantenimientos/src/lib/agenda.test.ts`, `src/lib/servicios.test.ts` | 3 | `borrable: false` en sus fixtures |
| `apps/hub-api/src/trazabilidad/router.ts` | 5 | `Creado`; `POST /trazabilidad/plazos` y `DELETE /trazabilidad/plazos/:clave` |
| `apps/hub-api/src/trazabilidad/router.test.ts` | 5 | `appPlazos`, `ESCRITURAS`, D1 y los casos de las dos rutas |
| — | 6 | Merge A (hub-api): suites, tamaño, privacidad, merge y push; sin ficheros |
| `apps/trazabilidad-mantenimientos/src/lib/tiposServicio.ts` (nuevo) | 7 | `leerDias`, `leerTipoNuevo`, `avisoCreado`, `avisoBorrado`, `preguntaBorrar` |
| `apps/trazabilidad-mantenimientos/src/lib/tiposServicio.test.ts` (nuevo) | 7 | Sus casos |
| `apps/trazabilidad-mantenimientos/src/api.ts` | 8 | `crearTipo`, `borrarTipo` |
| `apps/trazabilidad-mantenimientos/src/vistas/ConfiguracionAgenda.tsx` | 8 | `recargar` en `useAgendaConfig` (D9) |
| `apps/trazabilidad-mantenimientos/src/vistas/Configuracion.tsx` | 8 | Fila de crear, «Borrar» con la pregunta en la fila, errores en la fila, texto de ayuda; fuera el `leer` de dentro |
| `apps/trazabilidad-mantenimientos/CLAUDE.md` | 9 | Nota viva: tabla, API, permisos y sección nueva (y, con ella, el merge B) |

---

## Tarea 1 (hub-api): La regla pura — `errorNombreTipo`, `TIPOS_SEMBRADOS` y `tipoBorrable`

**Ficheros:**
- Modificar: `apps/hub-api/src/trazabilidad/dominio.ts:230-233` (añadir detrás de `partesDeTipo`)
- Prueba: `apps/hub-api/src/trazabilidad/dominio.test.ts:4-38` (import) y `:367` (añadir delante de `describe('pureza'…)`)
- Prueba (candado nuevo): `apps/hub-api/src/trazabilidad/plazos.test.ts:2` y `:4` (imports) y `:485-489` (añadir detrás de la 045)

`dominio.ts` no puede importar nada (candado `dominio.test.ts:367-372`): usa `claveTipoServicio` y `partesDeTipo`, del mismo fichero. La sub-app lo recibe sola por `export * from '../../hub-api/src/trazabilidad/dominio'`. Cuentas de la prueba de la clave larga: «가» (U+AC00) es un carácter, pero en NFD son dos (U+1100 U+1161), que `claveTipoServicio` no quita (sólo quita U+0300–U+036F): 41 de ellos son 41 caracteres y una clave de 82.

- [ ] **Paso 1: escribir las pruebas que fallan** — cuatro Edit.

(a) En `apps/hub-api/src/trazabilidad/dominio.test.ts`, sustituir:

```typescript
  diasEntre,
  esFechaIso,
```

por:

```typescript
  diasEntre,
  errorNombreTipo,
  esFechaIso,
```

(b) En `apps/hub-api/src/trazabilidad/dominio.test.ts`, sustituir:

```typescript
  tipoSugerido,
  TIPOS_COMPUESTOS,
  ESTADOS_PLAZO,
```

por:

```typescript
  tipoSugerido,
  tipoBorrable,
  TIPO_SERVICIO_MAX,
  TIPOS_COMPUESTOS,
  TIPOS_SEMBRADOS,
  ESTADOS_PLAZO,
```

(c) En `apps/hub-api/src/trazabilidad/dominio.test.ts`, sustituir:

```typescript
describe('pureza', () => {
```

por:

```typescript
// Tipos de servicio creados desde Configuración (diseño del 2026-11-24): el nombre de un tipo nuevo y qué tipos se pueden borrar.
describe('tipos de servicio creados desde Configuración', () => {
  const LARGO = 'El nombre no puede pasar de 80 caracteres.';

  it('un nombre vale sin los espacios de los extremos, con alguna letra o algún dígito y hasta 80 caracteres', () => {
    for (const n of ['Reparación', '  Revisión externa  ', '24h', 'a'.repeat(TIPO_SERVICIO_MAX), ` ${'a'.repeat(80)} `]) expect(errorNombreTipo(n)).toBeNull();
  });

  it('vacío o sólo espacios: falta el nombre', () => {
    for (const n of ['', '   ']) expect(errorNombreTipo(n)).toBe('Escribe el nombre del tipo de servicio.');
  });

  it('sólo símbolos (como «*», la fila por defecto de la agenda): no vale', () => {
    for (const n of ['*', ' + ', '--', '¿?']) expect(errorNombreTipo(n)).toBe('El nombre tiene que llevar al menos una letra o un número.');
  });

  it('más de 80 caracteres, o una clave que pasa de 80 al quitar las tildes: no vale', () => {
    expect(TIPO_SERVICIO_MAX).toBe(80);
    expect(errorNombreTipo('a'.repeat(81))).toBe(LARGO);
    expect(claveTipoServicio('가'.repeat(41))).toHaveLength(82);
    expect(errorNombreTipo('가'.repeat(41))).toBe(LARGO);
  });

  it('un tipo compuesto, con cualquier grafía: no se crea', () => {
    for (const n of ['Diagnóstico + Calibración', ' DIAGNOSTICO  +  calibracion ']) expect(errorNombreTipo(n)).toMatch(/es un tipo compuesto/);
  });

  it('TIPOS_SEMBRADOS: los seis de la 043 y el compuesto de la 045, ya normalizados', () => {
    expect([...TIPOS_SEMBRADOS].sort()).toEqual(['calibracion', 'diagnostico', 'diagnostico + calibracion', 'garantia', 'mantenimiento', 'no aplica', 'otro']);
    for (const c of TIPOS_SEMBRADOS) expect(claveTipoServicio(c)).toBe(c);
  });

  it('se borra sólo un tipo creado en la app, con fila propia y sin tickets abiertos', () => {
    expect(tipoBorrable({ clave: 'reparacion', conFila: true, ticketsAbiertos: 0 })).toBe(true);
    expect(tipoBorrable({ clave: 'reparacion', conFila: true, ticketsAbiertos: 1 })).toBe(false);
    // Uno que sólo traen los tickets no tiene fila que borrar.
    expect(tipoBorrable({ clave: 'instalacion', conFila: false, ticketsAbiertos: 0 })).toBe(false);
    // Los sembrados, nunca, aunque nadie los use: volverían con el siguiente arranque.
    for (const clave of TIPOS_SEMBRADOS) expect(tipoBorrable({ clave, conFila: true, ticketsAbiertos: 0 })).toBe(false);
  });
});

describe('pureza', () => {
```

(d) En `apps/hub-api/src/trazabilidad/plazos.test.ts`, sustituir:

```typescript
import { readFileSync } from 'node:fs';
```

por:

```typescript
import { readdirSync, readFileSync } from 'node:fs';
```

(e) En `apps/hub-api/src/trazabilidad/plazos.test.ts`, sustituir:

```typescript
import { CONTACTO_MAX_EMAILS, ROLES_ESTADO, TIPOS_COMPUESTOS, claveTipoServicio, type RolEstado } from './dominio.js';
```

por:

```typescript
import { CONTACTO_MAX_EMAILS, ROLES_ESTADO, TIPOS_COMPUESTOS, TIPOS_SEMBRADOS, claveTipoServicio, type RolEstado } from './dominio.js';
```

(f) En `apps/hub-api/src/trazabilidad/plazos.test.ts`, sustituir:

```typescript
  it('está apuntada en MIGRATIONS, detrás de la 044', () => {
    const db = readFileSync(fileURLToPath(new URL('../db.ts', import.meta.url)), 'utf8');
    expect(db).toMatch(/'044_trazabilidad_servicios_tipo\.sql',\s*'045_trazabilidad_tipo_combinado\.sql'/);
  });
});
```

por:

```typescript
  it('está apuntada en MIGRATIONS, detrás de la 044', () => {
    const db = readFileSync(fileURLToPath(new URL('../db.ts', import.meta.url)), 'utf8');
    expect(db).toMatch(/'044_trazabilidad_servicios_tipo\.sql',\s*'045_trazabilidad_tipo_combinado\.sql'/);
  });
});

describe('TIPOS_SEMBRADOS: los tipos que no se borran desde la app', () => {
  // Candado (2026-11-24): un tipo sembrado volvería solo en el siguiente arranque (las migraciones se ejecutan en cada inicio con
  // ON CONFLICT DO NOTHING), así que la app no deja borrarlo. La lista vive en dominio.ts; aquí se compara con lo que siembran DE
  // VERDAD los .sql: si una migración siembra otro tipo, o deja de sembrar uno, esto falla.
  const MIGRACIONES = fileURLToPath(new URL('../users/migrations/', import.meta.url));
  const leer = (f: string) => readFileSync(`${MIGRACIONES}${f}`, 'utf8');
  const clavesSembradas = (f: string) => [...leer(f).matchAll(/\('([^']+)',\s*'([^']+)',\s*(NULL|\d+)\)/g)].map((m) => m[1]);

  it('sólo la 043 y la 045 siembran portal.tmc_plazos', () => {
    const siembran = readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql') && /INSERT\s+INTO\s+portal\.tmc_plazos\b/i.test(leer(f)));
    expect(siembran.sort()).toEqual(['043_trazabilidad_plazos.sql', '045_trazabilidad_tipo_combinado.sql']);
  });

  it('son exactamente las claves que siembran las dos, ni una más ni una menos', () => {
    const sembradas = [...clavesSembradas('043_trazabilidad_plazos.sql'), ...clavesSembradas('045_trazabilidad_tipo_combinado.sql')];
    expect(sembradas).toHaveLength(7);
    expect([...TIPOS_SEMBRADOS].sort()).toEqual(sembradas.sort());
  });
});
```

- [ ] **Paso 2: ver que fallan**

Ejecuta (PowerShell): `Push-Location apps/hub-api; npx vitest run src/trazabilidad/dominio.test.ts src/trazabilidad/plazos.test.ts; Pop-Location`

Esperado: FAIL en las siete pruebas nuevas de `dominio.test.ts` (`TypeError: errorNombreTipo is not a function`, `TIPOS_SEMBRADOS is not iterable`, `tipoBorrable is not a function`; `TIPO_SERVICIO_MAX` llega `undefined`) y en «son exactamente las claves…» de `plazos.test.ts` (`TIPOS_SEMBRADOS is not iterable`). «sólo la 043 y la 045 siembran…» ya pasa (vigila los .sql, que no cambian). El resto, en verde.

- [ ] **Paso 3: el código mínimo** — en `apps/hub-api/src/trazabilidad/dominio.ts`, sustituir:

```typescript
/** Las claves de las partes de un tipo compuesto, o null si `clave` es un tipo simple. */
export function partesDeTipo(clave: string): readonly string[] | null {
  return Object.prototype.hasOwnProperty.call(TIPOS_COMPUESTOS, clave) ? TIPOS_COMPUESTOS[clave] : null;
}
```

por:

```typescript
/** Las claves de las partes de un tipo compuesto, o null si `clave` es un tipo simple. */
export function partesDeTipo(clave: string): readonly string[] | null {
  return Object.prototype.hasOwnProperty.call(TIPOS_COMPUESTOS, clave) ? TIPOS_COMPUESTOS[clave] : null;
}

// ── Tipos de servicio creados desde Configuración ────────────────────────────
//
// Diseño del 2026-11-24. En «Configuración» se crean tipos de servicio nuevos y
// se borran los creados en la app que ningún ticket abierto usa. La regla del
// nombre y la de qué se puede borrar viven aquí: las aplican el servidor y la
// pantalla, con el mismo texto.

/**
 * Lo más largo que puede ser el nombre de un tipo de servicio, y también su
 * clave: `clave` y `etiqueta` de portal.tmc_plazos (043) y `tipo` de
 * portal.tmc_agenda_duraciones (051) son VARCHAR(80).
 */
export const TIPO_SERVICIO_MAX = 80;

/**
 * Las claves que siembran las migraciones: la 043 (los seis tipos de Zoho) y la
 * 045 (el compuesto). No se borran desde la app: volverían solas en el
 * siguiente arranque (las migraciones se ejecutan en cada inicio, con
 * `ON CONFLICT DO NOTHING`) y el compuesto necesita sus partes.
 * `plazos.test.ts` vigila que sean exactamente las de los dos .sql.
 */
export const TIPOS_SEMBRADOS: readonly string[] = ['diagnostico', 'calibracion', 'mantenimiento', 'garantia', 'otro', 'no aplica', 'diagnostico + calibracion'];

/**
 * Por qué no vale `nombre` para CREAR un tipo de servicio, o null si vale. Sin
 * los espacios de los extremos: de 1 a `TIPO_SERVICIO_MAX` caracteres (y su
 * clave también, que al quitar tildes puede alargarse en algún alfabeto), con
 * al menos una letra o un dígito (así no vale «*», la fila por defecto de la
 * agenda) y sin ser un tipo compuesto (`partesDeTipo`: esos se definen en el
 * código). La aplican `parseTipoNuevo` y `crearTipo` en el servidor y la fila
 * de crear de «Configuración».
 */
export function errorNombreTipo(nombre: string): string | null {
  const n = nombre.trim();
  if (n === '') return 'Escribe el nombre del tipo de servicio.';
  const clave = claveTipoServicio(n);
  if (n.length > TIPO_SERVICIO_MAX || clave.length > TIPO_SERVICIO_MAX) return `El nombre no puede pasar de ${TIPO_SERVICIO_MAX} caracteres.`;
  if (!/[\p{L}\p{N}]/u.test(n)) return 'El nombre tiene que llevar al menos una letra o un número.';
  if (partesDeTipo(clave)) return `«${n}» es un tipo compuesto: su plazo es la suma del de sus partes y no se crea aquí.`;
  return null;
}

/**
 * Si un tipo de «Configuración» se puede borrar: creado en la app (no está en
 * `TIPOS_SEMBRADOS`), con fila propia en portal.tmc_plazos (`conFila`; los que
 * sólo traen los tickets no la tienen) y sin ningún ticket abierto que lo use
 * (`ticketsAbiertos`, el recuento de la columna «Tickets abiertos»).
 */
export function tipoBorrable(t: { clave: string; conFila: boolean; ticketsAbiertos: number }): boolean {
  return t.conFila && t.ticketsAbiertos === 0 && !TIPOS_SEMBRADOS.includes(t.clave);
}
```

- [ ] **Paso 4: ver que pasan**

Ejecuta: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/dominio.test.ts src/trazabilidad/plazos.test.ts; Pop-Location`

Esperado: PASS los dos ficheros enteros (también «dominio.ts no importa nada»).

- [ ] **Paso 5: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/hub-api/src/trazabilidad/dominio.ts apps/hub-api/src/trazabilidad/dominio.test.ts apps/hub-api/src/trazabilidad/plazos.test.ts
git commit -F - <<'EOF'
feat(trazabilidad): regla pura del nombre de un tipo de servicio nuevo y de qué tipos se borran
EOF
```

---

## Tarea 2 (hub-api): El cuerpo de crear y la clave de borrar — `parseTipoNuevo` y `parseClaveTipo`

**Ficheros:**
- Modificar: `apps/hub-api/src/trazabilidad/types.ts:16-23` (imports) y `:417-432` (`parsePlazo` y lo nuevo detrás)
- Prueba: `apps/hub-api/src/trazabilidad/plazos.test.ts:5` (import) y el final del fichero (detrás del candado de la Tarea 1)

`parsePlazo` no cambia de comportamiento (el `PUT` sigue igual, lo dice el diseño): sólo se saca su comprobación de los días a `diasDePlazo`, que comparten las dos. Las pruebas de siempre del `PUT` (`router.test.ts:563-596`) lo vigilan.

- [ ] **Paso 1: escribir la prueba que falla** — dos Edit.

(a) En `apps/hub-api/src/trazabilidad/plazos.test.ts`, sustituir:

```typescript
import { ROLES_APP } from './roles.js';
```

por:

```typescript
import { ROLES_APP } from './roles.js';
import { TzError, parseClaveTipo, parseTipoNuevo } from './types.js';
```

(b) En `apps/hub-api/src/trazabilidad/plazos.test.ts`, sustituir:

```typescript
    expect(sembradas).toHaveLength(7);
    expect([...TIPOS_SEMBRADOS].sort()).toEqual(sembradas.sort());
  });
});
```

por:

```typescript
    expect(sembradas).toHaveLength(7);
    expect([...TIPOS_SEMBRADOS].sort()).toEqual(sembradas.sort());
  });
});

describe('crear un tipo: el cuerpo de POST /trazabilidad/plazos (parseTipoNuevo) y la clave de DELETE (parseClaveTipo)', () => {
  /** El 400 que da, como [campo, mensaje]; null si no da error. */
  const error = (f: () => unknown): [string | undefined, string] | null => {
    try {
      f();
      return null;
    } catch (e) {
      if (e instanceof TzError && e.status === 400) return [e.field, e.messageEs];
      throw e;
    }
  };

  it('el nombre, sin los espacios de los extremos; días entre 1 y 365, o vacíos (sin plazo)', () => {
    expect(parseTipoNuevo({ tipo: '  Reparación  ', dias: 5 })).toEqual({ tipo: 'Reparación', dias: 5 });
    for (const dias of [1, 365]) expect(parseTipoNuevo({ tipo: 'Reparación', dias }).dias).toBe(dias);
    for (const dias of [null, undefined, '']) expect(parseTipoNuevo({ tipo: 'Reparación', dias })).toEqual({ tipo: 'Reparación', dias: null });
  });

  it('el nombre, con la regla de errorNombreTipo: vacío, sólo símbolos, más de 80 o un compuesto → 400 en «tipo»', () => {
    expect(error(() => parseTipoNuevo({ dias: 3 }))).toEqual(['tipo', 'Escribe el nombre del tipo de servicio.']);
    expect(error(() => parseTipoNuevo({ tipo: '   ', dias: 3 }))).toEqual(['tipo', 'Escribe el nombre del tipo de servicio.']);
    expect(error(() => parseTipoNuevo({ tipo: '*', dias: 3 }))).toEqual(['tipo', 'El nombre tiene que llevar al menos una letra o un número.']);
    expect(error(() => parseTipoNuevo({ tipo: 'a'.repeat(81), dias: 3 }))).toEqual(['tipo', 'El nombre no puede pasar de 80 caracteres.']);
    expect(error(() => parseTipoNuevo({ tipo: ' diagnostico + CALIBRACIÓN ', dias: null }))?.[1]).toMatch(/es un tipo compuesto/);
    expect(error(() => parseTipoNuevo({ tipo: 7, dias: 3 }))).toEqual(['tipo', '«tipo» debe ser texto.']);
    expect(error(() => parseTipoNuevo(null))).toEqual(['body', 'El cuerpo de la petición no es válido.']);
  });

  it('días fuera de 1..365, con decimales o como texto → 400 en «dias», con el mensaje de editar un plazo', () => {
    for (const dias of [0, 366, -1, 1.5, '5', true]) {
      expect(error(() => parseTipoNuevo({ tipo: 'Reparación', dias }))).toEqual(['dias', 'El plazo debe ser un número entero de días hábiles entre 1 y 365, o quedar vacío.']);
    }
  });

  it('la clave de la ruta tiene que ser la normalizada, no vacía y de 80 caracteres como mucho', () => {
    expect(parseClaveTipo('reparacion')).toBe('reparacion');
    expect(parseClaveTipo('revision externa')).toBe('revision externa');
    for (const v of ['', 'Reparación', ' reparacion', 'revision  externa', 'a'.repeat(81), undefined, 7]) {
      expect(error(() => parseClaveTipo(v))).toEqual(['clave', '«clave» no es la clave de un tipo de servicio.']);
    }
  });
});
```

- [ ] **Paso 2: ver que falla**

Ejecuta: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/plazos.test.ts; Pop-Location`

Esperado: FAIL en las cuatro pruebas nuevas (`TypeError: parseTipoNuevo is not a function` / `parseClaveTipo is not a function`). El resto, en verde.

- [ ] **Paso 3: el código mínimo** — en `apps/hub-api/src/trazabilidad/types.ts`, tres Edit.

(a) En `apps/hub-api/src/trazabilidad/types.ts`, sustituir:

```typescript
  PUESTOS_MAX,
  TIPO_POR_DEFECTO,
```

por:

```typescript
  PUESTOS_MAX,
  TIPO_POR_DEFECTO,
  TIPO_SERVICIO_MAX,
```

(b) En `apps/hub-api/src/trazabilidad/types.ts`, sustituir:

```typescript
  comoTramoAviso,
  esCategoriaAgenda,
```

por:

```typescript
  comoTramoAviso,
  errorNombreTipo,
  esCategoriaAgenda,
```

(c) En `apps/hub-api/src/trazabilidad/types.ts`, sustituir:

```typescript
export function parsePlazo(body: unknown): CambioPlazo {
  const b = obj(body, 'body');
  const tipo = texto(b.tipo, 'tipo', 80, true)!;
  if (!claveTipoServicio(tipo)) throw invalido('Falta «tipo».', 'tipo');
  if (partesDeTipo(claveTipoServicio(tipo))) throw errorPlazoDerivado(tipo);
  const d = b.dias;
  if (d === null || d === undefined || d === '') return { tipo, dias: null };
  if (typeof d !== 'number' || !Number.isInteger(d) || d < PLAZO_MIN_DIAS || d > PLAZO_MAX_DIAS) {
    throw invalido(`El plazo debe ser un número entero de días hábiles entre ${PLAZO_MIN_DIAS} y ${PLAZO_MAX_DIAS}, o quedar vacío.`, 'dias');
  }
  return { tipo, dias: d };
}
```

por:

```typescript
export function parsePlazo(body: unknown): CambioPlazo {
  const b = obj(body, 'body');
  const tipo = texto(b.tipo, 'tipo', 80, true)!;
  if (!claveTipoServicio(tipo)) throw invalido('Falta «tipo».', 'tipo');
  if (partesDeTipo(claveTipoServicio(tipo))) throw errorPlazoDerivado(tipo);
  return { tipo, dias: diasDePlazo(b.dias) };
}

/** Los días de un plazo en un cuerpo: vacío (null o '') = sin plazo; si no, un entero de PLAZO_MIN_DIAS a PLAZO_MAX_DIAS (400 en «dias»). */
function diasDePlazo(d: unknown): number | null {
  if (d === null || d === undefined || d === '') return null;
  if (typeof d !== 'number' || !Number.isInteger(d) || d < PLAZO_MIN_DIAS || d > PLAZO_MAX_DIAS) {
    throw invalido(`El plazo debe ser un número entero de días hábiles entre ${PLAZO_MIN_DIAS} y ${PLAZO_MAX_DIAS}, o quedar vacío.`, 'dias');
  }
  return d;
}

/**
 * Valida el cuerpo de POST /trazabilidad/plazos (crear un tipo de servicio,
 * 2026-11-24): `tipo`, el nombre, con la regla de `errorNombreTipo` (dominio.ts,
 * la misma que aplica la pantalla), y `dias`, como en `parsePlazo`. Devuelve el
 * nombre sin los espacios de los extremos.
 */
export function parseTipoNuevo(body: unknown): CambioPlazo {
  const b = obj(body, 'body');
  if (b.tipo !== null && b.tipo !== undefined && typeof b.tipo !== 'string') throw invalido('«tipo» debe ser texto.', 'tipo');
  const tipo = typeof b.tipo === 'string' ? b.tipo.trim() : '';
  const error = errorNombreTipo(tipo);
  if (error) throw invalido(error, 'tipo');
  return { tipo, dias: diasDePlazo(b.dias) };
}

/** La clave de DELETE /trazabilidad/plazos/:clave: la de un tipo de servicio, ya normalizada («reparacion», no «Reparación»). */
export function parseClaveTipo(v: unknown): string {
  if (typeof v !== 'string' || v === '' || v.length > TIPO_SERVICIO_MAX || v !== claveTipoServicio(v)) throw invalido('«clave» no es la clave de un tipo de servicio.', 'clave');
  return v;
}
```

- [ ] **Paso 4: ver que pasa, y que el `PUT` sigue igual**

Ejecuta: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/plazos.test.ts src/trazabilidad/router.test.ts; Pop-Location`

Esperado: PASS los dos ficheros enteros (en `router.test.ts`, «plazo no válido (…) → 400 en «dias»», «plazo sin tipo de servicio» y «el plazo del tipo compuesto … no se edita», como siempre).

- [ ] **Paso 5: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/hub-api/src/trazabilidad/types.ts apps/hub-api/src/trazabilidad/plazos.test.ts
git commit -F - <<'EOF'
feat(trazabilidad): validación del cuerpo para crear un tipo de servicio y de la clave para borrarlo
EOF
```

---

## Tarea 3 (hub-api + fixtures de la sub-app): `listarPlazos` dice si cada tipo se puede borrar — `borrable`

**Ficheros:**
- Modificar: `apps/hub-api/src/trazabilidad/types.ts:397-399` (campo nuevo de `PlazoServicio`)
- Modificar: `apps/hub-api/src/trazabilidad/repo.ts:43-44` (import) y `:578` y `:614` (`listarPlazos`)
- Modificar: `apps/trazabilidad-mantenimientos/src/lib/agenda.test.ts:83` y `apps/trazabilidad-mantenimientos/src/lib/servicios.test.ts:250-255` (fixtures, para que la sub-app siga compilando)
- Prueba: `apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts:1449-1452` y `:1548-1551` (dos esperados enteros) y `:1553-1555` (añadir un caso detrás)

- [ ] **Paso 1: escribir la prueba que falla** — Docker encendido (`docker desktop start`, PowerShell). Tres Edit.

(a) En `apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts`, sustituir:

```typescript
      ticketsAbiertos: 0,
      actualizadoPor: null,
      actualizadoEn: null,
    });
    expect(p.filter((x) => x.derivadoDe !== null).map((x) => x.clave)).toEqual([COMBINADO]);
```

por:

```typescript
      ticketsAbiertos: 0,
      borrable: false,
      actualizadoPor: null,
      actualizadoEn: null,
    });
    expect(p.filter((x) => x.derivadoDe !== null).map((x) => x.clave)).toEqual([COMBINADO]);
```

(b) En `apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts`, sustituir:

```typescript
      ticketsAbiertos: 2,
      actualizadoPor: null,
      actualizadoEn: null,
    });
```

por:

```typescript
      ticketsAbiertos: 2,
      borrable: false,
      actualizadoPor: null,
      actualizadoEn: null,
    });
```

(c) En `apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts`, sustituir:

```typescript
    expect(p.find((x) => x.clave === 'verificacion')).toBeUndefined();
    expect(p.find((x) => x.clave === '')).toBeUndefined();
  });
```

por:

```typescript
    expect(p.find((x) => x.clave === 'verificacion')).toBeUndefined();
    expect(p.find((x) => x.clave === '')).toBeUndefined();
  });

  it('borrable (2026-11-24): sólo un tipo con fila propia que no siembran las migraciones y que ningún ticket abierto usa', async () => {
    await db.query(`INSERT INTO portal.tmc_plazos (clave, etiqueta, dias_habiles) VALUES ('reparacion', 'Reparación', 5), ('revision', 'Revisión', NULL)`);
    await db.query(`INSERT INTO desk.tickets (number, status, status_type, tipo_servicio) VALUES (1, 'x', 'Open', 'Revisión'), (2, 'x', 'Open', 'Instalación'), (3, 'x', 'Closed', 'Reparación')`);
    const p = await repo.listarPlazos(db);
    // Ni los sembrados (aunque nadie los use), ni uno en uso, ni uno que sólo traen los tickets. Un ticket cerrado no cuenta.
    expect(p.filter((x) => x.borrable).map((x) => x.clave)).toEqual(['reparacion']);
    expect(p.find((x) => x.clave === 'revision')).toMatchObject({ ticketsAbiertos: 1, borrable: false });
    expect(p.find((x) => x.clave === 'instalacion')).toMatchObject({ ticketsAbiertos: 1, borrable: false });
  });
```

- [ ] **Paso 2: ver que falla**

Ejecuta: `Push-Location apps/hub-api; npx vitest run --config vitest.db.config.ts src/trazabilidad/trazabilidad.db.test.ts; Pop-Location`

Esperado: FAIL en tres pruebas: «Configuración lo enseña con sus días calculados…» y «un tipo que sólo existe en los tickets abiertos…» (al recibido le falta `borrable`) y la nueva (`expected [] to deeply equal [ 'reparacion' ]`). El resto, en verde.

- [ ] **Paso 3: el campo** — en `apps/hub-api/src/trazabilidad/types.ts`, sustituir:

```typescript
  /** Tickets abiertos en Desk con este tipo. */
  ticketsAbiertos: number;
```

por:

```typescript
  /** Tickets abiertos en Desk con este tipo. */
  ticketsAbiertos: number;
  /**
   * True si se puede borrar desde Configuración (2026-11-24, `tipoBorrable`, dominio.ts): creado en la app (no lo siembran la 043 ni
   * la 045), con fila propia en tmc_plazos y sin ningún ticket abierto. La pantalla enseña «Borrar» con él; el servidor lo vuelve a
   * comprobar al borrar.
   */
  borrable: boolean;
```

- [ ] **Paso 4: `listarPlazos`** — en `apps/hub-api/src/trazabilidad/repo.ts`, tres Edit.

(a) En `apps/hub-api/src/trazabilidad/repo.ts`, sustituir:

```typescript
  tiposDeTickets,
  tipoSugerido,
```

por:

```typescript
  tiposDeTickets,
  tipoBorrable,
  tipoSugerido,
```

(b) En `apps/hub-api/src/trazabilidad/repo.ts`, sustituir:

```typescript
  const m = new Map<string, PlazoServicio>();
```

por:

```typescript
  // `borrable` se decide al final, con los recuentos ya hechos.
  const m = new Map<string, Omit<PlazoServicio, 'borrable'>>();
```

(c) En `apps/hub-api/src/trazabilidad/repo.ts`, sustituir:

```typescript
  return [...m.values()].sort(porPlazoYEtiqueta);
}
```

por:

```typescript
  // Se puede borrar (2026-11-24) si se creó en la app, tiene su fila y ningún ticket abierto lo usa (`tipoBorrable`, dominio.ts).
  const conFila = new Set((guardados.rows as Row[]).map((r) => String(r.clave)));
  return [...m.values()]
    .map((p) => ({ ...p, borrable: tipoBorrable({ clave: p.clave, conFila: conFila.has(p.clave), ticketsAbiertos: p.ticketsAbiertos }) }))
    .sort(porPlazoYEtiqueta);
}
```

- [ ] **Paso 5: los fixtures de la sub-app** — dos Edit.

(a) En `apps/trazabilidad-mantenimientos/src/lib/agenda.test.ts`, sustituir:

```typescript
  const plazo = (clave: string, etiqueta: string): PlazoServicio => ({ clave, etiqueta, dias: null, derivadoDe: null, ticketsAbiertos: 0, actualizadoPor: null, actualizadoEn: null });
```

por:

```typescript
  const plazo = (clave: string, etiqueta: string): PlazoServicio => ({ clave, etiqueta, dias: null, derivadoDe: null, ticketsAbiertos: 0, borrable: false, actualizadoPor: null, actualizadoEn: null });
```

(b) En `apps/trazabilidad-mantenimientos/src/lib/servicios.test.ts`, sustituir:

```typescript
    ticketsAbiertos: 0,
    actualizadoPor: null,
    actualizadoEn: null,
  });

  it('un tipo simple no es derivado', () => {
```

por:

```typescript
    ticketsAbiertos: 0,
    borrable: false,
    actualizadoPor: null,
    actualizadoEn: null,
  });

  it('un tipo simple no es derivado', () => {
```

- [ ] **Paso 6: ver que pasa la de BD**

Ejecuta: `Push-Location apps/hub-api; npx vitest run --config vitest.db.config.ts src/trazabilidad/trazabilidad.db.test.ts; Pop-Location`

Esperado: PASS, todo el fichero en verde.

- [ ] **Paso 7: compilan los dos**

Ejecuta: `Push-Location apps/hub-api; npx tsc -p tsconfig.json --noEmit; Pop-Location` — Esperado: sin errores (salvo, si sale, el conocido de `src/ausencias/service/barril.test.ts`).

Ejecuta: `Push-Location apps/trazabilidad-mantenimientos; npm run typecheck; npm test; Pop-Location` — Esperado: sin errores de tipos y todas las pruebas en verde.

- [ ] **Paso 8: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/hub-api/src/trazabilidad/types.ts apps/hub-api/src/trazabilidad/repo.ts apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts apps/trazabilidad-mantenimientos/src/lib/agenda.test.ts apps/trazabilidad-mantenimientos/src/lib/servicios.test.ts
git commit -F - <<'EOF'
feat(trazabilidad): los plazos dicen si cada tipo de servicio se puede borrar
EOF
```

---

## Tarea 4 (hub-api): Crear y borrar en la base — `crearTipo` y `borrarTipo`

**Ficheros:**
- Modificar: `apps/hub-api/src/trazabilidad/repo.ts:24-25` y `:43-44` (imports) y `:661-663` (añadir detrás de `guardarPlazo`)
- Prueba: `apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts:44` (la 051) y `:1589-1593` (añadir al final de `describe('plazos por tipo de servicio'…)`)

`borrarTipo` recibe el `Pool` (como `withTransaction`): comprobar y borrar van en **una** transacción, con la fila de `tmc_plazos` bloqueada (`FOR UPDATE`, así un `PUT` de su plazo espera). El recuento de tickets es el de `listarPlazos`, llamado con el cliente de la transacción (D2). Las duraciones se borran como en `guardarDuracionEtapa` (`repo.ts:864`): con `tipo <> TIPO_POR_DEFECTO`, así que la `'*'` no se toca aunque alguien pidiera `/plazos/*` (que además da 404: no tiene fila). Ojo con las palabras prohibidas de hub-api («Convenciones»).

- [ ] **Paso 1: escribir la prueba que falla** — Docker encendido. Dos Edit.

(a) En `apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts`, sustituir:

```typescript
const SQL_049 = readFileSync(fileURLToPath(new URL('../users/migrations/049_trazabilidad_roles.sql', import.meta.url)), 'utf8');
```

por:

```typescript
const SQL_049 = readFileSync(fileURLToPath(new URL('../users/migrations/049_trazabilidad_roles.sql', import.meta.url)), 'utf8');
const SQL_051 = readFileSync(fileURLToPath(new URL('../users/migrations/051_trazabilidad_agenda_config.sql', import.meta.url)), 'utf8');
```

(b) En `apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts`, sustituir:

```typescript
    await expect(db.query(`UPDATE portal.tmc_plazos SET dias_habiles = 366 WHERE clave = 'diagnostico'`)).rejects.toThrow();
  });
});
```

por:

```typescript
    await expect(db.query(`UPDATE portal.tmc_plazos SET dias_habiles = 366 WHERE clave = 'diagnostico'`)).rejects.toThrow();
  });

  // Tipos creados desde Configuración (diseño del 2026-11-24): crear uno nuevo y borrar uno creado en la app que ningún ticket
  // abierto usa, con sus días en la agenda. Los sembrados por la 043 y la 045 no se borran (volverían con el siguiente arranque).
  describe('tipos creados desde Configuración', () => {
    const duraciones = async () => (await db.query(`SELECT etapa, tipo, dias_habiles FROM portal.tmc_agenda_duraciones ORDER BY etapa, tipo COLLATE "C"`)).rows;
    const ticket = (numero: number, tipo: string | null) => db.query(`INSERT INTO desk.tickets (number, status, status_type, tipo_servicio) VALUES ($1, 'x', 'Open', $2)`, [numero, tipo]);

    beforeEach(async () => {
      // La agenda como recién migrada: sólo las «*» de la 051 (otros ficheros de BD dejan duraciones de tipos).
      await db.query('TRUNCATE portal.tmc_agenda_duraciones');
      await db.query(SQL_051);
    });

    it('crear: la fila nace firmada, con el nombre sin los espacios de los extremos, y sale borrable', async () => {
      await repo.crearTipo(db, { tipo: ' Reparación ', dias: 5 }, actor);
      const { rows } = await db.query(
        `SELECT clave, etiqueta, dias_habiles, actualizado_por_id, actualizado_por, actualizado_en IS NOT NULL AS firmado FROM portal.tmc_plazos WHERE clave = 'reparacion'`,
      );
      expect(rows).toEqual([{ clave: 'reparacion', etiqueta: 'Reparación', dias_habiles: 5, actualizado_por_id: actor.userId, actualizado_por: actor.email, firmado: true }]);
      expect(await plazo('reparacion')).toMatchObject({ etiqueta: 'Reparación', dias: 5, ticketsAbiertos: 0, borrable: true, actualizadoPor: actor.email });
      await repo.crearTipo(db, { tipo: 'Revisión externa', dias: null }, actor);
      expect(await plazo('revision externa')).toMatchObject({ dias: null, borrable: true });
    });

    it('crear uno que ya existe, con otra grafía (también un sembrado), es 409 tipo_existente y no toca ninguna fila', async () => {
      await repo.crearTipo(db, { tipo: 'Reparación', dias: 5 }, actor);
      const antes = (await db.query(`SELECT * FROM portal.tmc_plazos ORDER BY clave`)).rows;
      for (const tipo of ['REPARACION', ' reparación ', 'Diagnostico']) {
        await expect(repo.crearTipo(db, { tipo, dias: 9 }, actor)).rejects.toMatchObject({ status: 409, code: 'tipo_existente' });
      }
      expect((await db.query(`SELECT * FROM portal.tmc_plazos ORDER BY clave`)).rows).toEqual(antes);
    });

    it('crear vuelve a mirar el nombre aunque nadie haya pasado por parseTipoNuevo: un compuesto es 400 y no se escribe', async () => {
      await db.query(`DELETE FROM portal.tmc_plazos WHERE clave = 'diagnostico + calibracion'`);
      await expect(repo.crearTipo(db, { tipo: 'Diagnóstico + Calibración', dias: 7 }, actor)).rejects.toMatchObject({ status: 400, field: 'tipo' });
      expect(await plazo('diagnostico + calibracion')).toBeUndefined();
    });

    it('un tipo que sólo traen los tickets abiertos se puede crear (nace su fila) y no es borrable mientras lo usen', async () => {
      await ticket(1, 'Instalación');
      await repo.crearTipo(db, { tipo: 'Instalación', dias: 10 }, actor);
      expect(await plazo('instalacion')).toMatchObject({ dias: 10, ticketsAbiertos: 1, borrable: false, actualizadoPor: actor.email });
    });

    it('borrar un sembrado es 409 tipo_sembrado y no toca nada', async () => {
      const antes = await repo.listarPlazos(db);
      for (const clave of ['diagnostico', 'no aplica', 'diagnostico + calibracion']) {
        await expect(repo.borrarTipo(db, clave)).rejects.toMatchObject({ status: 409, code: 'tipo_sembrado' });
      }
      expect(await repo.listarPlazos(db)).toEqual(antes);
    });

    it('borrar uno sin uso: se van su fila y sus días en la agenda; la «*» y los de otros tipos se quedan', async () => {
      await repo.crearTipo(db, { tipo: 'Reparación', dias: 5 }, actor);
      await db.query(
        `INSERT INTO portal.tmc_agenda_duraciones (etapa, tipo, dias_habiles) VALUES ('diagnostico', 'reparacion', 2), ('proceso', 'reparacion', 6), ('proceso', 'mantenimiento', 3)`,
      );
      await repo.borrarTipo(db, 'reparacion');
      expect(await plazo('reparacion')).toBeUndefined();
      expect(await duraciones()).toEqual([
        { etapa: 'diagnostico', tipo: '*', dias_habiles: 3 },
        { etapa: 'proceso', tipo: '*', dias_habiles: 4 },
        { etapa: 'proceso', tipo: 'mantenimiento', dias_habiles: 3 },
        { etapa: 'verificacion', tipo: '*', dias_habiles: 1 },
      ]);
    });

    it('borrar uno que usan tickets abiertos —con el tipo de Desk o puesto a mano— es 409 tipo_en_uso con el número, y no borra nada', async () => {
      await repo.crearTipo(db, { tipo: 'Reparación', dias: 5 }, actor);
      await db.query(`INSERT INTO portal.tmc_agenda_duraciones (etapa, tipo, dias_habiles) VALUES ('proceso', 'reparacion', 6)`);
      await ticket(10, 'reparación');
      await ticket(11, null);
      await repo.fijarTipoServicio(db, 11, 'Reparación', actor);
      await expect(repo.borrarTipo(db, 'reparacion')).rejects.toMatchObject({ status: 409, code: 'tipo_en_uso', messageEs: '«Reparación» no se puede borrar: lo usan 2 tickets abiertos.' });
      expect(await plazo('reparacion')).toMatchObject({ dias: 5, ticketsAbiertos: 2 });
      expect(await duraciones()).toContainEqual({ etapa: 'proceso', tipo: 'reparacion', dias_habiles: 6 });
    });

    it('cerrado el ticket, se borra; el tipo puesto a mano en un ticket cerrado conserva su etiqueta', async () => {
      await repo.crearTipo(db, { tipo: 'Reparación', dias: 5 }, actor);
      await ticket(12, null);
      await repo.fijarTipoServicio(db, 12, 'Reparación', actor);
      await db.query(`UPDATE desk.tickets SET status_type = 'Closed' WHERE number = 12`);
      expect(await plazo('reparacion')).toMatchObject({ ticketsAbiertos: 0, borrable: true });
      await repo.borrarTipo(db, 'reparacion');
      expect((await db.query(`SELECT numero, clave, etiqueta FROM portal.tmc_servicios_tipo`)).rows).toEqual([{ numero: 12, clave: 'reparacion', etiqueta: 'Reparación' }]);
    });

    it('borrar uno sin fila —que no existe, que sólo traen los tickets, o la «*»— es 404 tipo_no_encontrado', async () => {
      await ticket(13, 'Instalación');
      for (const clave of ['reparacion', 'instalacion', '*']) {
        await expect(repo.borrarTipo(db, clave)).rejects.toMatchObject({ status: 404, code: 'tipo_no_encontrado' });
      }
      expect(await duraciones()).toHaveLength(3);
    });
  });
});
```

- [ ] **Paso 2: ver que falla**

Ejecuta: `Push-Location apps/hub-api; npx vitest run --config vitest.db.config.ts src/trazabilidad/trazabilidad.db.test.ts; Pop-Location`

Esperado: FAIL en las nueve pruebas nuevas (`TypeError: repo.crearTipo is not a function` / `repo.borrarTipo is not a function`). El resto, en verde.

- [ ] **Paso 3: el código mínimo** — en `apps/hub-api/src/trazabilidad/repo.ts`, tres Edit.

(a) En `apps/hub-api/src/trazabilidad/repo.ts`, sustituir:

```typescript
  diasDeTipo,
  esCategoriaAgenda,
```

por:

```typescript
  diasDeTipo,
  errorNombreTipo,
  esCategoriaAgenda,
```

(b) En `apps/hub-api/src/trazabilidad/repo.ts`, sustituir:

```typescript
  tiposDeTickets,
  tipoBorrable,
```

por:

```typescript
  tiposDeTickets,
  TIPOS_SEMBRADOS,
  tipoBorrable,
```

(c) En `apps/hub-api/src/trazabilidad/repo.ts`, sustituir:

```typescript
    [claveTipoServicio(c.tipo), c.tipo.trim(), c.dias, actor.userId, actor.email],
  );
}
```

por:

```typescript
    [claveTipoServicio(c.tipo), c.tipo.trim(), c.dias, actor.userId, actor.email],
  );
}

/**
 * Crea un tipo de servicio desde Configuración (POST /trazabilidad/plazos,
 * 2026-11-24) y lo firma, como `guardarPlazo`. Si ya hay una fila con su clave
 * normalizada (otra grafía, un sembrado o el compuesto), 409 `tipo_existente` y
 * no se toca nada: lo decide el `ON CONFLICT DO NOTHING` en la misma sentencia,
 * sin carrera. El nombre se vuelve a mirar aquí (`errorNombreTipo`) para que
 * ningún otro camino cree un tipo que la pantalla no dejaría crear.
 */
export async function crearTipo(db: Db, c: CambioPlazo, actor: Actor): Promise<void> {
  const error = errorNombreTipo(c.tipo);
  if (error) throw new TzError('invalid_input', 400, error, 'tipo');
  const etiqueta = c.tipo.trim();
  const { rowCount } = await db.query(
    `INSERT INTO portal.tmc_plazos (clave, etiqueta, dias_habiles, actualizado_por_id, actualizado_por, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (clave) DO NOTHING`,
    [claveTipoServicio(etiqueta), etiqueta, c.dias, actor.userId, actor.email],
  );
  if (!rowCount) {
    throw new TzError('tipo_existente', 409, `Ya existe el tipo de servicio «${etiqueta}» (o uno que sólo se distingue en tildes, mayúsculas o espacios): no se crea otra vez.`);
  }
}

/**
 * Borra un tipo creado en la app (DELETE /trazabilidad/plazos/:clave,
 * 2026-11-24): su fila de tmc_plazos y sus días en la agenda (las filas de
 * tmc_agenda_duraciones de su clave; la «*» de cada etapa, nunca). 409
 * `tipo_sembrado` sin consultar nada si es de `TIPOS_SEMBRADOS` (volvería con el
 * siguiente arranque); después, en una transacción con la fila bloqueada, 404
 * `tipo_no_encontrado` si no tiene fila y 409 `tipo_en_uso` si algún ticket
 * abierto lo usa (el recuento de `listarPlazos`, el de la columna «Tickets
 * abiertos»). Los tickets cerrados que lo tuvieron puesto a mano conservan su
 * etiqueta en tmc_servicios_tipo. No queda historial del borrado.
 */
export async function borrarTipo(db: Pool, clave: string): Promise<void> {
  if (TIPOS_SEMBRADOS.includes(clave)) {
    throw new TzError('tipo_sembrado', 409, 'Los tipos que trae la app de partida no se borran: volverían solos en el siguiente arranque.');
  }
  await withTransaction(db, async (c) => {
    const { rows } = await c.query(`SELECT etiqueta FROM portal.tmc_plazos WHERE clave = $1 FOR UPDATE`, [clave]);
    if (rows.length === 0) throw new TzError('tipo_no_encontrado', 404, 'Ese tipo de servicio no tiene fila propia en Configuración: no hay nada que borrar.');
    const etiqueta = String((rows[0] as Row).etiqueta);
    const enUso = (await listarPlazos(c)).find((p) => p.clave === clave)?.ticketsAbiertos ?? 0;
    if (enUso > 0) {
      throw new TzError('tipo_en_uso', 409, `«${etiqueta}» no se puede borrar: lo ${enUso === 1 ? 'usa 1 ticket abierto' : `usan ${enUso} tickets abiertos`}.`);
    }
    await c.query(`DELETE FROM portal.tmc_agenda_duraciones WHERE tipo = $1 AND tipo <> $2`, [clave, TIPO_POR_DEFECTO]);
    await c.query(`DELETE FROM portal.tmc_plazos WHERE clave = $1`, [clave]);
  });
}
```

- [ ] **Paso 4: ver que pasa**

Ejecuta: `Push-Location apps/hub-api; npx vitest run --config vitest.db.config.ts src/trazabilidad/trazabilidad.db.test.ts; Pop-Location`

Esperado: PASS, todo el fichero en verde.

- [ ] **Paso 5: candados y tipos, sin base**

Ejecuta: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/seguimiento.test.ts src/trazabilidad/envio-avisos.test.ts src/trazabilidad/fst022.test.ts src/trazabilidad/calibraciones.test.ts src/trazabilidad/contratos-repo.test.ts src/trazabilidad/vigencia-repo.test.ts src/trazabilidad/router.test.ts; npx tsc -p tsconfig.json --noEmit; Pop-Location`

Esperado: PASS los siete ficheros; `tsc` sin errores (salvo, si sale, el conocido de `barril.test.ts`). Si cae un candado, **no se toca la prueba**: se quita del código nuevo lo que lo hace caer (una palabra prohibida en un comentario, una tabla nombrada de más) y, si aun así hiciera falta cambiarlo, se para y se pregunta a Alfonso.

- [ ] **Paso 6: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/hub-api/src/trazabilidad/repo.ts apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts
git commit -F - <<'EOF'
feat(trazabilidad): crear y borrar tipos de servicio en la base, con sus días de la agenda
EOF
```

---

## Tarea 5 (hub-api): Las rutas — `POST /trazabilidad/plazos` y `DELETE /trazabilidad/plazos/:clave`

**Ficheros:**
- Modificar: `apps/hub-api/src/trazabilidad/router.ts:60-61` (import), `:126-132` (`Creado`, detrás de `Fichero`), `:169-170` (`route`) y `:563-567` (las dos rutas, detrás del `PUT`)
- Prueba: `apps/hub-api/src/trazabilidad/router.test.ts:171-176` (`appPlazos`), `:247` (`ESCRITURAS`), `:289` (título del candado), `:333` y `:351` (D1), `:357` (permiso antes que validación) y `:595-596` (casos nuevos)

**Antes de empezar: D1 está resuelto, 200.** NO hagas el Paso 1 (e) y (f) ni el Paso 3 (b) y (c): sigue el bloque «Si D1 es que no» del final de esta tarea (la ruta `POST` devuelve `{ plazos }` con 200 y la prueba se llama «crear un tipo nuevo → 200…»).

- [ ] **Paso 1: escribir las pruebas que fallan** — en `apps/hub-api/src/trazabilidad/router.test.ts`, siete Edit.

(a) En `apps/hub-api/src/trazabilidad/router.test.ts`, sustituir:

```typescript
function app() {
  const a = express();
  a.use(express.json());
  a.use('/api', createTrazabilidadRouter(fakePool));
  return a;
}
```

por:

```typescript
function app() {
  const a = express();
  a.use(express.json());
  a.use('/api', createTrazabilidadRouter(fakePool));
  return a;
}

/**
 * La app para crear y borrar tipos de servicio (2026-11-24): la inserción de un tipo nuevo añade su fila (sin esto el doble
 * contesta 0 filas, que es «ya existe»), y da conexiones al doble (borrar va en una transacción).
 */
function appPlazos() {
  conexiones.cliente = true;
  respuestas.push([/INSERT INTO portal\.tmc_plazos/, 1]);
  return app();
}
```

(b) En `apps/hub-api/src/trazabilidad/router.test.ts`, sustituir:

```typescript
    { ruta: 'PUT /trazabilidad/plazos', permiso: 'config.write', pedir: (c) => request(app()).put('/api/trazabilidad/plazos').set(c).send({ tipo: 'Diagnóstico', dias: 3 }) },
```

por:

```typescript
    { ruta: 'PUT /trazabilidad/plazos', permiso: 'config.write', pedir: (c) => request(app()).put('/api/trazabilidad/plazos').set(c).send({ tipo: 'Diagnóstico', dias: 3 }) },
    // Tipos de servicio creables desde Configuración (2026-11-24): crear uno y borrar uno creado en la app, con el permiso de los plazos.
    { ruta: 'POST /trazabilidad/plazos', permiso: 'config.write', pedir: (c) => request(appPlazos()).post('/api/trazabilidad/plazos').set(c).send({ tipo: 'Reparación', dias: 5 }) },
    { ruta: 'DELETE /trazabilidad/plazos/:clave', permiso: 'config.write', pedir: (c) => request(appPlazos()).delete('/api/trazabilidad/plazos/reparacion').set(c) },
```

(c) En `apps/hub-api/src/trazabilidad/router.test.ts`, sustituir:

```typescript
son las veintiséis escrituras del router (la 24.ª, del lote 11: la vigencia de una marca; la 25.ª, del lote 12: la frecuencia de preventivo de un cliente, sólo administradores; y, en lugar
```

por:

```typescript
son las veintiocho escrituras del router (la 24.ª, del lote 11: la vigencia de una marca; la 25.ª, del lote 12: la frecuencia de preventivo de un cliente, sólo administradores; la 27.ª y la 28.ª, del 2026-11-24: crear y borrar un tipo de servicio; y, en lugar
```

(d) En `apps/hub-api/src/trazabilidad/router.test.ts`, sustituir:

```typescript
    expect((await request(app()).put('/api/trazabilidad/plazos').set(c).send({ tipo: '', dias: 'tres' })).status).toBe(403);
```

por:

```typescript
    expect((await request(app()).put('/api/trazabilidad/plazos').set(c).send({ tipo: '', dias: 'tres' })).status).toBe(403);
    expect((await request(app()).post('/api/trazabilidad/plazos').set(c).send({ tipo: '*', dias: 'tres' })).status).toBe(403);
    expect((await request(app()).delete('/api/trazabilidad/plazos/Reparaci%C3%B3n').set(c)).status).toBe(403);
```

(e) (D1) En `apps/hub-api/src/trazabilidad/router.test.ts`, sustituir:

```typescript
    expect([200, 404]).toContain(res.status); // 404 = pasó el permiso y no encontró el equipo o el ticket en el doble
```

por:

```typescript
    expect([200, 201, 404]).toContain(res.status); // 201 = pasó el permiso y creó (un tipo de servicio, 2026-11-24); 404 = pasó el permiso y no encontró el equipo o el ticket en el doble
```

(f) (D1) En `apps/hub-api/src/trazabilidad/router.test.ts`, sustituir:

```typescript
    const res = await pedir(comoAdmin());
    expect([200, 404]).toContain(res.status);
```

por:

```typescript
    const res = await pedir(comoAdmin());
    expect([200, 201, 404]).toContain(res.status);
```

(g) En `apps/hub-api/src/trazabilidad/router.test.ts`, sustituir:

```typescript
    expect(queries.some((q) => /INSERT INTO portal\.tmc_plazos/.test(q))).toBe(true);
  });
```

por:

```typescript
    expect(queries.some((q) => /INSERT INTO portal\.tmc_plazos/.test(q))).toBe(true);
  });

  // Tipos de servicio creables desde Configuración (2026-11-24): crear con POST y borrar con DELETE. Lo de la base, en trazabilidad.db.test.ts.
  it.each<[object, string]>([
    [{ tipo: '' }, 'tipo'],
    [{ tipo: '*', dias: 3 }, 'tipo'],
    [{ tipo: 'x'.repeat(81) }, 'tipo'],
    [{ tipo: 'Diagnóstico + Calibración' }, 'tipo'],
    [{ tipo: 7 }, 'tipo'],
    [{ tipo: 'Reparación', dias: 0 }, 'dias'],
    [{ tipo: 'Reparación', dias: '5' }, 'dias'],
  ])('crear un tipo con %j → 400 en «%s» y ninguna consulta', async (cuerpo, campo) => {
    const res = await request(app()).post('/api/trazabilidad/plazos').set(auth()).send(cuerpo);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_input', field: campo });
    expect(queries).toEqual([]);
  });

  it('crear un tipo nuevo → 201 con la lista ya actualizada, con una inserción que no pisa ninguna fila', async () => {
    respuestas.push([/INSERT INTO portal\.tmc_plazos/, 1]);
    const res = await request(app()).post('/api/trazabilidad/plazos').set(auth()).send({ tipo: ' Reparación ', dias: 5 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ plazos: [] });
    expect(queries.find((q) => /INSERT INTO portal\.tmc_plazos/.test(q))).toMatch(/ON CONFLICT \(clave\) DO NOTHING/);
  });

  it('crear un tipo que ya existe (la inserción no añade ninguna fila) → 409 tipo_existente', async () => {
    const res = await request(app()).post('/api/trazabilidad/plazos').set(auth()).send({ tipo: 'diagnostico', dias: 3 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('tipo_existente');
  });

  it('borrar: un sembrado → 409 tipo_sembrado y una clave sin normalizar → 400, sin consultar nada; uno sin fila → 404', async () => {
    const borrar = (clave: string) => request(app()).delete(`/api/trazabilidad/plazos/${clave}`).set(auth());
    for (const clave of ['diagnostico', 'no%20aplica', 'diagnostico%20%2B%20calibracion']) {
      const res = await borrar(clave);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('tipo_sembrado');
    }
    for (const clave of ['Reparaci%C3%B3n', '%20reparacion']) {
      const res = await borrar(clave);
      expect(res.status).toBe(400);
      expect(res.body.field).toBe('clave');
    }
    expect(queries).toEqual([]);
    expect(conexiones.n).toBe(0);
    conexiones.cliente = true;
    const res = await borrar('reparacion');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tipo_no_encontrado');
    expect(queries.some((q) => /DELETE/.test(q))).toBe(false);
  });

  it('borrar uno creado en la app y sin uso → 200 con la lista ya actualizada', async () => {
    conexiones.cliente = true;
    respuestas.push([/FOR UPDATE/, [{ etiqueta: 'Reparación' }]]);
    const res = await request(app()).delete('/api/trazabilidad/plazos/reparacion').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ plazos: [] });
    expect(queries.filter((q) => /^DELETE/.test(q.trim()))).toEqual([expect.stringMatching(/tmc_agenda_duraciones/), expect.stringMatching(/tmc_plazos/)]);
  });
```

- [ ] **Paso 2: ver que fallan**

Ejecuta: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/router.test.ts; Pop-Location`

Esperado: FAIL en el candado «son las veintiocho escrituras…» (`expected [ … ] to have a length of 29 but got 27`), en «`$rol` no puede `POST /trazabilidad/plazos` / `DELETE …` → 403…» (llega 404: la ruta no existe), en los «sin fila de rol…», en «el permiso va antes que la validación» y en los casos nuevos (404 en vez de 400 / 201 / 409 / 200). El resto, en verde.

- [ ] **Paso 3: el código mínimo** — en `apps/hub-api/src/trazabilidad/router.ts`, cuatro Edit.

(a) En `apps/hub-api/src/trazabilidad/router.ts`, sustituir:

```typescript
  parseTipoManual,
  parseUserId,
```

por:

```typescript
  parseTipoManual,
  parseTipoNuevo,
  parseClaveTipo,
  parseUserId,
```

(b) (D1) En `apps/hub-api/src/trazabilidad/router.ts`, sustituir:

```typescript
    readonly cuerpo: Buffer,
  ) {}
}
```

por:

```typescript
    readonly cuerpo: Buffer,
  ) {}
}

/** Lo que devuelve una ruta que CREA algo: se contesta 201 con `cuerpo` (crear un tipo de servicio, 2026-11-24). */
class Creado {
  constructor(readonly cuerpo: unknown) {}
}
```

(c) (D1) En `apps/hub-api/src/trazabilidad/router.ts`, sustituir:

```typescript
        const r = await fn(req);
        if (!(r instanceof Fichero)) return void res.json(r);
```

por:

```typescript
        const r = await fn(req);
        if (r instanceof Creado) return void res.status(201).json(r.cuerpo);
        if (!(r instanceof Fichero)) return void res.json(r);
```

(d) En `apps/hub-api/src/trazabilidad/router.ts`, sustituir:

```typescript
    escritura('config.write', 'tmc_plazo', async (req) => {
      await repo.guardarPlazo(db, parsePlazo(req.body), actorOf(req));
      return { plazos: await repo.listarPlazos(db) };
    }),
  );
```

por:

```typescript
    escritura('config.write', 'tmc_plazo', async (req) => {
      await repo.guardarPlazo(db, parsePlazo(req.body), actorOf(req));
      return { plazos: await repo.listarPlazos(db) };
    }),
  );

  // Crea un tipo de servicio (2026-11-24): {tipo, dias}, el nombre con la regla de `errorNombreTipo` y dias vacío = sin plazo.
  // 201 con la lista entera ya actualizada; 409 `tipo_existente` si ya hay uno con su clave normalizada.
  router.post(
    '/trazabilidad/plazos',
    ...gated,
    escritura('config.write', 'tmc_plazo_crear', async (req) => {
      await repo.crearTipo(db, parseTipoNuevo(req.body), actorOf(req));
      return new Creado({ plazos: await repo.listarPlazos(db) });
    }),
  );

  // Borra un tipo creado en la app que ningún ticket abierto usa, con sus días en la agenda (2026-11-24). Devuelve la lista
  // entera ya actualizada. 400 en `clave` si no es la normalizada; 409 `tipo_sembrado`; 404 `tipo_no_encontrado`; 409 `tipo_en_uso`.
  router.delete(
    '/trazabilidad/plazos/:clave',
    ...gated,
    escritura('config.write', 'tmc_plazo_borrar', async (req) => {
      await repo.borrarTipo(db, parseClaveTipo(req.params.clave));
      return { plazos: await repo.listarPlazos(db) };
    }),
  );
```

- [ ] **Paso 4: ver que pasan**

Ejecuta: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/router.test.ts src/trazabilidad/hoja.test.ts src/trazabilidad/envio-avisos.test.ts; npx tsc -p tsconfig.json --noEmit; Pop-Location`

Esperado: PASS los tres ficheros (también el candado de las veintiocho escrituras y las de cada rol con las dos rutas nuevas); `tsc` sin errores (salvo, si sale, el conocido de `barril.test.ts`).

- [ ] **Paso 5: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/hub-api/src/trazabilidad/router.ts apps/hub-api/src/trazabilidad/router.test.ts
git commit -F - <<'EOF'
feat(trazabilidad): rutas para crear y borrar tipos de servicio desde Configuración
EOF
```

**Si D1 es que no** (200 en vez de 201, sin tocar las dos aserciones de la matriz de roles): no hagas el Paso 1 (e) y (f) ni el Paso 3 (b) y (c); en el Paso 3 (d), la ruta `POST` devuelve `{ plazos: await repo.listarPlazos(db) }` en vez de `new Creado({ … })`; y en el Paso 1 (g), «crear un tipo nuevo → 201…» pasa a llamarse «crear un tipo nuevo → 200…» con `expect(res.status).toBe(200)`. La sub-app no cambia (mira `res.ok`). Apúntalo en la Tarea 9 (fila de la API: «200», no «201»).

---

## Tarea 6 (hub-api): Verificación completa y merge A

Sin ficheros. Todo hub-api está hecho; la sub-app sólo cambió dos fixtures (Tarea 3). Docker encendido.

- [ ] **Paso 1: suites enteras de hub-api**

Ejecuta: `Push-Location apps/hub-api; npm test; Pop-Location` (`timeout` de 600000 ms). Esperado: todo en verde. Si cae sólo la 4.4 de usuarios por tiempo, repítela sola (`npx vitest run <su fichero>`) antes de investigar.

Ejecuta: `Push-Location apps/hub-api; npm run test:db; Pop-Location` (en segundo plano si tarda; `timeout` de 600000 ms). Esperado: todo en verde (también `agenda-config.db.test.ts` y los de la agenda, que se resiembran sus duraciones).

Ejecuta: `Push-Location apps/hub-api; npx tsc -p tsconfig.json --noEmit; Pop-Location` — Esperado: sin errores (salvo, si sale, el conocido de `barril.test.ts`).

Ejecuta: `Push-Location apps/trazabilidad-mantenimientos; npm test; npm run typecheck; Pop-Location` — Esperado: todo en verde (los dos fixtures de la Tarea 3).

- [ ] **Paso 2: tamaño y estado (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git diff --shortstat main...HEAD -- . ':(exclude)docs/superpowers'
git status --short
```

Esperado: menos de 800 inserciones + borrados (estimación: unas 490); `git status --short` sólo enseña lo de siempre (`M .gitignore`, `?? .atl/`, `?? apps/WO-sales/prompts/`, `?? img/`, `?? openspec/`) y, si Alfonso aún no lo ha commiteado, este plan.

- [ ] **Paso 3: comprobación de privacidad, en un comando aparte, antes del push (Bash)** — el repo es público.

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git diff main...HEAD -U0 -- . ':(exclude)docs/superpowers' | grep -E '^\+' | grep -inE '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|password|secret|token' | grep -viE '@example\.com'
git diff main...HEAD -U0 -- docs/superpowers | grep -E '^\+' | grep -inE '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' | grep -viE '@example\.com'
```

Esperado: ninguna línea en ninguno de los dos (las pruebas nuevas firman con el `actor` que ya existía, no escriben correos). El segundo mira el diseño y este plan sólo por correos, porque el plan contiene el propio patrón de búsqueda. Si sale alguna, se revisa a mano antes de seguir: sólo valen datos ficticios.

- [ ] **Paso 4: merge A y push, y vuelta a la rama (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git switch main && git pull --ff-only
git merge --no-ff feat/tipos-servicio-creables -m "merge: hub-api crea y borra tipos de servicio (POST y DELETE /trazabilidad/plazos)"
git push origin main
git switch feat/tipos-servicio-creables
git status --short
```

Esperado: merge sin conflictos, push aceptado, de vuelta en la rama y `git status --short` igual que antes. **No hace falta desplegar todavía**: se despliega todo tras el merge B (si Alfonso quiere desplegar hub-api ya, es seguro).

---

## Tarea 7 (sub-app): Lo que lee la fila de crear — `src/lib/tiposServicio.ts`

**Ficheros:**
- Crear: `apps/trazabilidad-mantenimientos/src/lib/tiposServicio.ts`
- Crear (prueba): `apps/trazabilidad-mantenimientos/src/lib/tiposServicio.test.ts`

La regla del nombre es la del servidor (`errorNombreTipo`, por `../dominio`); los días, `leerEntero` (`src/lib/agenda.ts`, ya probado en `agenda.test.ts`), con el mismo mensaje que el `leer` que hoy vive dentro de `Configuracion.tsx` y que se va en la Tarea 8 (D6).

- [ ] **Paso 1: escribir la prueba que falla** — crea `apps/trazabilidad-mantenimientos/src/lib/tiposServicio.test.ts` con:

```typescript
import { describe, it, expect } from 'vitest';
import { avisoBorrado, avisoCreado, leerDias, leerTipoNuevo, preguntaBorrar } from './tiposServicio';

// La tabla «Plazos por tipo de servicio» de Configuración (2026-11-24): los días de una casilla, la fila de crear un tipo y los
// textos de crear y borrar. La regla del nombre es la del servidor (errorNombreTipo); aquí se mira cómo la usa la pantalla.
const DIAS_MAL = 'Un número entero entre 1 y 365, o vacío.';

describe('días hábiles de una casilla', () => {
  it('un entero de 1 a 365, o vacío (sin plazo)', () => {
    expect(leerDias(' 5 ')).toEqual({ dias: 5 });
    expect(leerDias('1')).toEqual({ dias: 1 });
    expect(leerDias('365')).toEqual({ dias: 365 });
    expect(leerDias('  ')).toEqual({ dias: null });
  });

  it('fuera de rango, con decimales, negativo o con letras: el mensaje de siempre', () => {
    for (const t of ['0', '366', '1.5', '-1', 'tres']) expect(leerDias(t)).toEqual({ error: DIAS_MAL });
  });
});

describe('la fila de crear un tipo', () => {
  it('nombre y días que valen: se manda el nombre sin los espacios de los extremos; días vacíos = sin plazo', () => {
    expect(leerTipoNuevo('  Reparación  ', '5')).toEqual({ nuevo: { tipo: 'Reparación', dias: 5 }, errorNombre: null, errorDias: null });
    expect(leerTipoNuevo('Reparación', '')).toEqual({ nuevo: { tipo: 'Reparación', dias: null }, errorNombre: null, errorDias: null });
  });

  it('sin nombre no se manda nada, pero la fila vacía no sale en rojo', () => {
    expect(leerTipoNuevo('', '')).toEqual({ nuevo: null, errorNombre: null, errorDias: null });
    expect(leerTipoNuevo('   ', '5')).toEqual({ nuevo: null, errorNombre: null, errorDias: null });
  });

  it('el nombre, con la regla del servidor: sólo símbolos, más de 80 caracteres o un tipo compuesto', () => {
    expect(leerTipoNuevo('*', '')).toEqual({ nuevo: null, errorNombre: 'El nombre tiene que llevar al menos una letra o un número.', errorDias: null });
    expect(leerTipoNuevo('a'.repeat(81), '')).toMatchObject({ nuevo: null, errorNombre: 'El nombre no puede pasar de 80 caracteres.' });
    expect(leerTipoNuevo('Diagnóstico + Calibración', '7').errorNombre).toMatch(/es un tipo compuesto/);
  });

  it('unos días que no valen: no se manda, con el error en su casilla', () => {
    expect(leerTipoNuevo('Reparación', '0')).toEqual({ nuevo: null, errorNombre: null, errorDias: DIAS_MAL });
  });

  it('los textos de crear y borrar', () => {
    expect(avisoCreado('Reparación')).toBe('Tipo «Reparación» creado');
    expect(avisoBorrado('Reparación')).toBe('Tipo «Reparación» borrado');
    expect(preguntaBorrar('Reparación')).toBe('¿Borrar «Reparación»? También se borran sus días en la agenda.');
  });
});
```

- [ ] **Paso 2: ver que falla**

Ejecuta: `Push-Location apps/trazabilidad-mantenimientos; npx vitest run src/lib/tiposServicio.test.ts; Pop-Location`

Esperado: FAIL al cargar el fichero: no encuentra `./tiposServicio` (el mensaje exacto depende de Vite: «Failed to resolve import…» o «Cannot find module…»).

- [ ] **Paso 3: el código mínimo** — crea `apps/trazabilidad-mantenimientos/src/lib/tiposServicio.ts` con:

```typescript
/**
 * La tabla «Plazos por tipo de servicio» de «Configuración»: lo escrito en una
 * casilla de días y en la fila de crear un tipo (2026-11-24), y los textos de
 * crear y borrar. Puro: sin React ni red. El nombre de un tipo nuevo se valida
 * con la regla del servidor (`errorNombreTipo`, dominio.ts) y los días con la
 * de siempre (`leerEntero`: de 1 a 365, o vacío). Que ya exista sólo lo sabe el
 * servidor (409 `tipo_existente`).
 */
import { PLAZO_MAX_DIAS, PLAZO_MIN_DIAS, errorNombreTipo } from '../dominio';
import { leerEntero } from './agenda';

/** Lo escrito en una casilla de días hábiles: un entero de 1 a 365, o vacío (sin plazo). */
export function leerDias(txt: string): { dias: number | null } | { error: string } {
  const v = leerEntero(txt, { min: PLAZO_MIN_DIAS, max: PLAZO_MAX_DIAS, vacio: true });
  return 'error' in v ? v : { dias: v.valor };
}

/** La fila de crear un tipo, leída. */
export interface LecturaTipoNuevo {
  /** Lo que se manda al pulsar «Crear»; null si falta el nombre o alguna casilla no vale. */
  nuevo: { tipo: string; dias: number | null } | null;
  /** Por qué no vale el nombre; null si vale y también mientras no se ha escrito nada (una fila vacía no sale en rojo). */
  errorNombre: string | null;
  errorDias: string | null;
}

/** Lee la fila de crear: el nombre sin los espacios de los extremos y los días; con el error de cada casilla. */
export function leerTipoNuevo(nombre: string, dias: string): LecturaTipoNuevo {
  const tipo = nombre.trim();
  const errorNombre = tipo === '' ? null : errorNombreTipo(tipo);
  const d = leerDias(dias);
  const errorDias = 'error' in d ? d.error : null;
  return { nuevo: tipo !== '' && errorNombre === null && !('error' in d) ? { tipo, dias: d.dias } : null, errorNombre, errorDias };
}

/** El aviso tras crear un tipo. */
export const avisoCreado = (etiqueta: string): string => `Tipo «${etiqueta}» creado`;

/** El aviso tras borrarlo. */
export const avisoBorrado = (etiqueta: string): string => `Tipo «${etiqueta}» borrado`;

/** La pregunta que sale en la propia fila al pulsar «Borrar» (sin diálogo del navegador). */
export const preguntaBorrar = (etiqueta: string): string => `¿Borrar «${etiqueta}»? También se borran sus días en la agenda.`;
```

- [ ] **Paso 4: ver que pasa**

Ejecuta: `Push-Location apps/trazabilidad-mantenimientos; npx vitest run src/lib/tiposServicio.test.ts; npm run typecheck; Pop-Location`

Esperado: PASS el fichero entero y sin errores de tipos.

- [ ] **Paso 5: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/trazabilidad-mantenimientos/src/lib/tiposServicio.ts apps/trazabilidad-mantenimientos/src/lib/tiposServicio.test.ts
git commit -F - <<'EOF'
feat(trazabilidad): lectura de la fila de crear un tipo de servicio en Configuración
EOF
```

---

## Tarea 8 (sub-app): La pantalla — crear, «Borrar» con la pregunta en la fila y los errores en la tabla

**Ficheros:**
- Modificar: `apps/trazabilidad-mantenimientos/src/api.ts:58` (dos llamadas nuevas)
- Modificar: `apps/trazabilidad-mantenimientos/src/vistas/ConfiguracionAgenda.tsx:40-83` (`recargar`, D9)
- Modificar: `apps/trazabilidad-mantenimientos/src/vistas/Configuracion.tsx:4` (import), `:67` (prop), `:232-382` (`Plazos`)

Sin pruebas automáticas (la sub-app sólo prueba `src/lib`): la lógica ya está probada en `tiposServicio.ts`; aquí sólo se pinta. Todo control desactivable lleva `DESACTIVADO` y no se usan `alert` / `confirm` / `prompt` (reglas del `CLAUDE.md` de la sub-app). Con un hub-api viejo (sin `borrable`) no sale «Borrar»; «Crear» daría el 404 del servidor bajo su fila.

- [ ] **Paso 1: las llamadas** — en `apps/trazabilidad-mantenimientos/src/api.ts`, sustituir:

```typescript
  guardarPlazo: (tipo: string, dias: number | null) => request<{ plazos: PlazoServicio[] }>('PUT', '/plazos', { tipo, dias }),
```

por:

```typescript
  guardarPlazo: (tipo: string, dias: number | null) => request<{ plazos: PlazoServicio[] }>('PUT', '/plazos', { tipo, dias }),
  /** Crea un tipo de servicio (2026-11-24; `dias` null = sin plazo). Devuelve la lista entera; 409 `tipo_existente` si ya hay uno así. */
  crearTipo: (tipo: string, dias: number | null) => request<{ plazos: PlazoServicio[] }>('POST', '/plazos', { tipo, dias }),
  /** Borra un tipo creado en la app que ningún ticket abierto usa, con sus días en la agenda. 409 `tipo_sembrado` / `tipo_en_uso`, 404 `tipo_no_encontrado`. */
  borrarTipo: (clave: string) => request<{ plazos: PlazoServicio[] }>('DELETE', `/plazos/${encodeURIComponent(clave)}`),
```

- [ ] **Paso 2: releer la agenda tras crear o borrar un tipo (D9)** — en `apps/trazabilidad-mantenimientos/src/vistas/ConfiguracionAgenda.tsx`, tres Edit.

(a) En `apps/trazabilidad-mantenimientos/src/vistas/ConfiguracionAgenda.tsx`, sustituir:

```typescript
  guardar: (bloque: Bloque, clave: string, pedir: () => Promise<ConfiguracionAgenda>, aviso: string) => Promise<void>;
}
```

por:

```typescript
  guardar: (bloque: Bloque, clave: string, pedir: () => Promise<ConfiguracionAgenda>, aviso: string) => Promise<void>;
  /** Vuelve a leer la configuración y los tipos (tras crear o borrar un tipo en «Plazos», 2026-11-24), en la misma fila que los cambios. */
  recargar: () => Promise<void>;
}
```

(b) En `apps/trazabilidad-mantenimientos/src/vistas/ConfiguracionAgenda.tsx`, sustituir:

```typescript
  useEffect(() => {
    void (async () => {
      try {
        const [c, p] = await Promise.all([api.configuracionAgenda(), api.plazos()]);
        setConfig(c);
        setPlazos(p.plazos);
      } catch (e) {
        setError({ bloque: 'puestos', mensaje: (e as Error).message });
      }
    })();
  }, []);
```

por:

```typescript
  /** La configuración y los tipos de «Plazos» (de ellos salen las columnas de las duraciones). */
  const cargar = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([api.configuracionAgenda(), api.plazos()]);
      setConfig(c);
      setPlazos(p.plazos);
    } catch (e) {
      setError({ bloque: 'puestos', mensaje: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Tras crear o borrar un tipo en «Plazos» cambian las columnas y los días: se relee, en la fila de los cambios para no pisarlos.
  const recargar = useCallback(() => (cola.current = cola.current.then(cargar)), [cargar]);
```

(c) En `apps/trazabilidad-mantenimientos/src/vistas/ConfiguracionAgenda.tsx`, sustituir:

```typescript
  return { config, plazos, error, guardando, editable, guardar };
```

por:

```typescript
  return { config, plazos, error, guardando, editable, guardar, recargar };
```

- [ ] **Paso 3: `Plazos`, el estado y las acciones** — en `apps/trazabilidad-mantenimientos/src/vistas/Configuracion.tsx`, cinco Edit.

(a) En `apps/trazabilidad-mantenimientos/src/vistas/Configuracion.tsx`, sustituir:

```typescript
import { estadosReloj, firma } from '../lib/agenda';
```

por:

```typescript
import { estadosReloj, firma } from '../lib/agenda';
import { avisoBorrado, avisoCreado, leerDias, leerTipoNuevo, preguntaBorrar } from '../lib/tiposServicio';
```

(b) En `apps/trazabilidad-mantenimientos/src/vistas/Configuracion.tsx`, sustituir:

```typescript
      <Plazos notificar={notificar} />
```

por:

```typescript
      <Plazos notificar={notificar} onTipos={agenda.recargar} />
```

(c) En `apps/trazabilidad-mantenimientos/src/vistas/Configuracion.tsx`, sustituir:

```typescript
/** Los plazos, en días hábiles, de cada tipo de servicio. */
function Plazos({ notificar }: Props) {
```

por:

```typescript
/**
 * Los plazos, en días hábiles, de cada tipo de servicio. Desde el 2026-11-24 también se CREAN tipos aquí (la última fila) y se
 * borran los creados en la app que ningún ticket abierto usa (`borrable`), con la pregunta en la propia fila. `onTipos` avisa de
 * que los tipos cambiaron: la tabla de duraciones de la agenda saca de ellos sus columnas.
 */
function Plazos({ notificar, onTipos }: Props & { onTipos: () => Promise<void> }) {
```

(d) En `apps/trazabilidad-mantenimientos/src/vistas/Configuracion.tsx`, sustituir:

```typescript
  const [guardando, setGuardando] = useState<string | null>(null);
  const editable = usePermisos().puede('config.write');

  const cargar = useCallback(async () => {
    try {
      setPlazos((await api.plazos()).plazos);
```

por:

```typescript
  const [guardando, setGuardando] = useState<string | null>(null);
  /** Lo escrito en la fila de crear un tipo. */
  const [nuevo, setNuevo] = useState({ nombre: '', dias: '' });
  const [creando, setCreando] = useState(false);
  /** La clave del tipo cuya fila pregunta «¿Borrar …?»; null = ninguna. */
  const [confirmando, setConfirmando] = useState<string | null>(null);
  /** El error del servidor al crear (clave null: la fila de crear) o al borrar (la clave de su fila): se enseña en esa fila. */
  const [errorFila, setErrorFila] = useState<{ clave: string | null; mensaje: string } | null>(null);
  const editable = usePermisos().puede('config.write');

  const cargar = useCallback(async () => {
    try {
      setPlazos((await api.plazos()).plazos);
```

(e) En `apps/trazabilidad-mantenimientos/src/vistas/Configuracion.tsx`, sustituir:

```typescript
  const escrito = (p: PlazoServicio) => borrador[p.clave] ?? (p.dias === null ? '' : String(p.dias));
  /** El valor a guardar, o un mensaje si lo escrito no vale. La misma regla que valida el servidor. */
  const leer = (txt: string): { dias: number | null } | { error: string } => {
    const t = txt.trim();
    if (t === '') return { dias: null };
    const n = Number(t);
    if (!/^\d+$/.test(t) || n < PLAZO_MIN_DIAS || n > PLAZO_MAX_DIAS) return { error: `Un número entero entre ${PLAZO_MIN_DIAS} y ${PLAZO_MAX_DIAS}, o vacío.` };
    return { dias: n };
  };

  const guardar = async (p: PlazoServicio) => {
    const v = leer(escrito(p));
```

por:

```typescript
  const escrito = (p: PlazoServicio) => borrador[p.clave] ?? (p.dias === null ? '' : String(p.dias));
  /** La fila de crear: lo que se mandaría y el error de cada casilla (la misma regla que valida el servidor). */
  const lectura = leerTipoNuevo(nuevo.nombre, nuevo.dias);

  const crear = async () => {
    if (!lectura.nuevo) return;
    const { tipo, dias } = lectura.nuevo;
    setCreando(true);
    try {
      setPlazos((await api.crearTipo(tipo, dias)).plazos);
      setNuevo({ nombre: '', dias: '' });
      setErrorFila(null);
      notificar(avisoCreado(tipo));
      void onTipos();
    } catch (e) {
      setErrorFila({ clave: null, mensaje: (e as Error).message });
    } finally {
      setCreando(false);
    }
  };

  const borrar = async (p: PlazoServicio) => {
    setGuardando(p.clave);
    try {
      setPlazos((await api.borrarTipo(p.clave)).plazos);
      setErrorFila(null);
      notificar(avisoBorrado(p.etiqueta));
      void onTipos();
    } catch (e) {
      setErrorFila({ clave: p.clave, mensaje: (e as Error).message });
      // Puede que ya lo use un ticket, o que otra persona lo haya borrado: la lista de ahora dice si sigue habiendo «Borrar».
      void cargar();
    } finally {
      setGuardando(null);
      setConfirmando(null);
    }
  };

  const guardar = async (p: PlazoServicio) => {
    const v = leerDias(escrito(p));
```

- [ ] **Paso 4: `Plazos`, las filas** — en el mismo fichero, cuatro Edit.

(a) En `apps/trazabilidad-mantenimientos/src/vistas/Configuracion.tsx`, sustituir:

```typescript
              const txt = escrito(p);
              const v = leer(txt);
```

por:

```typescript
              // «¿Borrar …?» en la propia fila, sin diálogo del navegador.
              if (confirmando === p.clave) {
                return (
                  <tr key={p.clave} className="bg-amber-50">
                    <td className="px-3 py-2 font-medium text-gray-900">{p.etiqueta}</td>
                    <td colSpan={4} className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <p className="mr-auto text-sm text-gray-800">{preguntaBorrar(p.etiqueta)}</p>
                        <Button variant="primary" busy={guardando === p.clave} onClick={() => void borrar(p)}>
                          Sí, borrar
                        </Button>
                        <Button variant="ghost" disabled={guardando === p.clave} onClick={() => setConfirmando(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              }
              const txt = escrito(p);
              const v = leerDias(txt);
```

(b) En `apps/trazabilidad-mantenimientos/src/vistas/Configuracion.tsx`, sustituir:

```typescript
                <tr key={p.clave}>
                  <td className="px-3 py-2 font-medium text-gray-900">{p.etiqueta}</td>
                  <td className="px-3 py-2">
                    <input
```

por:

```typescript
                <tr key={p.clave}>
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {p.etiqueta}
                    {errorFila && errorFila.clave === p.clave && (
                      <p role="alert" className="mt-1 text-xs font-normal text-red-600">
                        {errorFila.mensaje}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
```

(c) En `apps/trazabilidad-mantenimientos/src/vistas/Configuracion.tsx`, sustituir:

```typescript
                    {editable && (
                      <Button variant="primary" disabled={!cambiado} busy={guardando === p.clave} onClick={() => void guardar(p)}>
                        Guardar
                      </Button>
                    )}
```

por:

```typescript
                    {editable && (
                      <div className="flex justify-end gap-2">
                        <Button variant="primary" disabled={!cambiado} busy={guardando === p.clave} onClick={() => void guardar(p)}>
                          Guardar
                        </Button>
                        {/* Sólo los creados en la app que ningún ticket abierto usa (el servidor lo vuelve a comprobar al borrar). */}
                        {p.borrable && (
                          <Button
                            disabled={guardando === p.clave}
                            onClick={() => {
                              setConfirmando(p.clave);
                              setErrorFila(null);
                            }}
                          >
                            Borrar
                          </Button>
                        )}
                      </div>
                    )}
```

(d) En `apps/trazabilidad-mantenimientos/src/vistas/Configuracion.tsx`, sustituir:

```typescript
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Los tipos salen de Zoho Desk: si un ticket abierto trae uno nuevo, aparece aquí sin plazo para que se lo pongas. Los plazos no se suman entre sí: un equipo en
```

por:

```typescript
            })}
            {/* Crear un tipo nuevo (2026-11-24): la última fila, sólo con `config.write`. */}
            {editable && (
              <tr className="bg-gray-50">
                <td className="px-3 py-2">
                  <input
                    type="text"
                    autoComplete="off"
                    value={nuevo.nombre}
                    disabled={creando}
                    onChange={(e) => {
                      setNuevo((n) => ({ ...n, nombre: e.target.value }));
                      setErrorFila(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && void crear()}
                    placeholder="Tipo nuevo, p. ej. Reparación"
                    aria-label="Nombre del tipo de servicio nuevo"
                    aria-invalid={lectura.errorNombre !== null}
                    className={`block min-h-[44px] w-full min-w-[12rem] rounded-xl border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 ${DESACTIVADO} ${
                      lectura.errorNombre ? 'border-red-400 focus:ring-red-100' : 'border-gray-300 focus:border-blue-400 focus:ring-blue-100'
                    }`}
                  />
                  {lectura.errorNombre && <p className="mt-1 text-xs text-red-600">{lectura.errorNombre}</p>}
                  {errorFila && errorFila.clave === null && (
                    <p role="alert" className="mt-1 text-xs text-red-600">
                      {errorFila.mensaje}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={PLAZO_MIN_DIAS}
                    max={PLAZO_MAX_DIAS}
                    step={1}
                    value={nuevo.dias}
                    disabled={creando}
                    onChange={(e) => setNuevo((n) => ({ ...n, dias: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && void crear()}
                    placeholder="sin plazo"
                    aria-label="Plazo del tipo nuevo en días hábiles"
                    aria-invalid={lectura.errorDias !== null}
                    className={`block min-h-[44px] w-32 rounded-xl border bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 ${DESACTIVADO} ${
                      lectura.errorDias ? 'border-red-400 focus:ring-red-100' : 'border-gray-300 focus:border-blue-400 focus:ring-blue-100'
                    }`}
                  />
                  {lectura.errorDias && <p className="mt-1 text-xs text-red-600">{lectura.errorDias}</p>}
                </td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-xs text-gray-400">tipo nuevo</td>
                <td className="px-3 py-2 text-right">
                  <Button variant="primary" disabled={!lectura.nuevo} busy={creando} onClick={() => void crear()}>
                    Crear
                  </Button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Los tipos salen de Zoho Desk: si un ticket abierto trae uno nuevo, aparece aquí sin plazo para que se lo pongas. También se pueden crear aquí, en la última
        fila, para ponérselos a mano a un ticket en «Servicios»; sólo se borran los creados aquí que ningún ticket abierto usa. Los plazos no se suman entre sí: un equipo en
```

- [ ] **Paso 5: tipos, pruebas y build**

Ejecuta: `Push-Location apps/trazabilidad-mantenimientos; npm run typecheck; npm test; npm run build; Pop-Location`

Esperado: sin errores de tipos (en particular, ningún `leer` suelto: se fue entero), todas las pruebas en verde y `vite build` termina con «✓ built in …».

- [ ] **Paso 6: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/trazabilidad-mantenimientos/src/api.ts apps/trazabilidad-mantenimientos/src/vistas/ConfiguracionAgenda.tsx apps/trazabilidad-mantenimientos/src/vistas/Configuracion.tsx
git commit -F - <<'EOF'
feat(trazabilidad): crear y borrar tipos de servicio desde Configuración
EOF
```

---

## Tarea 9: Documento vivo, verificación de la sub-app y merge B

**Ficheros:**
- Modificar: `apps/trazabilidad-mantenimientos/CLAUDE.md` (fila de `portal.tmc_plazos` en «Tablas», `:140`; filas de `/trazabilidad/plazos` en la API, `:199-200`; fila de `config.write` en «Permisos», `:248`; sección nueva al final de «Servicios: plazo de los tickets abiertos», delante de «## Reloj del plazo…», `:558-560`)

- [ ] **Paso 1: la tabla y la API** — dos Edit.

(a) En `apps/trazabilidad-mantenimientos/CLAUDE.md`, sustituir:

```markdown
esa columna **no se lee** para un compuesto (ver «Tipo compuesto») |
```

por:

```markdown
esa columna **no se lee** para un compuesto (ver «Tipo compuesto»). **Desde el 2026-11-24 se crean y se borran filas desde Configuración** (ver «Tipos de servicio creables desde Configuración»): los siete sembrados no se borran |
```

(b) En `apps/trazabilidad-mantenimientos/CLAUDE.md`, sustituir:

```markdown
(entonces `dias` es su suma, o `null` si a alguna le falta) |
| PUT | `/trazabilidad/plazos` | `{tipo, dias}` (entero 1..365, o vacío = sin plazo). Devuelve `{plazos[]}` ya actualizado. 400 en `tipo` si es un tipo compuesto: su plazo se calcula, no se guarda |
```

por:

```markdown
(entonces `dias` es su suma, o `null` si a alguna le falta). Y `borrable` (2026-11-24): `true` si se creó en la app, tiene fila propia y ningún ticket abierto lo usa (`tipoBorrable`) |
| PUT | `/trazabilidad/plazos` | `{tipo, dias}` (entero 1..365, o vacío = sin plazo). Devuelve `{plazos[]}` ya actualizado. 400 en `tipo` si es un tipo compuesto: su plazo se calcula, no se guarda |
| POST | `/trazabilidad/plazos` | 2026-11-24. Permiso `config.write`. `{tipo, dias}`: **crea** un tipo de servicio (el nombre con la regla de `errorNombreTipo`; `dias` como en el `PUT`), firmado. **200** con `{plazos[]}` ya actualizado. 400 en `tipo` (vacío, sólo símbolos, más de 80 caracteres —también su clave—, un compuesto o no es texto) o en `dias`; **409 `tipo_existente`** si ya hay una fila con su clave normalizada (otra grafía, un sembrado o el compuesto): no se toca nada |
| DELETE | `/trazabilidad/plazos/:clave` | 2026-11-24. Permiso `config.write`. **Borra** un tipo creado en la app (`:clave` = la normalizada, «reparacion»), con sus días en la agenda (`tmc_agenda_duraciones` de esa clave; la «*», nunca), en una transacción. 200 con `{plazos[]}` ya actualizado. 400 en `clave` si no es la normalizada; **409 `tipo_sembrado`** (de `TIPOS_SEMBRADOS`, sin consultar nada); **404 `tipo_no_encontrado`** si no tiene fila; **409 `tipo_en_uso`** si lo usa algún ticket abierto (el mensaje dice cuántos) |
```

- [ ] **Paso 2: el permiso** — en `apps/trazabilidad-mantenimientos/CLAUDE.md`, sustituir:

```markdown
| `config.write` | — | — | — | sí | `PUT /trazabilidad/plazos`, `PUT /trazabilidad/estados`
```

por:

```markdown
| `config.write` | — | — | — | sí | `PUT /trazabilidad/plazos`, `POST /trazabilidad/plazos` y `DELETE /trazabilidad/plazos/:clave` (crear y borrar tipos de servicio, 2026-11-24), `PUT /trazabilidad/estados`
```

- [ ] **Paso 3: la sección nueva** — en `apps/trazabilidad-mantenimientos/CLAUDE.md`, sustituir:

```markdown
  `consultarEquipos` (la lectura revisada de `INVENTARIO`); `CLIENTE_POR_SERIAL` sigue dando sólo el nombre del cliente.

## Reloj del plazo: standby lo pausa, «trabajo terminado» lo para
```

por:

```markdown
  `consultarEquipos` (la lectura revisada de `INVENTARIO`); `CLIENTE_POR_SERIAL` sigue dando sólo el nombre del cliente.

### Tipos de servicio creables desde Configuración (2026-11-24)

Diseño: `docs/superpowers/specs/2026-11-24-tipos-servicio-creables-design.md`; plan (con sus decisiones):
`docs/superpowers/plans/2026-11-24-tipos-servicio-creables.md`.

- **Crear** (`POST /trazabilidad/plazos`, `config.write`): la última fila de «Plazos por tipo de servicio». El nombre pasa
  `errorNombreTipo` (`dominio.ts`), **la misma regla en el servidor** (`parseTipoNuevo` en `types.ts`, y otra vez `crearTipo` en
  `repo.ts`) **y en la pantalla** (`leerTipoNuevo`, `src/lib/tiposServicio.ts`), con el mismo texto: de 1 a `TIPO_SERVICIO_MAX` (80)
  caracteres sin los espacios de los extremos —su clave también—, con alguna letra o algún dígito (así no vale «*», la fila por
  defecto de la agenda) y sin ser un compuesto. Los días, como al editar. La fila nace firmada; si ya existe su clave normalizada,
  409 `tipo_existente` (`INSERT … ON CONFLICT DO NOTHING`, sin carrera). Un tipo que sólo traían los tickets se puede crear: nace su fila.
- **Borrar** (`DELETE /trazabilidad/plazos/:clave`, `config.write`): sólo si `borrable` (`tipoBorrable`, `dominio.ts`): no está en
  `TIPOS_SEMBRADOS` (los seis de la 043 y el compuesto de la 045, que volverían con el siguiente arranque; `plazos.test.ts` vigila
  que sean exactamente los de los dos .sql y que ninguna otra migración siembre `tmc_plazos`), tiene fila propia y ningún ticket
  abierto lo usa (el recuento de la columna «Tickets abiertos», por tipo efectivo). `borrarTipo` lo vuelve a mirar en una
  transacción con la fila bloqueada y borra la fila y sus días en la agenda, nunca la «*». Sin historial; los tickets cerrados que lo
  tuvieron a mano conservan su etiqueta en `tmc_servicios_tipo`.
- **Pantalla** (`Configuracion.tsx`): «Borrar» sólo en las filas `borrable`, con la pregunta en la propia fila («¿Borrar «X»? También
  se borran sus días en la agenda.», «Sí, borrar» / «Cancelar»). Los errores del servidor salen en la fila (bajo la de crear, o bajo
  el nombre del tipo); tras un fallo al borrar se relee la lista. Tras crear o borrar se relee también la tarjeta de duraciones de la
  agenda (`recargar`, `useAgendaConfig`).
- **No** escribe en Zoho Desk ni en Desk 2.0, no crea compuestos ni renombra (un tipo sin usar se borra y se crea otra vez). Sin
  migración. Un tipo creado aquí no llega en los tickets de Desk mientras ese valor no exista también allí; si se añade con el mismo
  nombre, casa solo (`claveTipoServicio`).
- ⚠️ **Carrera aceptada**: `PUT /servicios/:numero/tipo` no espera al bloqueo del borrado. Si en el mismo instante se le pone a un
  ticket el tipo que se está borrando, el ticket se queda con su etiqueta guardada y «sin plazo» (un estado que la app ya enseña).

## Reloj del plazo: standby lo pausa, «trabajo terminado» lo para
```

- [ ] **Paso 4: commit del documento (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/trazabilidad-mantenimientos/CLAUDE.md
git commit -F - <<'EOF'
docs(trazabilidad): los tipos de servicio creables en el documento de la app
EOF
```

- [ ] **Paso 5: hub-api no ha cambiado desde el merge A (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git diff --stat main...HEAD -- apps/hub-api
```

Esperado: ninguna línea (sus suites ya pasaron en la Tarea 6). Si sale algo, vuelve a pasar el Paso 1 de la Tarea 6 antes de seguir.

- [ ] **Paso 6: la sub-app entera**

Ejecuta: `Push-Location apps/trazabilidad-mantenimientos; npm test; npm run typecheck; npm run build; Pop-Location` — Esperado: todo en verde y «✓ built in …».

- [ ] **Paso 7: tamaño y estado (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git diff --shortstat main...HEAD -- . ':(exclude)docs/superpowers'
git status --short
```

Esperado: menos de 800 inserciones + borrados (estimación del merge B: unas 330; `main...HEAD` ya sólo mide lo posterior al merge A); `git status --short` sólo enseña lo de siempre (`M .gitignore`, `?? .atl/`, `?? apps/WO-sales/prompts/`, `?? img/`, `?? openspec/`).

- [ ] **Paso 8: comprobación de privacidad, en un comando aparte, antes del push (Bash)** — el repo es público.

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git diff main...HEAD -U0 -- . ':(exclude)docs/superpowers' | grep -E '^\+' | grep -inE '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|password|secret|token' | grep -viE '@example\.com'
git diff main...HEAD -U0 -- docs/superpowers | grep -E '^\+' | grep -inE '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' | grep -viE '@example\.com'
```

Esperado: ninguna línea en ninguno de los dos (el segundo mira el diseño y este plan sólo por correos, porque el plan contiene el propio patrón de búsqueda). Si sale alguna, se revisa a mano antes de seguir: sólo valen datos ficticios.

- [ ] **Paso 9: merge B y push (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git switch main && git pull --ff-only
git merge --no-ff feat/tipos-servicio-creables -m "merge: Configuración crea y borra tipos de servicio"
git push origin main
git status --short
```

Esperado: merge sin conflictos, push aceptado y `git status --short` igual que antes.

- [ ] **Paso 10: avisar a Alfonso del despliegue (a mano, en EasyPanel)**

Empujar no despliega. El despliegue lo hace Alfonso: **primero hub-api y justo después el portal** (el orden de siempre). No hay migración. Con el portal viejo sobre el hub-api nuevo, `borrable` se ignora y no sale la fila de crear; con el portal nuevo sobre un hub-api viejo no sale «Borrar» (no llega `borrable`) y «Crear» daría el 404 del servidor bajo su fila: ningún orden rompe nada guardado, pero se sigue el de siempre.

Prueba en el navegador, tras desplegar (Alfonso; con nombres de prueba y borrándolos al terminar):
1. «Administración» → «Configuración» → «Plazos por tipo de servicio», con el rol de Director Técnico o de administrador: la última fila tiene «Tipo nuevo, p. ej. Reparación», la casilla de días y «Crear», desactivado con la fila vacía. Escribe «*»: sale en rojo «El nombre tiene que llevar al menos una letra o un número.» y «Crear» sigue desactivado.
2. Crea «Reparación prueba» con 5 días: aviso «Tipo «Reparación prueba» creado», las casillas se vacían y sale su fila con 5 días, tu correo y fecha, y «Borrar». En «Duraciones (días hábiles)», más abajo, aparece su columna sin recargar.
3. Crea otra vez «reparacion prueba»: bajo la fila de crear sale «Ya existe el tipo de servicio «reparacion prueba» (o uno que sólo se distingue en tildes, mayúsculas o espacios): no se crea otra vez.»
4. «Taller» → «Servicios»: el desplegable de un ticket ofrece «Reparación prueba · 5 días háb.»; ponlo. De vuelta en Configuración, su fila dice 1 en «Tickets abiertos» y ya no tiene «Borrar». Quítaselo al ticket («Sin tipo» o «Según Desk: …»): vuelve «Borrar».
5. Pon un día a «Reparación prueba» en «Duraciones». Pulsa «Borrar»: la fila pregunta «¿Borrar «Reparación prueba»? También se borran sus días en la agenda.»; «Cancelar» la deja como estaba. «Borrar» → «Sí, borrar»: aviso «Tipo «Reparación prueba» borrado», la fila desaparece y en «Duraciones» se van su columna y su día.
6. Diagnóstico, Calibración, Mantenimiento, Garantía, Otro, No aplica y «Diagnóstico + Calibración» no tienen «Borrar». Con una cuenta de rol Lector (o Técnico): no sale la fila de crear ni ningún «Borrar», y arriba sigue el aviso de modo de consulta.
