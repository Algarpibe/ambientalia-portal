# Diseño — Saldo de vacaciones (app Vacaciones y Permisos)

## Objetivo

Que cada empleado y quien aprueba vean, dentro de la app, cuántos días de
vacaciones quedan. Es la última pieza que falta para poder desenchufar la hoja
`consulta_vacaciones`: hoy el saldo solo existe en la hoja `Total` del Excel.

## La fórmula

La que usa el Excel y confirmó el usuario:

```
días trabajados  = hoy − fecha de ingreso
meses trabajados = días trabajados / 30
devengadas       = meses trabajados × 15 / 12     (= meses × 1,25)
pendientes       = devengadas − disfrutadas
```

No se implementa así de literal. Como el devengo es proporcional al tiempo y a
la MISMA tasa para todos —1,25 días por mes, sin tramos por antigüedad— partir
del saldo actual permite quitar la fecha de ingreso de la ecuación:

```
saldo(hoy) = saldo_corte
           + (días desde el corte / 30) × 1,25    ← devengado desde el corte
           − vacaciones disfrutadas desde el corte
```

Es algebraicamente idéntica a recalcular desde el ingreso, y evita tener que
recopilar quince fechas de contratación y parsear las nueve hojas-calendario
2018-2026 (matrices de 369 columnas) donde viven las vacaciones disfrutadas
históricas.

### Dos avisos sobre esta fórmula

- Dividir por 30 en vez de por 30,44 hace que el año devengue **15,2 días, no
  15** (365/30 × 1,25 = 15,21). Se mantiene a propósito: es lo que dice el
  Excel, y corregirlo descuadraría contra el consolidado.
- El servidor corre en UTC y Colombia es UTC−5. «Hoy» se calcula restando 5
  horas antes de tomar el `YYYY-MM-DD`; sin eso, cada tarde a partir de las
  19:00 hora local el saldo se adelantaría un día.

## La fecha de corte

Es el dato delicado de todo esto, porque define la frontera del doble conteo.
El saldo del consolidado ya lleva descontadas las vacaciones disfrutadas hasta
esa fecha, incluidas las que están entre las 25 filas de vacaciones que ya se
importaron a `portal.solicitudes_ausencia`.

**Regla acordada: se descuenta toda solicitud de vacaciones cuya `fecha_inicio`
sea igual o posterior a `fecha_corte`, venga del portal o de la hoja.**

Se decidió por fecha y no por `origen` porque el histórico contiene filas con
fecha futura respecto al corte, y el consolidado no las tiene descontadas. Un
filtro por `origen = 'portal'` las dejaría fuera y el saldo saldría alto.

Consecuencia operativa: `fecha_corte` NO es necesariamente hoy. Es la última
fecha en la que el consolidado estaba cuadrado. Si el consolidado no incluye
las vacaciones ya aprobadas para las próximas semanas, hay que retrasar el
corte hasta donde sí lo estaba.

### Qué cuenta como disfrutado

- `tipo = 'vacaciones'` únicamente. Permisos, compensatorios e incapacidades no
  tocan el saldo.
- `estado = 'aprobada'`. Las `rechazada` no descuentan. `registrada` es el
  estado terminal solo de incapacidades, así que nunca aparece aquí.
- Las `pendiente` se muestran aparte como «en trámite», no se restan del saldo
  firme (ver más abajo).
- Una solicitud a caballo del corte —empieza antes, acaba después— se decide
  por su fecha de inicio: no descuenta. Es un caso raro y cualquier regla más
  fina sería difícil de explicar a quien mira el número.

## Datos nuevos — migración 017

Dos columnas en `portal.empleados`, no una tabla aparte: es un atributo del
empleado, hay uno solo por persona y no necesita historial.

```sql
saldo_corte  NUMERIC(5,1)   -- días disponibles en la fecha de corte
fecha_corte  DATE           -- frontera: desde aquí se devenga y se descuenta

CONSTRAINT empleados_saldo_completo
  CHECK ((saldo_corte IS NULL) = (fecha_corte IS NULL))
```

El `CHECK` impide el fallo más probable de todos: un empleado a medio
configurar mostrando un saldo inventado. Ambas nulas = «sin configurar», y la
app lo dice con esas palabras en vez de enseñar un 0. Importa porque la ficha
de empleado se crea sola al entrar en la app (`repo.asegurarEmpleado`), así que
«sin configurar» es el estado por defecto de todo el que se dé de alta.

`NUMERIC(5,1)` admite medio día, igual que `dias_habiles`. Recordar el gotcha:
**pg devuelve NUMERIC como string**, así que el SELECT lleva `::float8`.

Solo DDL e idempotente, y hay que añadirla a mano al array `MIGRATIONS` de
`apps/hub-api/src/db.ts`.

## Cálculo — `apps/hub-api/src/ausencias/saldo.ts`

Módulo puro, sin `Pool`, testeable sin BD. Recibe la configuración del empleado
y sus solicitudes ya cargadas; devuelve:

```ts
export interface SaldoVacaciones {
  configurado: boolean;   // false si falta saldo_corte/fecha_corte
  saldoCorte: number;
  fechaCorte: string;     // YYYY-MM-DD
  devengadas: number;     // desde el corte hasta hoy
  disfrutadas: number;    // aprobadas, vacaciones, inicio >= corte
  enTramite: number;      // pendientes, vacaciones, inicio >= corte
  disponible: number;     // saldoCorte + devengadas - disfrutadas
}
```

`disponible` no resta lo que está en trámite —es el saldo firme, el que la
empresa reconoce— pero el aviso del formulario compara contra
`disponible − enTramite`. Así nadie agota el saldo enviando tres solicitudes
seguidas antes de que se apruebe la primera.

Toda la aritmética de fechas va sobre cadenas `YYYY-MM-DD` en UTC. Nunca
`new Date(str)` con métodos locales.

Los números se calculan con precisión completa y se redondean a un decimal solo
al mostrarlos.

## Superficie

### Fase 1 — Backend (hub-api)

| Endpoint | Qué hace |
|---|---|
| `GET /ausencias/contexto` | Añade `saldo` del solicitante al payload que ya devuelve. El formulario y «Mis solicitudes» lo tienen sin llamada extra |
| `GET /ausencias/saldos` | Saldos de varias personas. Sirve a la bandeja y al panel de admin. `requireAuth` + aprobador o admin |
| `PUT /ausencias/empleados/:id/saldo` | Fija `saldo_corte` y `fecha_corte`. `requireAuth` + `requireAdmin` |

`GET /ausencias/saldos` está acotado por quién pregunta: un admin recibe todos
los empleados; un aprobador que no es admin recibe solo los suyos —los que
tienen su correo en `aprobador_correo`—. El saldo de vacaciones es un dato
personal y no hay motivo para que un aprobador vea el de gente que no aprueba.
Misma regla que ya aplica `repo.solicitudesPendientes`.

`PUT` valida a mano (no hay zod): saldo numérico y ≥ 0, fecha `YYYY-MM-DD`
válida, y las dos presentes o las dos nulas —espejo del `CHECK`, para dar un
error de dominio legible en vez de un fallo de constraint de Postgres.

No toca el outbox: fijar un saldo no notifica a nadie. Es la misma regla que la
edición del registro general —corregir el registro no manda correos.

### Fase 2 — Formulario y «Mis solicitudes»

- Tarjeta con el saldo al elegir tipo «vacaciones»: disponible, devengado desde
  el corte, y en trámite si lo hay.
- Aviso en rojo si los días del rango superan `disponible − enTramite`, **pero
  deja enviar**. La decisión es humana: adelantar vacaciones es legítimo, y un
  saldo inicial mal tecleado no debe dejar a nadie sin poder pedir.
- Si `configurado` es false, la tarjeta dice «saldo sin configurar» y no
  inventa ningún número.

### Fase 3 — Bandeja de aprobación

El saldo del solicitante junto a cada solicitud de vacaciones pendiente, que es
donde se toma la decisión. Marcado en rojo si esa solicitud deja el saldo en
negativo, para que quien aprueba lo vea antes de pulsar.

### Fase 4 — Pestaña «Saldos» (solo admin)

Tabla con una fila por empleado: nombre, saldo de corte, fecha de corte, y el
saldo calculado a hoy. Editable en línea. Es la vía por la que entran los
quince números del consolidado, y la que permite dar de alta a quien entre
nuevo —su corte es su fecha de ingreso con saldo 0— o corregir un número mal
puesto sin pasar por psql. Mismo argumento que justificó el borrado y la
edición del registro general.

## Errores y estados

- Empleado sin configurar: la app lo dice explícitamente. Nunca un 0.
- La pestaña «Saldos» avisa de cuántos empleados quedan sin configurar, para
  que no se olvide ninguno tras la carga inicial.
- Endpoints: estados loading / error / vacío como en el resto de la app.

## Testing

- `saldo.ts`: la mayor parte del esfuerzo, por ser puro.
  - La fórmula contra casos calculados a mano.
  - La frontera del corte: una solicitud el día del corte descuenta, la del día
    anterior no.
  - Una solicitud a caballo del corte no descuenta.
  - Rechazadas no descuentan; pendientes van a `enTramite`, no a `disfrutadas`.
  - Permisos, compensatorios e incapacidades no tocan el saldo.
  - Empleado sin configurar devuelve `configurado: false` sin reventar.
  - El devengo en UTC−5: a las 20:00 hora de Colombia el saldo es el del mismo
    día, no el del siguiente.
- Endpoints: `PUT` rechaza saldo negativo, fecha inválida y configuración a
  medias; `GET /saldos` rechaza a quien no es aprobador ni admin, y a un
  aprobador no-admin le devuelve solo los suyos.

## Notas de despliegue

Toca **hub-api y portal**, que son servicios separados en EasyPanel. La
migración 017 se aplica sola al arrancar hub-api.

Antes de subir, los tres portones:

```
npm run build --workspace=apps/hub-api
npm run test  --workspace=apps/hub-api
npm run build --workspace=apps/portal
```

El primero es el que corre el Dockerfile; Vitest transpila con esbuild y NO
comprueba tipos.

## Pendiente de datos

Los saldos del consolidado —nombre, días y **a qué fecha son válidos**— siguen
sin entregarse. No bloquean la implementación: se teclean en la pestaña
«Saldos» una vez desplegada. Hasta entonces todo el mundo aparece como «sin
configurar», que es el comportamiento correcto.
