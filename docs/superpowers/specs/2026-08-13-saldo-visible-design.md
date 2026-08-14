# Diseño — El saldo de vacaciones, siempre a la vista (app Vacaciones y Permisos)

## Objetivo

Que cualquier empleado sepa **cuántos días de vacaciones le quedan hoy** sin
tener que buscarlo, en dos sitios:

1. En la **cabecera** de la app «Vacaciones y Permisos», visible desde cualquier
   pestaña.
2. En un **widget del dashboard** del portal, que se añade desde «Editar panel»
   como los de rentabilidad.

## Qué ya existe, y por qué no basta

El dato ya está calculado y ya se muestra. `calcularSaldo` (`saldo.ts`) devuelve
el saldo **a día de hoy** —el devengo se cuenta contra `hoyEnColombia()`, con el
desfase UTC−5 aplicado antes de tomar la fecha— y viaja dentro de
`GET /ausencias/contexto`. `TarjetaSaldo.tsx` lo pinta en tres sitios: el
formulario, «Mis solicitudes» y la bandeja de aprobación.

El problema no es el dato, es dónde está:

- En «Nueva solicitud» y «Mis solicitudes» aparece en un recuadro pequeño, y
  **solo** en esas dos pestañas. Quien entra a mirar el calendario o su historial
  no lo ve.
- La pestaña **«Saldos» es de administrador**: es el panel para *fijar* los
  saldos de corte de toda la plantilla, no para consultar el propio. Un empleado
  normal no la tiene, así que «míralo en la pestaña de saldos» no es una
  respuesta válida para la mayoría de la plantilla.
- Desde el dashboard del portal no hay ninguna forma de verlo.

## El número

El grande es **`disponible`**: `saldoCorte + devengadas − disfrutadas`. Y cuando
`enTramite > 0`, debajo aparece una línea de aviso —«N pendientes de aprobar»—
que **desaparece** cuando no hay nada en trámite.

Es deliberado no poner en grande el *pedible* (`disponible − enTramite`), que es
lo que realmente se puede pedir sin pasarse:

- `disponible` es el número que ve un administrador en el panel de Saldos y el
  que cuadra con el desglose de la tarjeta. Si la cabecera enseñara el pedible,
  habría **dos cifras distintas para «mi saldo»** según dónde se mire, sin que
  nada explique la diferencia.
- Pero ocultar el trámite reproduce un fallo ya reportado: pedir 10 días, luego
  otros 10, y que la cifra siga diciendo que quedan 12. De ahí la línea de aviso.

Un solo número oficial, y el trámite como matiz.

### `IndicadorSaldo.tsx`

La regla de arriba se va a mostrar en dos superficies distintas. Vive **una sola
vez**, en un componente nuevo en `apps/ausencias/src/IndicadorSaldo.tsx`:

```ts
interface Props {
  saldo: SaldoVacaciones;
  variante: 'cabecera' | 'widget';
}
```

Puro de presentación: recibe el saldo, no consulta nada. Si cada superficie
escribiera la regla por su cuenta, la primera vez que alguien tocara una se
separarían, y el síntoma sería que el dashboard y la app dicen números distintos
sobre la misma persona.

`TarjetaSaldo.tsx` **no se toca ni se fusiona con este**. Sigue sirviendo al
formulario —donde se pone en rojo y avisa de que los días que se están
escribiendo no caben— y a la bandeja, donde muestra el saldo de **otra** persona
vía la prop `titulo`. Son responsabilidades distintas.

## Superficie 1: la cabecera de la app

En `apps/ausencias/src/App.tsx`:

- El `<header>` pasa a repartir título e indicador (`justify-between`, con el
  indicador replegándose debajo en pantallas estrechas).
- Se elimina el bloque `{contexto.saldo && <TarjetaSaldo …/>}` de la pestaña
  «Mis solicitudes»: con el saldo fijo arriba, esa tarjeta repite el mismo
  número a un centímetro de distancia.

**Si `contexto.saldo` es `null` o `configurado` es `false`, la cabecera no
muestra nada.** Ni el número ni un cartel de aviso: ese cartel sería permanente y
aparecería en todas las pestañas, todo el rato, para las personas a las que
todavía les falta el saldo inicial. El aviso de «sin configurar» ya lo da
`TarjetaSaldo` en «Nueva solicitud», que es donde importa. Los dos casos se
tratan igual a propósito: `null` significa «no hay ficha, o el cálculo falló», y
ninguna de las dos cosas se arregla poniendo un número en la cabecera.

### Frescura

`contexto.saldo` se carga al arrancar la app. `onCreada` ya lo refresca; con el
indicador en cabecera ese refresco pasa a ser visible desde cualquier pestaña.

`onDecidida` refresca hoy `saldos` (los de la bandeja) pero **no**
`contexto.saldo`. Se añade. Hoy el hueco no se nota porque nadie aprueba lo suyo,
pero un admin sí puede: aprobaría sus propias vacaciones y su cabecera seguiría
enseñando el número de antes hasta recargar la página. Se sigue el mismo patrón
que `onCreada`: no se espera la llamada ni se propaga su error, porque la
decisión ya está tomada y esto solo mejora la frescura.

## El endpoint

```
GET /ausencias/mi-saldo   →   { saldo: SaldoVacaciones | null }
```

Mismo gating que el resto del router (`requireAuth` + `requireApp('ausencias')`).
Reusa `repo.asegurarEmpleado` + `service.saldoDeSesion`, ya existentes. `null`
cuando el usuario no tiene ficha de empleado: la misma forma que ya viaja dentro
de `/ausencias/contexto`, para que el espejo de tipos del frontend sea el mismo.

**Si el cálculo lanza, responde 500**, no un saldo en blanco. Es lo contrario de
lo que hace `/ausencias/contexto`, y a propósito: allí el saldo es un accesorio
de un payload que la app necesita para arrancar, así que degradarlo a `null`
permite abrir la app; aquí el saldo **es** la respuesta, y camuflar el fallo
sería mentir por omisión. Es el mismo criterio ya documentado en
`/ausencias/saldos`.

Mantiene el `asegurarEmpleado` que hace el contexto, aunque sea un UPSERT en un
GET. Cuesta una escritura idempotente y garantiza que el widget y la app nunca
digan cosas distintas de la misma persona. Sin él, alguien recién dado de alta
vería «sin configurar» en el widget hasta la primera vez que abriera la app — y
ese mensaje le mandaría a administración cuando no hay nada que arreglar.

## Superficie 2: el widget del dashboard

`apps/ausencias/src/widgets/WidgetSaldo.tsx` y `apps/ausencias/src/widgets/index.ts`:

```ts
{
  id: 'ausencias-mi-saldo',
  appId: 'ausencias',
  name: 'Mi saldo de vacaciones',
  description: 'Días de vacaciones disponibles a día de hoy.',
  defaultSize: { w: 4, h: 3 },
  component: WidgetSaldo,
}
```

El tamaño **no** es `3×2`, que fue el primer valor propuesto y no cabe: la celda
deja 117 px de contenido y el widget mide 120 px en cuanto hay algo en trámite —
justo la gente para la que existe la línea de aviso—. `4×3` es además el mínimo
que usan los widgets ya desplegados, y esos apilan valores a `text-lg`, no a
`text-4xl`. Corregirlo tarde no habría bastado: `addWidget` copia `defaultSize`
al `localStorage` de cada usuario, así que el descriptor solo manda hasta que
alguien añade el widget.

Más una línea en `apps/portal/src/widgets/registry.ts`, y actualizar el
comentario de ese archivo que enumera las apps sin widgets.

**No hace falta lógica de permisos nueva.** `useWidgetRegistry` solo carga los
widgets de las apps asignadas al usuario (claim `apps` del JWT). Quien no tenga
la app no ve el widget en el catálogo.

Y quien lo tuviera guardado de antes en su layout y **perdiera** el acceso
tampoco llega a pedir nada: el módulo no se carga, así que el id no entra en
`availableIds` y `visibleItems` filtra la entrada antes de renderizar. La
petición nunca sale, y por tanto no hay ningún 403 que gestionar. El layout **no
se poda** de `localStorage` —solo se oculta—, decisión deliberada y documentada
en `useDashboardLayout.ts` para no repetir una pérdida de datos anterior; el
widget no debe intentar autoeliminarse. Además `requireApp` lee el claim `apps`
del mismo JWT que lee `useAuth`, así que frontend y backend no pueden discrepar.

Hay una asimetría heredada que conviene conocer antes de dar el widget por roto:
`requireApp` deja pasar a **cualquier admin** aunque no tenga la app en su lista
(`user?.role === 'admin' || user?.apps?.includes(appId)`), pero
`useWidgetRegistry` filtra solo por `apps`, sin mirar el rol. Un admin que no
tenga `ausencias` asignada **no verá el widget en el catálogo**, aunque el
backend le respondería sin problema. No es un fallo de esta feature —afecta igual
a los widgets que ya existen— y no se corrige aquí: tocar ese filtro cambiaría el
dashboard de todas las apps. Se deja anotado porque el síntoma («soy admin y no
me aparece») es difícil de atribuir.

Estados del widget:

| Estado | Qué muestra |
|---|---|
| Cargando | «Cargando…» |
| Error de red o 4xx/5xx | «No se pudo cargar tu saldo.» |
| `saldo === null` o `!configurado` | «Todavía sin configurar. Habla con administración.» |
| Saldo | `IndicadorSaldo variante="widget"` + enlace «Pedir vacaciones →» |

Nunca un **0,0** en grande para el caso sin configurar: un cero se lee como «no
me quedan días», que no es lo mismo que «nadie ha fijado tu punto de partida». Es
un caso real y no marginal — todavía faltan saldos iniciales de unas diez
personas.

El enlace es un `<a href="/ausencias">` normal, no navegación de React Router.
`apps/ausencias` no depende de `react-router` y no merece esa dependencia solo
para esto; además la app arranca también suelta en `vite dev`, donde no hay
Router y un `useNavigate` reventaría. El coste es que recarga la SPA. A cambio,
un enlace de verdad se puede abrir con ctrl+clic en otra pestaña.

No hace falta ningún parámetro para caer en el formulario: `App.tsx` arranca con
`useState<Pestana>('nueva')`, así que `/ausencias` ya abre en «Nueva solicitud»
para quien tenga ficha de empleado.

## Alcance: lo que no entra

- **No** se crea una pestaña «Mi saldo». Se valoró y se descartó: la cabecera
  cubre la pregunta «cuántos días tengo» sin añadir navegación. Si con el uso se
  ve que la cabecera se queda corta, la pestaña sigue siendo la salida natural.
- **No** se abre la pestaña «Saldos» al resto de la plantilla. Es un panel de
  administración —edita saldos de corte—, no un visor.
- **No** se toca el cálculo del saldo. Los saldos iniciales pendientes y el caso
  de Marcela Noreña (posible doble descuento de una vacación aprobada que el
  Excel ya traía descontada) son un trabajo aparte, de datos, no de esta feature.
- **No** se añaden tests al portal. Sus 11 fallos por jsdom son deuda
  preexistente y arreglarlos es otro trabajo.

## Pruebas

Los tests van donde los hay: **hub-api** (Vitest + supertest), sobre el endpoint
nuevo:

- 200 con el saldo de quien pide.
- 200 con `saldo: null` cuando no hay ficha de empleado.
- 401 sin token.
- 403 sin la app `ausencias` asignada.
- 500 cuando el cálculo lanza — el caso que distingue este endpoint del contexto,
  y que sin test se puede «arreglar» sin querer copiando el `catch` del contexto.

`apps/ausencias` no tiene tests y esta feature no los introduce. La cobertura que
sí existe es de tipos: el portal importa las sub-apps por código fuente
(`lazyConReintento(() => import('../../ausencias/src/App'))`) y su build es
`tsc -b` con `strict: true`, así que el portón `npm run build --workspace=apps/portal`
comprueba también estos archivos. El widget entra en ese grafo en cuanto se
registra en `WIDGET_FACTORIES`.

## Puesta en marcha

Sin migraciones: nada de esto es irreversible y no hay que tocar la base.

**Orden de despliegue: hub-api primero, portal después.** El widget del portal
llama a un endpoint que hoy no existe; al revés, quien tuviera el widget puesto
vería un error hasta que hub-api se pusiera al día. Es el mismo caso que
`/ausencias/decididas`.

Va después del despliegue ya pendiente (migraciones 019 y 020), en rama aparte.

## Alternativas descartadas

- **El pedible como número grande.** Nunca engaña sobre lo que se puede pedir,
  pero no cuadra con el panel de Saldos ni con el desglose: dos verdades para la
  misma persona.
- **Quitar también la tarjeta del formulario**, con el desglose en un
  desplegable de la cabecera. Esconde el aviso de exceso justo cuando hace falta
  —mientras se escriben las fechas— y añade un estado nuevo que mantener.
- **Reusar `GET /ausencias/contexto` para el widget.** Cero backend nuevo, pero
  la home del portal pasaría a arrastrar en cada carga el contexto completo de
  una app que quizá no se va a abrir: los festivos de tres años, el nombre del
  aprobador y las consultas de si eres aprobador y visor de adjuntos.
- **Que el widget lea el saldo sin `asegurarEmpleado`.** Ahorra el UPSERT, pero
  deja a quien se acaba de dar de alta con un «sin configurar» que le manda a
  administración sin motivo.
