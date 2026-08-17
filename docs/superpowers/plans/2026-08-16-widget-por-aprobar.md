# Widget «Solicitudes por aprobar» — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un aprobador vea desde el Dashboard cuántas solicitudes de vacaciones o permisos esperan su firma, y llegue a la bandeja de un clic.

**Architecture:** Un widget autocontenido en `apps/ausencias` que reusa el endpoint `GET /api/ausencias/pendientes` ya existente (que desde `22c2aac` marca cada fila con `esMiTurno`), más una función pura que resume la lista. Cero cambios en hub-api, cero migraciones: se despliega solo el portal. Spec: `docs/superpowers/specs/2026-08-16-widget-por-aprobar-design.md`.

**Tech Stack:** React 19 + TypeScript + Tailwind 3, dentro del monorepo npm workspaces. El contrato es `WidgetDescriptor` (`apps/portal/src/widgets/types.ts`).

---

## Antes de empezar: lo que hay que saber de este repo

Si no conoces el repo, lee esto o vas a perder tiempo.

- **Shell: PowerShell 5.1.** No existe `&&`; encadena con `;`. Y **pierde el directorio de trabajo entre llamadas**: abre cada comando con `Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"` o npm no encontrará los workspaces.
- **Nunca `2>&1` sobre `git` o `npm`.** PowerShell 5.1 envuelve cada línea de stderr en un `NativeCommandError` y un comando correcto parece fallar.
- **Comentarios y mensajes de commit en español, y sin tildes en el mensaje de commit** (es la convención del repo; mira `git log`). Los comentarios explican **por qué**, no qué.
- **Al commitear: `git commit -m "..." -- ruta1 ruta2`. Nunca `git add -A`** — hay un `apps/WO-sales/prompts/` sin trackear que es ajeno a esto. Los ficheros nuevos sí necesitan `git add <ruta exacta>` antes.
- **El portón real de esta feature es `npm run build --workspace=apps/portal`**, que es `tsc -b && vite build`. El `build` de `apps/ausencias` es `vite build` a secas (esbuild transpila sin comprobar tipos), pero el portal importa `apps/ausencias/src/widgets/index` y `tsc` arrastra el módulo a su programa. Todo lo que escribas aquí queda type-checkeado **por el build del portal**.
- **`apps/ausencias` no tiene runner de tests.** Ver la nota sobre TDD justo debajo.

### Nota sobre TDD (lee esto antes de extrañarte)

Este plan **no lleva pasos de test automático**, y es una desviación consciente del método habitual, no un olvido.

`apps/ausencias` no tiene `vitest` ni script `test` (comprobado en su `package.json`). Montarlo aquí significaría cambiar su `package.json` y añadir un paso de CI, que es exactamente la deuda del «portón de typecheck de ausencias» que el equipo ya tiene anotada aparte. El usuario aceptó explícitamente este hueco al aprobar el spec.

Mitigación, y por eso la Tarea 1 existe separada: **toda la lógica vive en una función pura, sin React, sin fetch y sin reloj propio**, para que sea trivial de cubrir el día que esa app tenga runner. La verificación de este plan se apoya en el portón de tipos (Tarea 6) y en una comprobación manual guiada con valores esperados exactos (Tarea 7).

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `apps/ausencias/src/widgets/resumirPendientes.ts` | **Nuevo.** La lógica: filtro de turno, conteo y antigüedad. Pura. |
| `apps/ausencias/src/widgets/WidgetPendientes.tsx` | **Nuevo.** El componente: carga, estados, textos y refresco. |
| `apps/ausencias/src/widgets/index.ts` | **Modificar.** Una segunda entrada en el array de descriptores. |
| `apps/ausencias/src/App.tsx` | **Modificar.** Leer la pestaña inicial del hash. Severable. |
| `docs/dev/app-ausencias.md` | **Modificar.** Documentación viva. |

`apps/portal/src/widgets/registry.ts` **no se toca**: el descubrimiento del Portal es por app, y `ausencias` ya está registrada.

---

## Tarea 1: La función pura `resumirPendientes`

**Files:**
- Create: `apps/ausencias/src/widgets/resumirPendientes.ts`

- [ ] **Paso 1: Crear el fichero con este contenido exacto**

```ts
import type { SolicitudPendiente } from '../api';

// Resumen que alimenta el widget «Solicitudes por aprobar» del Dashboard.
// Pura a propósito —sin React, sin fetch y sin reloj propio: `ahora` entra por
// parámetro— para poder razonarla de un vistazo, y para que cubrirla con tests
// sea trivial el día que esta app tenga runner.

export interface ResumenPendientes {
  /** Cuántas esperan la firma de quien mira el widget. */
  total: number;
  /** Días naturales que lleva esperando la más antigua. `null` si no hay ninguna. */
  esperaDias: number | null;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Desde cuándo lleva esperando a ESTE firmante.
 *
 * Para una `pendiente_2` la espera arranca en la primera firma, no en el alta:
 * hasta ese momento la solicitud no le estaba esperando a él. Medirla desde
 * `createdAt` le cobraría la tardanza del primer aprobador y convertiría el
 * aviso en un reproche injusto.
 */
function esperandoDesde(s: SolicitudPendiente): string {
  return s.estado === 'pendiente_2' ? (s.primeraFirmaAt ?? s.createdAt) : s.createdAt;
}

export function resumirPendientes(
  solicitudes: SolicitudPendiente[],
  ahora: Date,
): ResumenPendientes {
  // `!== false` y no `=== true`. Los dos servicios se despliegan por separado y
  // hay una ventana en que el portal va por delante de hub-api; ahí el campo
  // llega `undefined`. Así degrada a «cuéntalas todas» —el comportamiento
  // anterior— y el peor caso es un número inflado, que se ve y se corrige solo
  // al desplegar. Con `=== true` degradaría a 0: diría «nada pendiente»
  // mientras las solicitudes se pudren, y eso no lo nota nadie.
  const mias = solicitudes.filter((s) => s.esMiTurno !== false);
  if (mias.length === 0) return { total: 0, esperaDias: null };

  const instantes = mias
    .map((s) => new Date(esperandoDesde(s)).getTime())
    .filter((t) => Number.isFinite(t));

  // Si ninguna fecha es legible seguimos sabiendo cuántas hay: se calla la
  // antigüedad, pero no se pierde el aviso. Un «NaN días» sería peor que nada.
  if (instantes.length === 0) return { total: mias.length, esperaDias: null };

  // Días naturales, no hábiles: una solicitud atascada el fin de semana está
  // atascada igual, y contar hábiles exigiría los festivos, que viajan en
  // `/ausencias/contexto` y costarían una segunda llamada.
  const espera = (ahora.getTime() - Math.min(...instantes)) / MS_POR_DIA;

  return { total: mias.length, esperaDias: Math.max(0, Math.floor(espera)) };
}
```

- [ ] **Paso 2: Comprobar que compila**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/portal
```

Esperado: termina sin errores. Si `tsc` se queja de que `SolicitudPendiente` no se exporta, revisa que estés importando de `../api` y no de otro sitio.

- [ ] **Paso 3: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git add "apps/ausencias/src/widgets/resumirPendientes.ts"; git commit -m "feat(ausencias): resumen de pendientes para el widget del dashboard" -- "apps/ausencias/src/widgets/resumirPendientes.ts"
```

---

## Tarea 2: El componente `WidgetPendientes`

**Files:**
- Create: `apps/ausencias/src/widgets/WidgetPendientes.tsx`

Sigue el patrón de su hermano `apps/ausencias/src/widgets/WidgetSaldo.tsx`. Léelo antes: resuelve los mismos problemas (sesión caducada, enlace sin React Router) y conviene no divergir sin motivo.

- [ ] **Paso 1: Crear el fichero con este contenido exacto**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPendientes } from '../api';
import { resumirPendientes, type ResumenPendientes } from './resumirPendientes';

// Widget del Dashboard del Portal. Autocontenido a la fuerza: el contrato de
// WidgetDescriptor no le pasa props, así que carga su propio dato. El Portal lo
// envuelve en Suspense + ErrorBoundary.

type Estado =
  | { fase: 'cargando' }
  | { fase: 'error'; mensaje: string }
  | { fase: 'listo'; resumen: ResumenPendientes };

/** Mínimo entre recargas al volver a la pestaña. */
const REFRESCO_MS = 60_000;

export default function WidgetPendientes() {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });
  const ultimaCarga = useRef(0);
  const vivo = useRef(true);

  const cargar = useCallback(() => {
    ultimaCarga.current = Date.now();
    fetchPendientes()
      .then((solicitudes) => {
        if (!vivo.current) return;
        setEstado({ fase: 'listo', resumen: resumirPendientes(solicitudes, new Date()) });
      })
      // `mensajeDeError` (dentro de `fetchPendientes`) ya distingue 401 y 403 del
      // resto: el token vive en localStorage y una pestaña puede llevar horas
      // abierta, así que decir «no se pudo cargar» cuando lo que pasa es que
      // caducó la sesión manda a la persona a recargar en vez de a volver a entrar.
      .catch((e) => {
        if (!vivo.current) return;
        setEstado({
          fase: 'error',
          mensaje: e instanceof Error ? e.message : 'No se pudo cargar tu bandeja.',
        });
      });
  }, []);

  useEffect(() => {
    vivo.current = true;
    cargar();

    // Un dashboard se queda abierto toda la mañana y este número envejece mal.
    // Volver al navegador tras leer el correo es justo cuando ha llegado una
    // solicitud nueva, así que el foco es la señal correcta; con la pestaña
    // oculta no se gasta ni una llamada.
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - ultimaCarga.current > REFRESCO_MS) cargar();
    };
    document.addEventListener('visibilitychange', alVolver);

    return () => {
      vivo.current = false;
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [cargar]);

  if (estado.fase === 'cargando') return <Mensaje>Cargando…</Mensaje>;
  if (estado.fase === 'error') return <Mensaje tono="error">{estado.mensaje}</Mensaje>;

  const { total, esperaDias } = estado.resumen;
  // Sin botón a propósito: no hay ninguna urgencia a la que mandar a nadie.
  if (total === 0) return <Mensaje>Nada pendiente de firmar.</Mensaje>;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center">
      <span className="text-5xl font-bold leading-none text-blue-600">{total}</span>
      <span className="text-sm text-gray-500">{total === 1 ? 'solicitud' : 'solicitudes'}</span>
      {esperaDias !== null && <span className="mt-1 text-xs text-gray-500">{lineaDeEspera(esperaDias)}</span>}
      {/* Un <a> de verdad, no navegación de React Router: `apps/ausencias` no
          depende de react-router y arranca también suelta en `vite dev`, sin
          Router, donde un useNavigate reventaría. El `#bandeja` lo lee App.tsx
          al arrancar para aterrizar en la bandeja y no en el formulario. */}
      <a
        href="/ausencias#bandeja"
        className="mt-2 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50"
      >
        Ir a firmar <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}

/**
 * La frase se arma en una plantilla y no en JSX con etiquetas anidadas: en este
 * repo un salto de línea entre texto y etiqueta ya se comió un espacio una vez
 * («persona.Quién»), y aquí no hay nada que ganar arriesgándolo.
 *
 * «1 día», nunca «1 días»: la concordancia acaba de fallar en el aviso de saldo.
 */
function lineaDeEspera(dias: number): string {
  if (dias === 0) return 'La más antigua llegó hoy';
  return `La más antigua lleva ${dias} ${dias === 1 ? 'día' : 'días'} esperando`;
}

function Mensaje({ children, tono }: { children: React.ReactNode; tono?: 'error' }) {
  return (
    <div
      className={`flex h-full items-center justify-center px-3 text-center text-sm ${
        tono === 'error' ? 'text-red-600' : 'text-gray-500'
      }`}
    >
      {children}
    </div>
  );
}
```

**No cambies `text-gray-500` por `text-gray-400`.** El repo ya tiene anotado un `text-gray-400` que da 2,54:1 de contraste y no llega a AA. `gray-500` sobre blanco da 4,83:1 y sí llega.

- [ ] **Paso 2: Comprobar que compila**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/portal
```

Esperado: termina sin errores. Todavía no se ve nada en el navegador: falta registrarlo (Tarea 3).

- [ ] **Paso 3: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git add "apps/ausencias/src/widgets/WidgetPendientes.tsx"; git commit -m "feat(ausencias): tarjeta de solicitudes por aprobar" -- "apps/ausencias/src/widgets/WidgetPendientes.tsx"
```

---

## Tarea 3: Registrar el widget en el catálogo

**Files:**
- Modify: `apps/ausencias/src/widgets/index.ts`

El agregador del Portal (`aggregateDescriptors` en `apps/portal/src/hooks/useWidgetRegistry.ts`) **valida la forma del descriptor y descarta el que no pase**, y además **deduplica por `id`**. Un `id` repetido o un `defaultSize` fuera de `[1, 12]` no rompe el build: el widget simplemente no aparece, con un `console.error`. Si tras esta tarea no lo ves en «Editar panel», mira la consola del navegador antes que ninguna otra cosa.

- [ ] **Paso 1: Reemplazar el fichero entero por esto**

```ts
import type { WidgetDescriptor } from '../../../portal/src/widgets/types';
import WidgetSaldo from './WidgetSaldo';
import WidgetPendientes from './WidgetPendientes';

// Widgets que esta app expone al Dashboard del Portal. El Portal los descubre
// vía import dinámico (portal/src/widgets/registry.ts).

const widgets: WidgetDescriptor[] = [
  {
    id: 'ausencias-mi-saldo',
    appId: 'ausencias',
    name: 'Mi saldo de vacaciones',
    description: 'Días de vacaciones disponibles a día de hoy.',
    defaultSize: { w: 4, h: 3 },
    component: WidgetSaldo,
  },
  {
    id: 'ausencias-por-aprobar',
    appId: 'ausencias',
    name: 'Solicitudes por aprobar',
    description: 'Vacaciones y permisos que esperan tu firma.',
    // 4×3, el mismo que el hermano. El tamaño hay que acertarlo a la primera:
    // `addWidget` copia `defaultSize` al layout que se persiste en el
    // localStorage de cada usuario, así que subirlo más tarde no arregla a
    // quien ya lo tenga añadido. Se verifica con el texto más largo en la
    // Tarea 7.
    defaultSize: { w: 4, h: 3 },
    component: WidgetPendientes,
  },
];

export default widgets;
```

- [ ] **Paso 2: Comprobar que compila**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/portal
```

Esperado: termina sin errores.

- [ ] **Paso 3: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): registra el widget de solicitudes por aprobar" -- "apps/ausencias/src/widgets/index.ts"
```

---

## Tarea 4: El enlace profundo a la bandeja

**Files:**
- Modify: `apps/ausencias/src/App.tsx` (la unión `Pestana` está en la línea 28; el `useState` del tab, en la 47)

Esta tarea es **severable**: si se cae, cambia el `href` del widget a `/ausencias` a secas y todo lo demás sigue funcionando. Lo que se pierde es aterrizar en la bandeja, que es la fricción que el widget venía a quitar.

- [ ] **Paso 1: Añadir la lista y el lector del hash justo después de la unión `Pestana`** (después de la línea 38, antes de `export default function App()`)

```ts
// Espejo en tiempo de ejecución de la unión `Pestana` de arriba: los tipos no
// existen al ejecutar y el hash llega como string. Si añades una pestaña, añádela
// también aquí o el enlace directo a esa pestaña se ignorará en silencio.
const PESTANAS_VALIDAS: readonly string[] = [
  'nueva',
  'mias',
  'bandeja',
  'historial',
  'adjuntos',
  'empleados',
  'organigrama',
  'saldos',
  'historico',
  'calendario',
];

/**
 * La pestaña pedida por el hash (`/ausencias#bandeja`), para que el widget del
 * Dashboard pueda aterrizar en la bandeja y no en el formulario.
 *
 * No comprueba permisos a propósito: el efecto de más abajo ya devuelve a la
 * primera pestaña disponible cuando la activa no le corresponde a este usuario,
 * así que el hash no puede abrir nada que no se pudiera abrir pinchando.
 */
function pestanaDelHash(): Pestana | null {
  if (typeof window === 'undefined') return null;
  const h = window.location.hash.replace(/^#/, '');
  return PESTANAS_VALIDAS.includes(h) ? (h as Pestana) : null;
}
```

- [ ] **Paso 2: Cambiar la inicialización del tab**

Busca en `App.tsx` esta línea (está sobre la 47):

```ts
  const [tab, setTab] = useState<Pestana>('nueva');
```

Y déjala así:

```ts
  const [tab, setTab] = useState<Pestana>(() => pestanaDelHash() ?? 'nueva');
```

Es un inicializador perezoso: solo se lee el hash en el primer render, no en cada uno.

- [ ] **Paso 3: Comprobar que compila**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/portal
```

Esperado: termina sin errores.

- [ ] **Paso 4: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): la app admite abrir una pestana por hash" -- "apps/ausencias/src/App.tsx"
```

---

## Tarea 5: Documentación viva

**Files:**
- Modify: `docs/dev/app-ausencias.md`

El modo de fallo más repetido de esta app es el texto que dejó de ser cierto. Ningún portón lo caza, así que va como tarea.

- [ ] **Paso 1: Añadir la sección del widget nuevo**

En la sección donde se documenta el widget de saldo (busca el párrafo que empieza por `**El widget** (`ausencias-mi-saldo`, tamaño `4×3`)`), añade **después** del párrafo que termina con «…no habría corregido a quien ya lo tuviera añadido con el valor viejo.» este bloque:

```markdown
**El widget de aprobación** (`ausencias-por-aprobar`, tamaño `4×3`) lo sirve
`GET \ausencias\pendientes`, el mismo endpoint que la bandeja. Enseña **solo
las de su turno**: cuenta las filas con `esMiTurno`, no la lista entera. La
diferencia solo se ve en un admin —a los demás la consulta ya les entrega solo
su turno—, y es deliberada: enseñarle un 12 a quien solo puede actuar sobre 3
es el mismo malentendido que partió la bandeja en dos.

El filtro es `esMiTurno !== false`, no `=== true`, por la ventana en que el
portal va por delante de hub-api: con el campo ausente degrada a contarlas
todas —un número inflado se ve— y no a 0, que diría «nada pendiente» mientras
las solicitudes se pudren.

La antigüedad que enseña se mide desde `primeraFirmaAt` en las `pendiente_2` y
desde `createdAt` en las demás: al segundo firmante no se le puede cobrar la
tardanza del primero. En días naturales, porque una solicitud atascada el fin
de semana está atascada igual.

Se refresca al montar y al volver a la pestaña (`visibilitychange`, con 60 s de
guarda), no con un `setInterval`: un dashboard se queda abierto toda la mañana
y sondearlo serían ~12 llamadas/hora por pestaña aunque nadie mire.

Quien no aprueba a nadie puede añadirlo igual —`useWidgetRegistry` filtra por
app, no por rol— y verá siempre «Nada pendiente de firmar.».

Para aterrizar en la bandeja, la app acepta abrir una pestaña por hash
(`/ausencias#bandeja`): `App.tsx` lo lee en el inicializador del `useState` del
tab. No hace falta comprobar permisos ahí, porque el efecto que devuelve a la
primera pestaña disponible cuando la activa no le corresponde al usuario ya lo
cubre; el hash no puede abrir nada que no se pudiera abrir pinchando.
```

Las dos inserciones van en el mismo sitio: todo este bloque, seguido, después de ese párrafo. No hay una segunda edición en otra parte del fichero.

- [ ] **Paso 2: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "docs(ausencias): documenta el widget de solicitudes por aprobar" -- "docs/dev/app-ausencias.md"
```

---

## Tarea 6: Los portones

- [ ] **Paso 1: Los tres portones del repo**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api; npm run build --workspace=apps/portal
```

Esperado: los tres en verde. hub-api debe dar **609 tests** pasando.

Dos cosas que **no** son culpa tuya si aparecen:
- `users.service.test.ts > property tests > 4.5` falla ~1 de cada 5 ejecuciones (`fast-check`). Reejecuta.
- Los tests del portal (`npm run test --workspace=apps/portal`) tienen 11 fallos preexistentes por una discrepancia de `jsdom`. No forman parte de los portones y no se tocan aquí.

---

## Tarea 7: Verificación manual

Esta tarea sustituye a los tests automáticos que esta app no puede tener todavía. **No la saltes.**

- [ ] **Paso 1: Levantar el portal**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run dev --workspace=apps/portal
```

Entra con un usuario **que tenga la app `ausencias` asignada**. Sin ese claim en el JWT el widget no aparece en el catálogo.

- [ ] **Paso 2: Añadir el widget y comprobar el caso con datos**

En el Dashboard → «Editar panel» → añade **«Solicitudes por aprobar»**.

| Qué mirar | Esperado |
|---|---|
| La cifra | Coincide con el número de filas de la bandeja marcadas como tuyas |
| El sustantivo | «solicitud» con 1, «solicitudes» con 2 o más |
| La línea de espera | «La más antigua lleva N días esperando», y **«1 día»** en singular |
| Llegada de hoy | «La más antigua llegó hoy», no «lleva 0 días» |
| Nada de esto | Un «NaN», un «1 días», o dos palabras pegadas sin espacio |

- [ ] **Paso 3: Comprobar que cabe en 4×3** *(este es el paso que no se puede deshacer luego)*

Con el texto **más largo posible** en pantalla («La más antigua lleva 12 días esperando»), comprueba que no se corta ni desborda la celda.

Si no cupiera, **sube `h` a 4 en el descriptor de la Tarea 3 antes de mezclar**, no después: `addWidget` copia `defaultSize` al `localStorage` de cada usuario en el momento de añadirlo, así que corregirlo más tarde no arregla a quien ya lo tenga. Precedente: el widget de saldo se probó primero en `3×2` y no cupo por 3 px.

- [ ] **Paso 4: Comprobar el enlace**

Pincha «Ir a firmar». Esperado: aterrizas en la app con la pestaña **«Pendientes de aprobar»** ya activa, no en «Nueva solicitud».

- [ ] **Paso 5: Comprobar el caso vacío y el de admin**

- Con un usuario **sin nada que firmar**: se lee «Nada pendiente de firmar.» y **no hay botón**.
- Con `comercial@` (admin): la cifra es **solo su turno**, no la bandeja entera. Contrástala con lo que enseña la bandeja partida: debe coincidir con la sección de arriba («lo que hay que firmar»), no con el total.

- [ ] **Paso 6: Comprobar el refresco**

Cambia a otra pestaña del navegador, espera **más de 60 segundos**, y vuelve. En la pestaña Red del navegador debe verse una llamada nueva a `/api/ausencias/pendientes`. Vuelve a salir y entrar de inmediato: **no** debe haber otra llamada.

- [ ] **Paso 7: Comprobar el mensaje de sesión caducada**

Es el criterio de aceptación que separa «te mando a recargar» de «te mando a volver a entrar», y solo se ve provocándolo.

En la consola del navegador, invalida el token y fuerza una recarga del widget:

```js
localStorage.setItem('ambientalia_token', 'invalido');
```

Cambia de pestaña, espera más de 60 s y vuelve (o recarga la página entera). Esperado: el widget se pone en rojo con el **mensaje de sesión caducada** que produce `mensajeDeError`, no con un «No se pudo cargar tu bandeja.» genérico.

Después vuelve a entrar con normalidad para dejar la sesión sana.

---

## Tarea 8: Cerrar la rama

- [ ] **Paso 1: Mezclar con `--no-ff`**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git checkout main; git merge --no-ff feat/widget-por-aprobar
```

- [ ] **Paso 2: Empujar**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git push origin main
```

Recuerda: `git push` escribe su progreso por stderr. **No lo redirijas con `2>&1`** o un push correcto parecerá un fallo.

- [ ] **Paso 3: Desplegar**

**Solo el portal.** Esta feature no toca hub-api, así que no hay orden que respetar ni ventana de incompatibilidad que cubrir.

---

## Resumen de decisiones que no se pueden cambiar sin volver al spec

1. Cuenta `esMiTurno`, no la bandeja entera.
2. El filtro es `!== false`, no `=== true`.
3. La espera de una `pendiente_2` se mide desde `primeraFirmaAt`.
4. Refresco por foco con guarda de 60 s, nunca `setInterval`.
5. El estado vacío no lleva botón.
