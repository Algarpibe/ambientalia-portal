# Saldo visible en cabecera y widget — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cualquier empleado vea su saldo de vacaciones a día de hoy en la cabecera de la app «Vacaciones y Permisos» y en un widget del dashboard del portal.

**Architecture:** Un endpoint nuevo en hub-api (`GET /ausencias/mi-saldo`) que reusa `service.saldoDeSesion`, y un componente `IndicadorSaldo` en `apps/ausencias` que concentra la regla de qué número se enseña, consumido por dos superficies: la cabecera de `App.tsx` (que lee el saldo del contexto que ya carga) y un widget nuevo registrado en el dashboard del portal.

**Tech Stack:** Express 4 + TypeScript ESM (NodeNext, imports con `.js`), Vitest + supertest, React 19 + Tailwind 3, npm workspaces, Node 20.

**Spec:** `docs/superpowers/specs/2026-08-13-saldo-visible-design.md`

**Rama:** `feat/saldo-visible` (ya creada, con la spec commiteada en `0dbb2e4`).

---

## Contexto que el ejecutor necesita antes de empezar

- **Shell:** PowerShell 5.1. **No existe `&&`**; se encadena con `;`. PowerShell **pierde el directorio de trabajo entre llamadas**: cada comando empieza con `Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"` o npm no encuentra los workspaces.
- **Los tres portones**, en este orden: `npm run build --workspace=apps/hub-api`, `npm run test --workspace=apps/hub-api`, `npm run build --workspace=apps/portal`. Vitest transpila con esbuild y **no comprueba tipos**: el build es un portón distinto del test, no un duplicado.
- `apps/ausencias` solo corre `vite build`, **sin `tsc`**. Su seguridad de tipos la da el portón del portal, que hace `tsc -b` con `strict: true` y alcanza estos archivos porque el portal importa las sub-apps por código fuente.
- **Commits:** siempre `git commit -m "..." -- ruta1 ruta2`. **Nunca `git add -A`**: hay un `apps/WO-sales/prompts/` sin trackear que es ajeno a este trabajo.
- **Idioma:** código, comentarios y mensajes de commit en español. Los comentarios explican **por qué**, no qué.
- **Flake conocido y ajeno:** `users.service.test.ts > property tests > 4.5` falla ~1 de cada 5 ejecuciones (fast-check con entradas aleatorias). Si falla **ese** test, no es culpa de este trabajo: reejecutar. Cualquier otro fallo sí lo es.

## Estructura de ficheros

| Fichero | Responsabilidad | Acción |
|---|---|---|
| `apps/hub-api/src/ausencias/router.ts` | Ruta `GET /ausencias/mi-saldo` | Modificar |
| `apps/hub-api/src/ausencias/router.test.ts` | Tests HTTP del endpoint | Modificar |
| `apps/ausencias/src/IndicadorSaldo.tsx` | **La regla de qué número se enseña**, en dos variantes | Crear |
| `apps/ausencias/src/App.tsx` | Cabecera con el indicador; quitar la tarjeta duplicada; refresco en `onDecidida` | Modificar |
| `apps/ausencias/src/api.ts` | `fetchMiSaldo` | Modificar |
| `apps/ausencias/src/widgets/WidgetSaldo.tsx` | El widget: carga su dato y sus cuatro estados | Crear |
| `apps/ausencias/src/widgets/index.ts` | El descriptor que exporta la app | Crear |
| `apps/portal/src/widgets/registry.ts` | Registrar `ausencias` | Modificar |
| `docs/dev/app-ausencias.md` | Documentación viva | Modificar |

---

### Task 1: El endpoint `GET /ausencias/mi-saldo`

**Files:**
- Modify: `apps/hub-api/src/ausencias/router.ts` (justo antes de `router.get('/ausencias/saldos', ...)`, sobre la línea 332)
- Test: `apps/hub-api/src/ausencias/router.test.ts` (bloque nuevo tras `describe('GET /ausencias/saldos', ...)`, que termina sobre la línea 1419)

- [ ] **Step 1: Escribir los tests que fallan**

Añadir este bloque completo en `router.test.ts`, **después** del cierre de `describe('GET /ausencias/saldos', …)` y antes de `describe('PUT /ausencias/empleados/:id/saldo', …)`.

Notas sobre los dobles, que ya existen en el fichero y no hay que tocar: `estado.empleado` es la ficha de la sesión (`id: 'e1'`); el mock de `empleadosConSaldo` lee de `estado.plantilla`, así que para que un empleado tenga saldo hay que **empujar su ficha a la plantilla** con `saldoCorte`/`fechaCorte` colgados encima. `token()` firma un JWT con `apps: ['ausencias']`.

```ts
describe('GET /ausencias/mi-saldo', () => {
  it('devuelve el saldo de quien pregunta', async () => {
    estado.plantilla.push({ ...(estado.empleado as Record<string, unknown>), saldoCorte: 10, fechaCorte: '2026-01-01' });
    const r = await request(app()).get('/api/ausencias/mi-saldo').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(r.body.saldo).toMatchObject({ configurado: true, saldoCorte: 10, fechaCorte: '2026-01-01' });
    // No se fija un `disponible` exacto: crece con el devengo cada día que pasa,
    // así que un número literal convertiría este test en una bomba de relojería
    // que estallaría sola dentro de un mes. Lo invariante es que sin vacaciones
    // aprobadas nunca puede quedar por debajo del saldo de corte.
    expect(r.body.saldo.disponible).toBeGreaterThanOrEqual(10);
  });

  it('sin ficha de empleado responde `saldo: null` explícito, no una clave ausente', async () => {
    // `undefined` desaparece al serializar a JSON, y el widget distingue "sin
    // ficha" de "sin configurar" mirando el valor: si aquí se colara un
    // `undefined`, el widget se rompería en silencio.
    estado.empleado = null;
    estado.usuarioEnPortal = false;
    const r = await request(app()).get('/api/ausencias/mi-saldo').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(r.body).toHaveProperty('saldo', null);
  });

  it('401 sin token', async () => {
    await request(app()).get('/api/ausencias/mi-saldo').expect(401);
  });

  it('403 con token válido pero sin la app asignada', async () => {
    await request(app())
      .get('/api/ausencias/mi-saldo')
      .set('Authorization', `Bearer ${token({ apps: ['contabilidad'] })}`)
      .expect(403);
  });

  it('500 si el cálculo del saldo lanza, en vez de un saldo en blanco', async () => {
    // Lo CONTRARIO de /ausencias/contexto, y a propósito: allí el saldo es un
    // accesorio de un payload que la app necesita para arrancar, y degradarlo a
    // `null` permite abrir la app. Aquí el saldo ES la respuesta, así que
    // devolverlo en blanco sería mentir por omisión. Sin este test, alguien
    // "arreglaría" el endpoint copiando el try/catch del contexto y el widget
    // pasaría a enseñar «sin configurar» ante un fallo real, mandando a la
    // persona a administración a arreglar algo que no está roto.
    // Una `fechaCorte` con formato inválido es lo que hace lanzar a `calcularSaldo`.
    estado.plantilla.push({ ...(estado.empleado as Record<string, unknown>), saldoCorte: 10, fechaCorte: 'fecha-invalida' });
    await request(app()).get('/api/ausencias/mi-saldo').set('Authorization', `Bearer ${token()}`).expect(500);
  });
});
```

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run test --workspace=apps/hub-api -- router.test.ts -t "mi-saldo"
```

Esperado: **FAIL**. Los cinco dan 404 en vez de 200/401/403/500, porque la ruta no existe todavía. (El de 401 puede pasar por accidente: un 404 no es 401, así que debe fallar también — si pasara, revisar que la ruta esté bien escrita en el test.)

- [ ] **Step 3: Implementar la ruta**

En `apps/hub-api/src/ausencias/router.ts`, insertar **justo antes** del bloque `router.get('/ausencias/saldos', ...gated, …)`:

```ts
  /**
   * El saldo de quien pregunta, y nada más. Existe para el widget del dashboard
   * del portal: `/ausencias/contexto` ya trae este dato, pero arrastra con él los
   * festivos de tres años y tres consultas más que un indicador no necesita, y la
   * home del portal lo pagaría en cada carga.
   *
   * Mantiene el `asegurarEmpleado` del contexto a sabiendas de que es un UPSERT
   * dentro de un GET. Es idempotente, y sin él quien acaba de ser dado de alta
   * vería «sin configurar» en el widget hasta la primera vez que abriera la app
   * — un mensaje que le mandaría a administración sin que hubiera nada que
   * arreglar.
   *
   * Si el cálculo lanza sale un 500, no un saldo en blanco: aquí el saldo ES la
   * respuesta. Mismo criterio que `/ausencias/saldos` y el contrario al de
   * `/ausencias/contexto` (ver el JSDoc de las dos).
   */
  router.get('/ausencias/mi-saldo', ...gated, async (req: Request, res: Response) => {
    try {
      const sesion = sesionDe(req);
      const empleado = await repo.asegurarEmpleado(db, sesion.userId, sesion.email);
      res.json({ saldo: empleado ? await service.saldoDeSesion(db, empleado) : null });
    } catch (e) {
      sendError(res, e, 'ausencias_mi_saldo');
    }
  });

```

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run test --workspace=apps/hub-api -- router.test.ts -t "mi-saldo"
```

Esperado: **5 passed**. El test del 500 imprime un `console.error` y un aviso de Sentry por la consola: es lo normal en este fichero, no un fallo.

- [ ] **Step 5: Pasar los dos portones de hub-api**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api
```

Esperado: build sin errores y **548 tests en verde** (543 previos + 5 nuevos). Si falla `users.service.test.ts > property tests > 4.5`, es el flake ajeno: reejecutar.

- [ ] **Step 6: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): endpoint del saldo propio para el widget del dashboard" -- apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/router.test.ts
```

---

### Task 2: `IndicadorSaldo`, la regla en un solo sitio

**Files:**
- Create: `apps/ausencias/src/IndicadorSaldo.tsx`

No lleva test propio: `apps/ausencias` no tiene infraestructura de tests y esta feature no la introduce (ver la spec, «Alcance»). Lo verifica el portón de tipos del portal en la Task 5.

- [ ] **Step 1: Crear el componente**

```tsx
import { CalendarClock } from 'lucide-react';
import type { SaldoVacaciones } from './api';

// El indicador del saldo, en las dos superficies donde se enseña: la cabecera de
// la app y el widget del dashboard.
//
// La REGLA de qué número se muestra vive aquí y solo aquí —el grande es
// `disponible`, y `enTramite` aparece como aviso únicamente cuando hay algo
// pendiente—. Si cada superficie la escribiera por su cuenta, la primera vez que
// alguien tocara una se separarían, y el síntoma sería que el dashboard y la app
// dicen números distintos de la misma persona.
//
// No se enseña en grande el «pedible» (`disponible − enTramite`) porque
// `disponible` es lo que ve un administrador en el panel de Saldos: habría dos
// cifras para «mi saldo» sin nada que explicara la diferencia. Pero ocultar el
// trámite reproduce un fallo ya reportado —pedir 10 días, luego otros 10, y que
// la cifra siga diciendo que quedan 12—. De ahí la línea de aviso.
//
// `TarjetaSaldo` es otra cosa y no se fusiona con este: además del saldo, avisa
// de que los días que se están escribiendo en el formulario no caben.

interface Props {
  /** Solo se llama con `configurado: true`; quien llama decide qué hacer si no. */
  saldo: SaldoVacaciones;
  variante: 'cabecera' | 'widget';
}

/** Un decimal, y sin el «,0» cuando es entero. Mismo formato que TarjetaSaldo. */
function dias(n: number): string {
  return n.toLocaleString('es-CO', { maximumFractionDigits: 1 });
}

export default function IndicadorSaldo({ saldo, variante }: Props) {
  // Dos ramas explícitas en vez de una sola plantilla con ternarios por clase:
  // las jerarquías visuales son distintas —en el widget el número es el
  // protagonista, en la cabecera acompaña al título— y mezclarlas hace ilegibles
  // las dos.
  if (variante === 'widget') {
    return (
      <div className="text-center">
        <p className="text-4xl font-bold leading-none tabular-nums text-blue-600">{dias(saldo.disponible)}</p>
        <p className="mt-1 text-xs text-gray-500">días disponibles</p>
        {saldo.enTramite > 0 && (
          <p className="mt-1.5 text-xs font-semibold text-amber-600">{dias(saldo.enTramite)} pendientes de aprobar</p>
        )}
      </div>
    );
  }

  return (
    <div className="text-right">
      <p className="flex items-center justify-end gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        Tu saldo hoy
      </p>
      <p className="text-2xl font-bold leading-none tabular-nums text-blue-600">
        {dias(saldo.disponible)}
        <span className="ml-1 text-sm font-medium text-gray-500">días</span>
      </p>
      {saldo.enTramite > 0 && (
        <p className="mt-0.5 text-[11px] font-semibold text-amber-600">{dias(saldo.enTramite)} pendientes de aprobar</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): componente del indicador de saldo, con la regla en un solo sitio" -- apps/ausencias/src/IndicadorSaldo.tsx
```

---

### Task 3: La cabecera de la app

**Files:**
- Modify: `apps/ausencias/src/App.tsx` (import sobre la línea 21; `onDecidida` sobre la 151; `<header>` en 158-167; bloque de «Mis solicitudes» en 232-239)

- [ ] **Step 1: Cambiar los imports**

`TarjetaSaldo` deja de usarse en `App.tsx` (sigue vivo, importado por `FormularioSolicitud` y `BandejaAprobacion`). Sustituir la línea 21:

```tsx
import TarjetaSaldo from './TarjetaSaldo';
```

por:

```tsx
import IndicadorSaldo from './IndicadorSaldo';
```

- [ ] **Step 2: Reemplazar la cabecera**

Sustituir el bloque completo `<header>…</header>` (líneas 158-167) por:

```tsx
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-blue-600" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Vacaciones y Permisos</h1>
            <p className="text-sm text-gray-500">
              Solicita vacaciones, compensatorios y permisos, o informa una incapacidad. Los días hábiles descuentan
              fines de semana y festivos de Colombia.
            </p>
          </div>
        </div>
        {/* Sin saldo configurado no se enseña NADA aquí, ni un cartel de aviso:
            sería permanente y en todas las pestañas, y hoy todavía le falta el
            saldo inicial a una decena de personas. Ese aviso ya lo da
            TarjetaSaldo en «Nueva solicitud», que es donde importa. `null` (sin
            ficha, o el cálculo falló) cae en la misma rama: ninguna de las dos
            cosas se arregla poniendo un número en la cabecera. */}
        {contexto?.saldo?.configurado && (
          <div className="border-l border-gray-200 pl-4">
            <IndicadorSaldo saldo={contexto.saldo} variante="cabecera" />
          </div>
        )}
      </header>
```

- [ ] **Step 3: Quitar la tarjeta duplicada de «Mis solicitudes»**

Sustituir el bloque de las líneas 232-239 por:

```tsx
              {/* Aquí había una TarjetaSaldo. Se retiró al subir el indicador a la
                  cabecera: enseñaba el mismo número a un centímetro de distancia. */}
              <div className={tab === 'mias' ? '' : 'hidden'}>
                <TablaSolicitudes solicitudes={mias} vacio="Todavía no has enviado ninguna solicitud." />
              </div>
```

- [ ] **Step 4: Refrescar también el saldo propio al decidir**

En `onDecidida`, **después** del bloque `fetchSaldos().then(…)` existente, añadir:

```tsx
    // Y el propio, no solo los de la bandeja: un admin puede aprobar sus propias
    // vacaciones, y sin esto su indicador de cabecera seguiría enseñando el
    // número de antes de la decisión hasta recargar la página. Misma política que
    // en `onCreada`: no se espera ni se propaga el error, porque la decisión ya
    // está tomada y esto solo mejora la frescura.
    fetchContexto()
      .then((ctx) => setContexto((actual) => (actual ? { ...actual, saldo: ctx.saldo } : actual)))
      .catch(() => {});
```

- [ ] **Step 5: Verificar que el portal compila (portón de tipos de `apps/ausencias`)**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/portal
```

Esperado: **build sin errores**. Si aparece `'TarjetaSaldo' is declared but its value is never read`, es que el Step 1 se quedó a medias.

- [ ] **Step 6: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): el saldo pasa a la cabecera, visible desde cualquier pestana" -- apps/ausencias/src/App.tsx
```

---

### Task 4: El widget

**Files:**
- Modify: `apps/ausencias/src/api.ts` (junto a `fetchContexto`, sobre la línea 151)
- Create: `apps/ausencias/src/widgets/WidgetSaldo.tsx`
- Create: `apps/ausencias/src/widgets/index.ts`

- [ ] **Step 1: Añadir `fetchMiSaldo` a `api.ts`**

Justo **debajo** de `export const fetchContexto = …`:

```ts
/**
 * Solo el saldo de quien pregunta. Lo usa el widget del dashboard, que no
 * necesita el resto del contexto —festivos de tres años incluidos— y lo cargaría
 * en cada visita a la home del portal.
 */
export const fetchMiSaldo = () =>
  get<{ saldo: SaldoVacaciones | null }>('/api/ausencias/mi-saldo').then((d) => d.saldo);
```

- [ ] **Step 2: Crear el widget**

`apps/ausencias/src/widgets/WidgetSaldo.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { fetchMiSaldo, type SaldoVacaciones } from '../api';
import IndicadorSaldo from '../IndicadorSaldo';

// Widget del Dashboard del Portal. Autocontenido a la fuerza: el contrato de
// WidgetDescriptor no le pasa props, así que carga su propio dato. El Portal lo
// envuelve en Suspense + ErrorBoundary.

type Estado =
  | { fase: 'cargando' }
  | { fase: 'error' }
  | { fase: 'listo'; saldo: SaldoVacaciones | null };

export default function WidgetSaldo() {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });

  useEffect(() => {
    let vivo = true;
    fetchMiSaldo()
      .then((saldo) => vivo && setEstado({ fase: 'listo', saldo }))
      .catch(() => vivo && setEstado({ fase: 'error' }));
    return () => {
      vivo = false;
    };
  }, []);

  if (estado.fase === 'cargando') return <Mensaje>Cargando…</Mensaje>;
  if (estado.fase === 'error') return <Mensaje tono="error">No se pudo cargar tu saldo.</Mensaje>;
  // `null` (sin ficha) y `configurado: false` caen juntos a propósito: en los dos
  // casos no hay número que enseñar. Y nunca un 0,0 en grande — se leería como
  // «no me quedan días», que no es lo mismo que «nadie ha fijado tu punto de
  // partida», y hoy le pasa a una decena de personas de verdad.
  if (!estado.saldo?.configurado) return <Mensaje>Todavía sin configurar. Habla con administración.</Mensaje>;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <IndicadorSaldo saldo={estado.saldo} variante="widget" />
      {/* Un <a> de verdad, no navegación de React Router: `apps/ausencias` no
          depende de react-router y arranca también suelta en `vite dev`, sin
          Router, donde un useNavigate reventaría. Recarga la SPA, a cambio de
          poder abrirse con ctrl+clic en otra pestaña. Sin parámetros: App.tsx
          arranca ya en la pestaña «nueva». */}
      <a
        href="/ausencias"
        className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50"
      >
        Pedir vacaciones →
      </a>
    </div>
  );
}

function Mensaje({ children, tono }: { children: React.ReactNode; tono?: 'error' }) {
  return (
    <div
      className={`flex h-full items-center justify-center px-3 text-center text-sm ${
        tono === 'error' ? 'text-red-500' : 'text-gray-400'
      }`}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Crear el descriptor**

`apps/ausencias/src/widgets/index.ts`:

```ts
import type { WidgetDescriptor } from '../../../portal/src/widgets/types';
import WidgetSaldo from './WidgetSaldo';

// Widgets que esta app expone al Dashboard del Portal. El Portal los descubre
// vía import dinámico (portal/src/widgets/registry.ts).

const widgets: WidgetDescriptor[] = [
  {
    id: 'ausencias-mi-saldo',
    appId: 'ausencias',
    name: 'Mi saldo de vacaciones',
    description: 'Días de vacaciones disponibles a día de hoy.',
    defaultSize: { w: 3, h: 2 },
    component: WidgetSaldo,
  },
];

export default widgets;
```

- [ ] **Step 4: Commit**

El widget todavía no está registrado, así que no se puede probar aún; se registra y se verifica en la Task 5. Se commitea aparte porque son unidades distintas: esto es lo que la app **ofrece**, y la Task 5 es lo que el portal **acepta**.

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): widget de saldo para el dashboard" -- apps/ausencias/src/api.ts apps/ausencias/src/widgets/WidgetSaldo.tsx apps/ausencias/src/widgets/index.ts
```

---

### Task 5: Registrar el widget en el portal

**Files:**
- Modify: `apps/portal/src/widgets/registry.ts` (línea 22, dentro de `WIDGET_FACTORIES`)

- [ ] **Step 1: Añadir la factory**

Añadir como última entrada del objeto `WIDGET_FACTORIES`, después de `'contabilidad'`:

```ts
  'ausencias': () => import('../../../ausencias/src/widgets/index'),
```

El comentario de cabecera de ese fichero enumera las apps sin widgets (`inventory-consolidation`, `product-sales`, `laboratorios-ambientales`, `WO-sales`) y **no menciona `ausencias`**, así que no hay nada que quitar de esa lista. No tocar el comentario.

- [ ] **Step 2: Pasar los tres portones**

Este es el momento en que `tsc -b` del portal ve por primera vez `IndicadorSaldo`, `WidgetSaldo` y el descriptor: el widget entra en su grafo de imports justo con este registro.

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api; npm run build --workspace=apps/portal
```

Esperado: los tres en verde, 548 tests. Un fallo de tipos aquí apunta a la Task 2 o la 4; el descriptor debe encajar con `WidgetDescriptor` (`w` y `h` enteros en [1, 12]).

- [ ] **Step 3: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(portal): registrar el widget de saldo de ausencias" -- apps/portal/src/widgets/registry.ts
```

---

### Task 6: Documentación viva

**Files:**
- Modify: `docs/dev/app-ausencias.md` (tabla de la sección `## Endpoints`, línea 145; sección `## Saldo de vacaciones`, línea 194)

- [ ] **Step 1: Añadir el endpoint a la tabla**

Insertar esta fila **justo debajo** de la de `/api/ausencias/saldos` (línea 154):

```markdown
| `GET` | `/api/ausencias/mi-saldo` | idem — solo el saldo propio; **500** si el cálculo falla, no un saldo en blanco |
```

- [ ] **Step 2: Documentar dónde se ve el saldo**

Añadir al **final** de la sección `## Saldo de vacaciones` (justo antes de `## Los adjuntos`):

```markdown
### Dónde se ve

`IndicadorSaldo.tsx` concentra la regla: **el número grande es `disponible`**, y
`enTramite` sale como línea de aviso solo cuando hay algo pendiente. Se usa en dos
sitios, la cabecera de la app y el widget del dashboard, y existe precisamente
para que esos dos no puedan separarse.

No se enseña en grande el «pedible» (`disponible − enTramite`), que es lo que de
verdad se puede pedir: `disponible` es el número que ve un administrador en el
panel de Saldos, y poner otro en la cabecera daría dos cifras para «mi saldo» sin
nada que explicara la diferencia.

Con `saldo === null` o `configurado: false` la cabecera **no enseña nada**, ni un
cartel: sería permanente y en todas las pestañas. Ese aviso ya lo da
`TarjetaSaldo` en «Nueva solicitud». El widget sí lo dice, porque ahí no hay nada
más que enseñar — y nunca como un 0,0, que se leería como «no me quedan días».

`TarjetaSaldo` sigue viva y **no** es lo mismo: además del saldo, avisa en rojo de
que los días que se están escribiendo en el formulario no caben. Vive en «Nueva
solicitud» y en la bandeja (donde muestra el saldo de otra persona, vía `titulo`).

El widget se llama `ausencias-mi-saldo` y lo sirve `GET /ausencias/mi-saldo`, no
el contexto: la home del portal no debe cargar los festivos de tres años para
pintar un número. **Aviso:** `useWidgetRegistry` filtra el catálogo por el claim
`apps` del JWT **sin mirar el rol**, mientras que `requireApp` deja pasar a
cualquier admin aunque no tenga la app asignada. Un admin sin `ausencias` en su
lista no verá el widget en «Editar panel» aunque el endpoint le responda. Es de
serie en el dashboard, no de esta app.
```

- [ ] **Step 3: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "docs(ausencias): donde se ve el saldo y el endpoint del widget" -- docs/dev/app-ausencias.md
```

---

### Task 7: Cerrar la rama

- [ ] **Step 1: Pasar los tres portones una última vez, sobre el árbol completo**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api; npm run build --workspace=apps/portal
```

Esperado: los tres en verde, 548 tests.

- [ ] **Step 2: Comprobar que no queda nada suelto**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git status --short; git log --oneline main..HEAD
```

Esperado: en `git status` solo `?? apps/WO-sales/prompts/` (ajeno, se queda fuera). **Siete** commits sobre `main`: el de la spec (`0dbb2e4`) y uno por cada una de las Tasks 1-6.

- [ ] **Step 3: Mezclar a main**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git checkout main; git merge --no-ff feat/saldo-visible -m "merge: el saldo de vacaciones, siempre a la vista"
```

- [ ] **Step 4: Empujar**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git push origin main
```

---

## Después del plan: despliegue

**No lo ejecuta el agente.** Lo hace una persona en EasyPanel, y el orden importa:

1. **hub-api primero.** El widget del portal llama a `GET /ausencias/mi-saldo`, que hoy no existe. Al revés, quien tuviera el widget puesto vería «No se pudo cargar tu saldo» hasta que hub-api se pusiera al día.
2. **portal después.**

Sin migraciones: nada de esto toca la base y no hay nada irreversible.

**Va después del despliegue ya pendiente** (migraciones 019 y 020), que también es hub-api → portal.

### Comprobación manual, con el código ya desplegado

1. Abrir «Vacaciones y Permisos»: el saldo aparece arriba a la derecha y **sigue ahí** al cambiar de pestaña.
2. En «Mis solicitudes» ya no está el recuadro azul repetido.
3. Enviar una solicitud de vacaciones: el número de la cabecera no baja (sigue en trámite), pero aparece la línea ámbar «N pendientes de aprobar».
4. Aprobarla desde la bandeja: la línea ámbar desaparece y el número baja, **sin recargar**.
5. En el dashboard, «Editar panel» → aparece «Mi saldo de vacaciones» → añadirlo → enseña el mismo número que la app.
6. El enlace «Pedir vacaciones» abre la app en «Nueva solicitud».
