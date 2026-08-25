# Hora opcional en los permisos

Fecha: 2026-08-25
Estado: diseño aprobado, pendiente de plan de implementación

## El problema

Un permiso se pide hoy por días enteros, como unas vacaciones. Pero un permiso
casi nunca es un día entero: es «me voy dos horas al médico el martes por la
mañana». La app no tiene dónde guardar esa hora, así que la persona la escribe
en Comentarios —cuando se acuerda— y el jefe la lee ahí, si la lee.

La consecuencia visible está en el Google Calendar del equipo: el permiso de dos
horas se pinta como un evento de **día completo**, indistinguible de unas
vacaciones. Quien mira el calendario para saber con quién cuenta esa mañana no
puede saberlo, y quien firma tampoco: el correo de aprobación dice la fecha y
nada más.

## Para qué se hace

**Para que la hora sea un dato y no una nota al pie.** Que viaje con la
solicitud, que la vea quien firma en el correo, y que en el calendario ocupe la
franja que de verdad ocupa. Nada más: la hora no cambia lo que se paga ni lo que
se descuenta.

## Decisiones tomadas

1. **La hora es OPCIONAL y solo en Permiso.** Un permiso sin hora sigue siendo
   un permiso de día completo, exactamente como hoy. Ninguna solicitud
   existente cambia.
2. **Las dos horas o ninguna.** Media pareja no significa nada: «desde las 9:00»
   sin fin no dice cuánto dura, y un rango a medias en el calendario es peor que
   no tener rango.
3. **Solo en permisos de UN día.** «Del lunes al viernes de 9:00 a 11:00» no
   tiene lectura única —¿dos horas cada día?, ¿desde el lunes a las 9 hasta el
   viernes a las 11?—, y la ambigüedad acabaría en el calendario.
4. **La hora es informativa: no toca la hoja de nómina ni la regla de solapes.**
   Un permiso de dos horas sigue escribiendo `Días: 1` en la hoja con la que se
   paga, y dos permisos el mismo día se siguen bloqueando por `rango_solapado`.
   Ver «Qué NO entra».
5. **En Google Calendar es un evento con hora de verdad**, no un evento de día
   completo con la hora escrita en el título. Cuesta tocar dos campos del
   workflow de producción; el diseño hace que ese cambio sea reversible y que el
   orden de despliegue deje de importar (ver «El cambio en n8n»).

## Modelo de datos — migración 036

```sql
ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS hora_inicio TIME,
  ADD COLUMN IF NOT EXISTS hora_fin    TIME;

-- Los CHECK no admiten IF NOT EXISTS. Mismo patrón que la 029.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.solicitudes_ausencia'::regclass
       AND conname  = 'solicitudes_horas_coherentes'
  ) THEN
    ALTER TABLE portal.solicitudes_ausencia
      ADD CONSTRAINT solicitudes_horas_coherentes
      CHECK (
        (hora_inicio IS NULL AND hora_fin IS NULL)
        OR (hora_inicio IS NOT NULL AND hora_fin IS NOT NULL
            AND hora_fin > hora_inicio
            AND fecha_inicio = fecha_fin)
      );
  END IF;
END $$;
```

⚠️ **Los dos `IS NOT NULL` son obligatorios y NO son redundantes.** La versión
corta —fiarse de que `hora_fin > hora_inicio` ya sea falsa si falta una— es un
bug silencioso: en Postgres un CHECK **rechaza solo cuando la expresión es
`FALSE`, y una expresión `NULL` PASA**. Con media pareja, `hora_fin > hora_inicio`
es `NULL`, la disyunción entera es `NULL`, y la fila entra. Sin los dos
`IS NOT NULL`, la regla número dos de este diseño no la vigila nadie: la BD
aceptaría «desde las 9:00» sin hora de fin, y el ISO que se le manda a Google
saldría con `null` dentro.

**El CHECK NO mira el tipo, a propósito.** Que solo Permiso admita hora es una
regla por tipo, y las reglas por tipo de esta app viven en la validación del
servicio (`esOtorgamiento`, la ventana de la incapacidad, el no pedir días
pasados). Ponerla también aquí obligaría a una migración el día que Compensatorio
quiera medias jornadas, y no compraría nada: por SQL a esta tabla no escribe
nadie más que este repo.

Como toda migración de este proyecto: solo DDL, idempotente, y **hay que añadirla
a mano al array `MIGRATIONS` de `db.ts`** — olvidarlo no da ningún error, la
columna simplemente no existe en producción. El candado es un test de
`information_schema` como el de la 035.

### El CHECK y el ROLLBACK que se lleva la escritura buena

⚠️ **Esta es la trampa principal del diseño.** El CHECK exige
`fecha_inicio = fecha_fin` mientras haya horas, y hay **dos caminos que cambian
las fechas de una solicitud ya creada**:

- `aplicarALaSolicitud` (`repo.ts`), cuando el jefe aprueba una modificación de
  fechas.
- `actualizarSolicitud` (`repo.ts`), el `PATCH` del registro general — la cuarta
  puerta del solapamiento.

Los dos escriben **dentro de una transacción que también encola el evento del
outbox**. Si uno de ellos extiende a dos días un permiso que tiene horas, el
`UPDATE` viola el CHECK, la transacción entera hace `ROLLBACK` y se lleva por
delante la escritura buena. Es exactamente el patrón del CHECK sobre `evento` del
outbox, que ya mordió una vez.

**Por eso los dos caminos borran las horas en el MISMO `UPDATE`** cuando el rango
nuevo deja de ser de un solo día:

```sql
SET fecha_inicio = $5::date, fecha_fin = $6::date, dias_habiles = $7,
    hora_inicio = CASE WHEN $5::date = $6::date THEN hora_inicio ELSE NULL END,
    hora_fin    = CASE WHEN $5::date = $6::date THEN hora_fin    ELSE NULL END
```

No es una limpieza cosmética: es lo único que impide que una corrección
perfectamente razonable devuelva un 500 opaco. Y como es una regla escrita en
SQL, **solo la vigila un test de `test:db`**: los dobles en memoria no ejecutan
consultas, así que un `.test.ts` que la diera por buena estaría probando su
propia copia.

## La validación

En `crearSolicitud`, cuando el cuerpo trae horas:

| Situación | Código | Estado |
|---|---|---|
| Formato distinto de `HH:MM`, o media pareja | `hora_invalida` | 400 |
| `horaFin <= horaInicio` | `hora_invalida` | 400 |
| Tipo distinto de `permiso`, o `fechaInicio ≠ fechaFin` | `hora_no_permitida` | 400 |

Dos códigos y no uno: cada uno se traduce a una frase distinta en la caja roja, y
un código que significa dos cosas obliga a escribir un mensaje que no dice
ninguna. Ninguno de los dos debería verlos un usuario normal —la interfaz no deja
llegar ahí, ver más abajo—; son la red por debajo.

`HH:MM` y no un parseo laxo, por lo mismo que `esFechaValida` en la fecha de
retiro: estas cadenas se comparan entre sí y se concatenan a un ISO para Google,
y un `9:5` compilaría y rompería las dos cosas en silencio.

## El evento de Google

`calendario()` (`notificaciones.ts`) gana una rama y el payload un campo:

```ts
/** UTC−5 fijo: Colombia no tiene horario de verano, así que no hay casuística. */
const OFFSET_COLOMBIA = '-05:00';

function calendario(s: Solicitud): EventoCalendario {
  const base = {
    calendarId: CALENDARIO_STAFF,
    eventId: idDeEventoCalendario(s.id),
    accion: 'crear' as const,
    resumen: `${ETIQUETA_TIPO[s.tipo]} ${s.empleadoNombre}`,
  };
  if (s.horaInicio !== null && s.horaFin !== null) {
    return {
      ...base,
      todoElDia: false,
      // Sin el +1: ese solo es correcto para un evento de dia completo, donde
      // Google trata el `end` como EXCLUSIVO. Con hora, el fin es el fin.
      inicio: `${s.fechaInicio}T${s.horaInicio}:00${OFFSET_COLOMBIA}`,
      fin: `${s.fechaInicio}T${s.horaFin}:00${OFFSET_COLOMBIA}`,
    };
  }
  return { ...base, todoElDia: true, inicio: s.fechaInicio, fin: sumarDias(s.fechaFin, 1) };
}
```

⚠️ **El `+1 día` es la segunda trampa.** Existe porque Google trata el `end` de un
evento de día completo como exclusivo. Aplicarlo a un evento con hora movería el
final un día entero: un permiso de 9:00 a 11:00 del martes acabaría el miércoles
a las 11:00. Las dos ramas tienen que decir cosas distintas, y el candado del
`+1` que hoy existe tiene que ganar un gemelo que exija lo contrario con hora.

⚠️ **El desfase va EXPLÍCITO (`-05:00`), no se deja a Google.** Un `dateTime` sin
offset se interpreta en la zona por defecto del calendario, que no la controla
esta app: el día que alguien la cambie, todos los permisos se moverían de hora en
silencio y sin nada que se ponga rojo. Colombia es UTC−5 fijo, sin horario de
verano, así que la constante no tiene casuística — es el mismo criterio de
`hoyEnColombia`.

### `todoElDia` por omisión es «sí», y no al revés

⚠️ **La tercera trampa, y la que ya mordió una vez en este workflow.** La
expresión natural en n8n sería:

```
{{ payload.calendario.todoElDia ? 'yes' : 'no' }}
```

y sería un bug idéntico al del campo `drive`, que el propio `notificaciones.ts`
documenta: para cualquier evento que **no traiga la clave**, `undefined` es falso,
así que se resolvería a `'no'` y el nodo intentaría crear un evento con hora a
partir de una fecha suelta. Y eventos sin la clave los va a haber seguro: los que
estén esperando en el outbox durante la ventana de despliegue.

La expresión va al revés, exigiendo el `false` explícito:

```
={{ $('Repartir eventos').item.json.payload.calendario.todoElDia === false ? 'no' : 'yes' }}
```

Todo lo que no diga explícitamente «con hora» es de día completo, que es el
comportamiento de siempre. Eso convierte un cambio en un workflow de producción
que no se puede probar de punta a punta en un cambio **reversible**: lo peor que
puede pasar si la expresión queda mal es que todo siga siendo de día completo,
que es el comportamiento de hoy.

⚠️ **Pero el orden de despliegue SÍ importa, y en un solo sentido: n8n va
PRIMERO.** El `=== false` solo protege una de las dos direcciones:

| | Resultado |
|---|---|
| n8n nuevo + hub-api viejo | **Bien.** El payload viejo no trae `todoElDia`, así que la expresión resuelve `'yes'` y el evento sigue siendo de día completo. |
| n8n viejo + hub-api nuevo | **Roto.** hub-api emite `todoElDia: false` y un ISO completo, pero el nodo sigue con `allday` fijo a `"yes"` y le mete un `...T09:00:00-05:00` al campo `date` de Google, que es un 400. |

Así que la secuencia es: **cambiar los dos campos de n8n, comprobar que los
eventos de día completo siguen saliendo, y solo entonces empujar hub-api.** Con
n8n ya cambiado no hay ventana de riesgo: hasta que hub-api despliegue, todo lo
que llega sigue sin la clave y sigue siendo de día completo.

## El cambio en n8n

Workflow `dh0xjWCHsGj9raYH` («Ausencias — Portal»). **Dos nodos, un campo cada
uno**, hoy con el valor literal `"yes"`:

| Nodo | Campo |
|---|---|
| `Crear evento con id` | `additionalFields.allday` |
| `Actualizar evento del calendario` | `updateFields.allday` |

Los dos ya llevan `onError: continueErrorOutput`, `retryOnFail` con dos intentos
y, por debajo, el tope de cinco intentos del outbox que se puso el 2026-08-25.
No se toca ninguna conexión ni ningún otro nodo.

**No se toca `Crear evento en el calendario`** (el nodo de la rama por defecto del
switch, sin id impuesto): no lo alcanza ningún evento de esta funcionalidad, y
cambiarlo sería ampliar la superficie sin motivo.

Se comprueba con un permiso de prueba de punta a punta desde la cuenta de
pruebas: crear uno con hora, verlo como bloque en el calendario; crear uno sin
hora, verlo de día completo.

## La interfaz

**El formulario.** Dos `input type="time"` opcionales, que aparecen **solo** con
Permiso marcado y `fechaInicio === fechaFin`. Si estando rellenas se cambia la
fecha de fin a otro día, **se borran solas y se avisa en línea** («un permiso de
varios días no lleva hora»). Así el usuario no llega nunca al 400: los dos
códigos de arriba quedan de red.

**Donde ya se pinta el rango — y no hay un sitio único, conviene saberlo antes de
tocar.** Las columnas «Desde» y «Hasta» salen de `fechasDeLaFila` (`dominio.ts`),
que es la que usa `TablaSolicitudes`, y esa tabla la comparten **Mis solicitudes
y la bandeja del jefe**: con tocar ahí, la hora sale en las dos pantallas donde la
solicitud se lee, que son las que importan. Un permiso con hora se pinta
`desde: «1 sep 2026 · 9:00»`, `hasta: «11:00»` — repetir la fecha en la segunda
celda se leería como una errata, igual que ya pasa con el otorgamiento.

`rangoFechas` es OTRA función y no la tocan las tablas: la usan el encabezado de
`PedirModificacion` y los mensajes de error de `api.ts`. Se le añaden dos
parámetros opcionales de hora para que el encabezado de la modificación no mienta
sobre lo que se está cambiando; al ser opcionales, ningún llamante actual cambia.

**El correo a quien firma.** El bloque de fechas de `notificaciones.ts` usa su
propio formato; se le añade la hora por el mismo criterio: quien recibe el correo
tiene que poder decidir sin abrir el portal.

**El calendario del portal se queda como está.** Su rejilla pinta celdas de día, y
un bloque horario dentro de una celda mensual no cabe ni aporta. Llevar la hora
siquiera al detalle de la marca obligaría a ampliar `ausenciasEntre` y el tipo
`MarcaCalendario`, que es otra consulta y otra proyección: no entra. El
calendario donde la hora sí importa —y donde se pidió— es el de Google.

**El espejo manual.** `apps/ausencias/src/api.ts` replica el backend sin
generación ni test de contrato, así que `horaInicio`/`horaFin` hay que copiarlas a
mano —con el mismo nombre— en `Solicitud` y en `NuevaSolicitud`.

## Qué NO entra

- **La hoja de nómina no cambia.** Un permiso de dos horas sigue escribiendo
  `Días: 1`. Al otro lado hay un recibo, y cambiar lo que se escribe ahí es una
  decisión que se acuerda con administración, no un efecto colateral de añadir un
  campo.
- **La regla de solapes sigue siendo por días.** Dos permisos el mismo día —uno
  de mañana y otro de tarde— se seguirán bloqueando con `rango_solapado` aunque
  no se pisen ni un minuto. Es previsible que sea lo primero que alguien intente
  al ver el campo; queda anotado como la ampliación natural, y toca `solapeDe` y
  las cuatro puertas del solapamiento.
- **Las modificaciones de fechas no cambian las horas.** Para cambiar la hora se
  retira la solicitud y se pide otra. Lo único que hacen es borrarlas cuando el
  rango deja de ser de un día, y por obligación del CHECK.
- **Solo Permiso.** Compensatorio de media jornada es la ampliación evidente y el
  CHECK está escrito para no estorbarla, pero no entra hoy.
- **El Registro general no enseña la hora.** Su tabla no comparte componente ni
  tipo con las otras dos: se pinta desde `Movimiento`, una proyección propia que
  une solicitudes con modificaciones y trae las fechas EFECTIVAS del movimiento.
  Llevar la hora ahí es ampliar esa unión, y es un registro de auditoría que
  razona por días. La hora se ve donde se lee la solicitud.
- **Ningún cambio en el histórico importado.** Las filas del Excel no traen hora
  y se quedan como están.

## Plan de pruebas

**Contra Postgres real (`.db.test.ts`), que es lo único que ejecuta el SQL:**

- El CHECK acepta la pareja completa en un solo día, y rechaza: **media pareja en
  las DOS direcciones** (inicio sin fin y fin sin inicio), `hora_fin = hora_inicio`,
  `hora_fin < hora_inicio` y un rango de dos días. Las dos direcciones de la media
  pareja por separado, y no una de muestra: son las que caen en la trampa del
  CHECK que pasa con `NULL`, y quitar los `IS NOT NULL` tiene que ponerlas rojas.
- `aplicarALaSolicitud` extendiendo a dos días un permiso con horas: **no
  revienta**, las horas quedan en `NULL` y el evento del outbox sigue encolado.
  El mismo caso por `actualizarSolicitud`. Son los dos candados del ROLLBACK.
- El candado de `information_schema`: las dos columnas existen con `data_type`
  `time without time zone`, o sea que la 036 está en el array `MIGRATIONS`.

**Unitarios:**

- `calendario()` con hora: emite ISO con `-05:00`, `todoElDia: false` y **sin el
  `+1 día`** — el gemelo del candado que ya existe para el día completo.
- `calendario()` sin hora: idéntico a hoy, `todoElDia: true` y con el `+1`.
- La validación: los dos códigos, cada uno por su camino.
- `rangoFechas` con y sin hora.

**A ojo, tras desplegar:** un permiso con hora y otro sin ella, mirando el
Google Calendar del equipo.

## Riesgos

1. **El cambio en n8n toca producción y no se puede probar de punta a punta antes
   de empujar.** Mitigado por el `=== false` defensivo: lo peor que puede pasar
   con la expresión mal es que todo siga siendo de día completo, que es el
   comportamiento de hoy. Y el orden de despliegue no importa.
2. **El CHECK puede rebotar dentro de una transacción y llevarse la escritura
   buena.** Es el riesgo real de este diseño y por eso los dos `UPDATE` borran las
   horas, con dos candados de BD dedicados. Si aparece un tercer camino que
   cambie fechas, tiene que hacer lo mismo.
3. **Dos permisos el mismo día siguen chocando.** Es una limitación conocida y
   aceptada, no un descuido. Conviene decírselo a quien vaya a usar el campo
   antes de que lo descubra con un 409.
4. **El espejo de `api.ts` no lo vigila ningún test de contrato.** Un nombre mal
   copiado da `undefined` en pantalla, no un rojo. Es deuda conocida de la app.
