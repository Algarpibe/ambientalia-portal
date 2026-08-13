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

Las pendientes se pintan atenuadas (opacidad reducida) y con un anillo alrededor
porque el valor está en verlas *antes* de decidir: quien aprueba abre el
calendario, ve que esa semana ya hay dos personas fuera, y decide con eso
delante.

### El filtro tiene que ser de solapamiento, no de contención

```sql
WHERE estado <> 'rechazada'
  AND fecha_inicio <= $hasta
  AND fecha_fin    >= $desde
```

Lo natural sería escribir `fecha_inicio >= $desde AND fecha_fin <= $hasta`, y eso
perdería exactamente las ausencias que cruzan el cambio de mes — que son las que
más importa ver, porque son las que un mes solo enseña a medias. Va con test.

## Las incapacidades se ven como cualquier otro tipo

**Esta sección describía un enmascarado que no funcionaba. Se retiró.**

El diseño original ocultaba el tipo de las incapacidades ajenas mandando
`tipo: null`, invocando la Ley 1581. La revisión demostró que no ocultaba nada,
por dos vías independientes:

1. `tipo: null` se producía **exclusivamente** en incapacidades ajenas. Era un
   centinela: una celda enmascarada significaba «esto es una incapacidad» con
   certeza, que es justo lo que pretendía tapar.
2. `estado: 'registrada'` equivale a incapacidad por construcción, porque es el
   único tipo que nace en ese estado (`requiereAprobacion` en `service.ts`). El
   hecho médico viajaba igual en el segundo campo.

Un tercero recibía `{"tipo":null,"estado":"registrada"}`: dos señales, cada una
suficiente. El spec afirmaba «la regla es no mandarla, no ocultarla al pintar» y
la mandaba de todas formas.

Decisión: **mostrarlas como cualquier otro tipo.** Razones:

- El dato ya es público por el otro lado: el evento que n8n crea en Google se
  llama literalmente `«Incapacidades Andrés García»`, y ese calendario no se
  toca.
- Un control que parece privacidad y no lo es genera confianza falsa, que es
  peor que no tener ninguno. Quien decida sobre este dato debe saber que se ve.
- Ocultar de verdad exigía no mandar la marca, y entonces el calendario mentiría
  sobre la disponibilidad de esa persona — perdiendo el valor de coordinación
  que justifica toda la vista.

En consecuencia, `MarcaCalendario.tipo` NO es nullable, y ni el módulo ni el
repo necesitan los correos del empleado ni de su aprobador.

## Frontend

`apps/ausencias/src/Calendario.tsx`, más una pestaña en `App.tsx` visible para
**todos** los que tengan ficha de empleado — a diferencia de «Saldos» y
«Registro general», que son de admin.

- Rejilla: una fila por persona, una columna por día del mes.
- Navegación ◀ ▶ entre meses, arrancando en el mes en curso.
- Filtros: persona (incluido un «solo yo» para el uso personal) y tipo.
- Columnas no laborables sombreadas, con el dato que manda el servidor.
- Leyenda de colores por tipo, y el estilo atenuado con anillo para pendientes.
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
- Una enteramente posterior al mes, además de la anterior.
- Las `rechazada` no producen ninguna marca — y con la rechazada **en medio** de
  una lista de tres, para que las siguientes se sigan pintando. Sin ese caso, el
  mutante `continue` → `break` sobrevive, y borraría del calendario a todos los
  empleados posteriores a la primera rechazada, en silencio.
- Las incapacidades salen con su tipo, como cualquier otra.
- `laborable`: un sábado, un festivo fijo y **uno trasladado por la Ley
  Emiliani** — el fijo solo es el caso fácil.

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
