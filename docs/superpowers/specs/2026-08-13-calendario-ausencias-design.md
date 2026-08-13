# Diseño — Calendario de ausencias (app Vacaciones y Permisos)

## Objetivo

Una pestaña «Calendario» donde se vea, de un vistazo, quién está fuera y cuándo:
vacaciones, compensatorios, permisos e incapacidades de toda la plantilla. La
pregunta que tiene que contestar sin que nadie eche cuentas es «¿puedo contar
con esta persona la semana que viene, y hay ya alguien más de su equipo fuera?».

## Relación con el Google Calendar que ya existe

El flujo de n8n publica cada ausencia aprobada en el calendario «Ambientalia
Staff» (`aprobada` → calendario, `registrada` → calendario, ver
`notificaciones.ts`). **Ese comportamiento no se toca.** El calendario del
portal es una vista adicional para quien no tenga ese calendario compartido, o
para quien ya está en el portal y no quiere salir a Google.

Consecuencia asumida: la misma información vive en dos sitios. No se
sincronizan, y una edición manual en Google no se refleja aquí — el portal
siempre enseña lo que dice la base de datos, que es la fuente de verdad.

## Datos

**No hace falta migración ni tabla nueva.** Todo sale de
`portal.solicitudes_ausencia`, que ya tiene tipo, fechas y estado, y de
`portal.empleados`.

## Dónde vive la aritmética de fechas

Expandir «del 5 al 7 de agosto» a celdas concretas es justo el cálculo que se
llena de errores de un día, y esta app ya lleva dos incidentes de esa familia:
el `+1` del fin exclusivo de Google Calendar, y el UTC−5 del saldo.

Por eso **el endpoint devuelve las marcas ya expandidas por día**, no los
rangos. El frontend solo pinta. Así toda la aritmética queda en hub-api, que es
donde hay tests de verdad —los del portal fallan por un desajuste de `jsdom`
anterior a este trabajo— y donde ya vive `festivosColombia(anio)`.

## Endpoint

```
GET /ausencias/calendario?mes=YYYY-MM
```

Bajo `...gated` (`requireAuth` + `requireApp`): lo ve cualquiera que tenga la
app asignada, no solo administración. Es la decisión de producto: un calendario
de plantilla que solo ve el jefe no sirve para coordinarse.

El parámetro es un mes, no un rango libre: el servidor deriva `desde` = día 1 y
`hasta` = último día de ese mes. Acotarlo así evita que una petición pida cinco
años de golpe, y la interfaz solo navega mes a mes.

```ts
{
  empleados: [{ id, nombreCompleto }],              // activos, ordenados por nombre
  dias: [{ fecha: '2026-08-01', laborable: false }, …],
  marcas: [{ empleadoId, fecha, tipo, estado }, …]  // una entrada por día ausente
}
```

`marcas` va plano y no anidado por empleado: el frontend construye un `Map` con
clave `empleadoId|fecha` y cada celda hace una consulta directa. En el peor caso
son 15 personas × 31 días = 465 entradas; lo normal son unas 50.

`dias` incluye `laborable` para que el frontend no tenga que repetir el cálculo
de festivos ni el de fin de semana: los sombrea con lo que le llega.

Salen **todos** los empleados activos, también los que no tienen ninguna
ausencia ese mes. Una fila vacía es información: dice que esa persona está
disponible.

Hace falta una función de repo nueva para eso. `listarEmpleados` no vale: no
filtra por `activo`, así que arrastraría las fichas dadas de baja — que es justo
lo que se acaba de hacer con quien no es empleado directo.

### Estados

Entran `aprobada`, `registrada` y `pendiente`. Las `rechazada` no salen nunca.

Las pendientes se pintan con un estilo distinto (borde rayado) porque el valor
está en verlas *antes* de decidir: quien aprueba abre el calendario, ve que esa
semana ya hay dos personas fuera, y decide con eso delante.

### El filtro tiene que ser de solapamiento, no de contención

```sql
WHERE estado <> 'rechazada'
  AND fecha_inicio <= $hasta
  AND fecha_fin    >= $desde
```

Lo natural sería escribir `fecha_inicio >= $desde AND fecha_fin <= $hasta`, y eso
perdería exactamente las ausencias que cruzan el cambio de mes — que son las que
más importa ver, porque son las que un mes solo enseña a medias. Va con test.

## Privacidad de las incapacidades

`tipo` viaja como `null` cuando la marca es una **incapacidad de otra persona**.
El interesado, su aprobador y un admin sí reciben el tipo; para el resto la
celda dice «Ausente», sin motivo.

**El enmascarado se hace en el servidor.** Hacerlo en la interfaz significaría
haber enviado igualmente el dato al navegador, y un dato de salud enviado es un
dato expuesto. En Colombia la Ley 1581 trata la información de salud como
sensible, así que la regla es no mandarla, no ocultarla al pintar.

El nombre de la persona sí se ve: se revela que está ausente, no por qué.

**Cuidado con de dónde sale «su aprobador».** Tiene que ser
`empleados.aprobador_correo`, NO `solicitudes_ausencia.aprobador_correo`. La
segunda está a `null` en todas las incapacidades a propósito —una incapacidad se
informa, no se aprueba, y dejar ahí un aprobador la haría aparecer en su bandeja
de pendientes (ver el comentario de `crearSolicitud`)—. Usar ese campo dejaría a
todos los aprobadores fuera y la regla se reduciría en silencio a «solo el
interesado y el admin». Va con test.

### Incoherencia conocida con Google Calendar

El evento que n8n crea se llama `«Incapacidades Andrés García»`, así que ahí el
motivo está a la vista de quien tenga ese calendario compartido. Enmascarar en
el portal no oculta ese dato; evita **ensanchar** la exposición a toda la
plantilla, que es un objetivo distinto y que se sostiene por sí solo.

Alinearlos es cambiar el `resumen` del payload en `notificaciones.ts` —una
línea— pero solo afectaría a los eventos nuevos, no a los ya creados. Queda
fuera de este trabajo, anotado por si se decide después.

## Frontend

`apps/ausencias/src/Calendario.tsx`, más una pestaña en `App.tsx` visible para
**todos** los que tengan ficha de empleado — a diferencia de «Saldos» y
«Registro general», que son de admin.

- Rejilla: una fila por persona, una columna por día del mes.
- Navegación ◀ ▶ entre meses, arrancando en el mes en curso.
- Filtros: persona (incluido un «solo yo» para el uso personal) y tipo.
- Columnas no laborables sombreadas, con el dato que manda el servidor.
- Leyenda de colores por tipo, y el estilo rayado para pendientes.
- Hasta 31 columnas: va en `overflow-x-auto` con la columna del nombre fija,
  siguiendo el patrón de tabla de `RegistroGeneral` y `PanelSaldos`.

El «solo yo» cubre el caso de que cada uno vea su propio calendario sin
necesidad de una segunda pantalla: un componente, un endpoint, cero duplicación.

## Errores y estados

- Cargando y error como en el resto de la app.
- Un mes sin ninguna ausencia enseña la rejilla con todas las filas vacías, no
  un estado vacío: saber que no hay nadie fuera es una respuesta útil.
- Sin ficha de empleado no hay pestaña, igual que con las demás.

## Testing (hub-api)

El grueso, sobre la función pura de expansión:

- Una ausencia enteramente dentro del mes.
- Una que empieza el mes anterior y acaba dentro: solo se marcan los días de
  este mes.
- Una que empieza dentro y acaba el mes siguiente.
- Una que cubre el mes entero por los dos lados.
- Una que ocupa exactamente el primer día, y otra el último.
- Las `rechazada` no producen ninguna marca.
- El enmascarado en sus cuatro combinaciones: el propio interesado, su
  aprobador, un admin, y un tercero.
- `laborable`: un festivo de Colombia y un sábado salen en `false`.

Endpoint: rechaza un `mes` mal formado con 400, y responde 403 a quien no tiene
la app asignada.

Frontend: mínimo, como en el resto de la app. La lógica pesada vive en el
endpoint a propósito.

## Notas de despliegue

Toca **hub-api y portal**, que son servicios separados en EasyPanel y hay que
desplegar los dos — el fallo que ya se dio al desplegar el saldo. No hay
migración, así que no hay nada que aplicar en la base de datos.

Antes de subir, los tres portones:

```
npm run build --workspace=apps/hub-api
npm run test  --workspace=apps/hub-api
npm run build --workspace=apps/portal
```
