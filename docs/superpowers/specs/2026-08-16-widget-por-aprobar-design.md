# Diseño — Widget «Solicitudes por aprobar» (app Vacaciones y Permisos)

## Objetivo

Que un aprobador se entere desde el Dashboard del Portal de que tiene vacaciones
o permisos esperando su firma, sin tener que entrar en la app a comprobarlo.

Hoy el único aviso que existe es el correo del outbox en el momento del alta. Si
se lee de pasada o se entierra, la solicitud se queda quieta y nadie vuelve a
recordarlo: la app no tiene ningún recordatorio periódico. El widget es ese
recordatorio, y vive donde el aprobador ya mira todos los días.

## El terreno ya está hecho

Casi toda esta feature existe. Lo que sigue está verificado contra el código, no
supuesto:

- `GET /api/ausencias/pendientes` existe (`router.ts:129`), bajo
  `requireAuth + requireApp('ausencias')` (`router.ts:49`).
- Desde `22c2aac` devuelve **`esMiTurno` por fila**, calculado en el servidor con
  `correoDelTurno` (`service.ts:255`). La regla del turno no hay que replicarla.
- `fetchPendientes()` ya está en `apps/ausencias/src/api.ts:190` y devuelve
  `SolicitudPendiente[]`.
- `ausencias` ya está registrada en `apps/portal/src/widgets/registry.ts:23`; el
  descubrimiento del Portal es **por app, no por widget**.
- `apps/ausencias/src/widgets/WidgetSaldo.tsx` es el patrón hermano exacto:
  mismo contrato, misma app, mismos problemas ya resueltos (sesión caducada,
  enlace sin React Router, estado «sin configurar»).

Consecuencia de alcance: **un componente nuevo, una entrada más en un array, y
una línea en `App.tsx`. Cero cambios en hub-api, cero migraciones. Se despliega
solo el portal.**

## Decisiones

### Cuenta solo lo que le toca firmar

El widget cuenta únicamente las filas con `esMiTurno`. Para las nueve personas
que no son administradoras esto es indistinguible de contarlo todo —la consulta
ya les entrega solo su turno—, pero para `comercial@`, que es admin,
`solicitudesPendientes` anula el filtro por turno para poder destrabar
aprobaciones.

Contar la bandeja entera le enseñaría a un admin un 12 cuando solo puede actuar
sobre 3. Es literalmente el malentendido que `22c2aac` acaba de arreglar en la
bandeja, y reintroducirlo en la tarjeta de al lado sería tropezar dos veces.

### Filtra por `esMiTurno !== false`, no por `=== true`

Precedente literal de `BandejaAprobacion.tsx:150`. Los dos servicios se
despliegan por separado y hay una ventana en que el portal va por delante de
hub-api; en esa ventana el campo llega `undefined`.

Con `!== false`, un campo ausente degrada al comportamiento anterior —contarlas
todas— y el peor caso es un número inflado. Con `=== true` degradaría a **0**,
que es un fallo silencioso: el widget diría «nada pendiente» mientras las
solicitudes se pudren, y nadie tiene motivo para sospechar. Un número de más se
ve; un cero de menos, no.

Hoy hub-api ya manda el campo. La red es para la próxima ventana, no para esta.

### Desde cuándo lleva esperando

`createdAt` para las `pendiente`, pero **`primeraFirmaAt` para las
`pendiente_2`** (con `?? createdAt` de reserva).

A un segundo firmante no se le puede echar en cara el tiempo que tardó el
primero: hasta la primera firma, la solicitud no le estaba esperando a él. Usar
`createdAt` a secas convertiría la línea de presión en un reproche injusto, y el
primer aprobador lento haría parecer moroso al segundo.

### Días naturales, no hábiles

Una solicitud atascada durante el fin de semana está atascada igual: quien la
pidió sigue sin respuesta. Además, contar hábiles exigiría el set de festivos,
que viaja en `/ausencias/contexto` y obligaría a una segunda llamada para
afinar un dato cuyo propósito es solo transmitir urgencia.

### Frescura: al montar y al volver a la pestaña

Carga al montar, y repite la llamada cuando la pestaña recupera el foco
(`visibilitychange`) si han pasado más de 60 s desde la última.

Un dashboard se queda abierto toda la mañana, y un contador de pendientes
envejece mal: `WidgetSaldo` carga una sola vez y para un saldo eso basta, pero
un aprobador con la pestaña abierta desde las 8:00 vería un 0 falso a mediodía.
Volver al navegador tras leer el correo es exactamente el momento en que llega
una solicitud nueva, así que el foco es la señal correcta.

Se descartó `setInterval` cada 5 minutos: son ~12 llamadas/hora por pestaña
abierta, también con la pestaña en segundo plano y nadie mirando.

## Arquitectura

### Ficheros

| Fichero | Cambio |
|---|---|
| `apps/ausencias/src/widgets/WidgetPendientes.tsx` | Nuevo |
| `apps/ausencias/src/widgets/index.ts` | Una segunda entrada en el array |
| `apps/ausencias/src/App.tsx` | Lee la pestaña inicial del hash (severable) |

`registry.ts` no se toca.

### El descriptor

```ts
{
  id: 'ausencias-por-aprobar',
  appId: 'ausencias',
  name: 'Solicitudes por aprobar',
  description: 'Vacaciones y permisos que esperan tu firma.',
  defaultSize: { w: 4, h: 3 },
  component: WidgetPendientes,
}
```

`defaultSize` igual que `WidgetSaldo` para que el grid quede regular; el usuario
puede redimensionarlo. El `id` debe ser único en todo el monorepo:
`ausencias-mi-saldo` ya está tomado.

### La lógica, pura y aislada

```ts
resumirPendientes(
  solicitudes: SolicitudPendiente[],
  ahora: Date,
): { total: number; esperaDias: number | null }
```

Sin React, sin fetch, sin reloj propio (`ahora` entra por parámetro). Aplica el
filtro de turno, cuenta, y calcula los días naturales transcurridos desde la
espera más antigua según la regla de arriba. `esperaDias` es `null` cuando
`total === 0`.

Que sea pura es lo que la hace revisable de un vistazo, y lo que la dejará
trivial de cubrir el día que `apps/ausencias` tenga runner de tests.

### Estados y textos

Misma unión discriminada que `WidgetSaldo` (`cargando | error | listo`) y el
mismo `mensajeDeError`, que ya distingue el 401/403 de sesión caducada del «no se
pudo cargar» genérico: el token vive en `localStorage` y una pestaña puede llevar
horas abierta, así que mandar a alguien a recargar cuando lo que pasa es que
caducó su sesión le hace perder el tiempo.

| Caso | Qué se lee |
|---|---|
| `total > 0` | La cifra grande, `solicitud`/`solicitudes`, la línea de espera y el botón |
| `esperaDias >= 1` | «La más antigua lleva **N días** esperando» — y **«1 día»** en singular |
| `esperaDias === 0` | «La más antigua llegó hoy» |
| `total === 0` | «Nada pendiente de firmar.» en gris, sin botón: no hay a dónde ir con urgencia |
| error | El mensaje en rojo, igual que el hermano |

La concordancia de singular es requisito explícito, no pulido: `77c27c9` acaba de
arreglar un «1 días» en el aviso de saldo.

Cuidado con el gotcha de JSX: un salto de línea entre texto y etiqueta se come el
espacio (`…lleva\n<b>5 días</b>` → «lleva5 días»). Comprobarlo compilando el
fragmento, no leyéndolo.

### El enlace

```tsx
<a href="/ausencias#bandeja">Ir a firmar →</a>
```

Un `<a>` de verdad y no navegación de React Router, por la razón que ya documenta
`WidgetSaldo`: `apps/ausencias` no depende de `react-router` y arranca también
suelta en `vite dev`, sin Router, donde un `useNavigate` reventaría. Recarga la
SPA, a cambio de poder abrirse con ctrl+clic en otra pestaña.

Para que el `#bandeja` haga algo, `App.tsx:47` tiene que leer el hash al arrancar
en vez de fijar `'nueva'`:

```ts
const [tab, setTab] = useState<Pestana>(() => pestanaDelHash() ?? 'nueva');
```

`pestanaDelHash()` valida contra la lista de `Pestana` conocidas y devuelve
`null` ante cualquier otra cosa. **No hace falta ninguna comprobación de
permisos**: el efecto de `App.tsx:124` ya devuelve a la primera pestaña
disponible cuando la activa no le corresponde a ese usuario, así que un
`#bandeja` en manos de quien no aprueba se autocorrige solo. El hash no puede
abrir nada que el usuario no pudiera abrir pinchando.

Esta pieza es **severable**: sin ella el widget funciona igual con
`href="/ausencias"`, pero «Ir a firmar» aterriza en el formulario de nueva
solicitud y el aprobador tiene que buscar la pestaña — justo la fricción que el
widget viene a quitar.

## Lo que NO hace

- No lista solicitudes ni permite firmar desde el Dashboard. Firmar es un
  permiso y su sitio es la bandeja, con su adjunto y su motivo de rechazo.
- No distingue tipos (vacaciones / permiso / compensatorio).
- No intenta saber si quien lo añade es aprobador. El registro de widgets filtra
  por **app asignada en el JWT, no por rol**, así que cualquiera de los 10 puede
  añadirlo del catálogo y quien no apruebe a nadie verá siempre el estado vacío.
  Distinguir «no eres aprobador» de «aprobador al día» costaría una segunda
  llamada a `/contexto` para un caso que se resuelve quitando el widget.
- No toca las incapacidades: nunca pasan por `cadenaDeDecision`, solo generan el
  evento `registrada`, y por tanto no aparecen en `pendientes`.

## Alternativas descartadas

**Endpoint nuevo `/ausencias/pendientes/resumen`** que devuelva
`{ total, esperandoDesde }`. Payload mínimo y cálculo donde vive la regla, pero
es tocar hub-api: redespliegue del backend, red de compatibilidad para la ventana
entre servicios y tests nuevos. Coste alto para ahorrar unos kilobytes que con 10
fichas no duelen. Si la plantilla creciera un orden de magnitud, el cambio es un
reemplazo local dentro del widget.

**Colgar el contador de `/ausencias/contexto`**, que ya viaja con el saldo.
También toca hub-api, engorda un endpoint que ya hace de todo, y el widget
tendría que llamarlo igualmente: no ahorra ninguna petición.

## Portones

Los tres de siempre. El que ejerce sobre esto es
`npm run build --workspace=apps/portal`, que compila `apps/ausencias` porque el
portal la importa por código fuente.

## Riesgos y deuda conocida

- **`resumirPendientes` nace sin test automático.** `apps/ausencias` no tiene
  runner. Montar Vitest en esa app es arrastrar aquí la deuda ya anotada del
  portón de typecheck, así que queda fuera de este cambio a propósito. Se mitiga
  escribiendo la función pura y sin dependencias para que sea trivial de cubrir
  después. Aceptado explícitamente por el usuario.
- El widget se añade a mano desde el catálogo: nadie lo verá hasta que lo
  coloque. No hay mecanismo de widget por defecto y no se inventa uno aquí.

## Criterios de aceptación

1. Un aprobador con solicitudes en su turno ve la cifra correcta y la línea de
   espera, y «Ir a firmar» le deja en la pestaña **Pendientes de aprobar**.
2. `comercial@` (admin) ve **solo su turno**, no la bandeja entera.
3. Un empleado sin nada que firmar ve «Nada pendiente de firmar.» y ningún botón.
4. Con una sola solicitud se lee «1 solicitud»; con un día de espera, «1 día».
5. Volver a la pestaña tras más de 60 s refresca la cifra; antes de 60 s, no.
6. Con la sesión caducada se lee el mensaje de sesión, no «no se pudo cargar».
7. `npm run build --workspace=apps/portal` pasa.
