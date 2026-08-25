# Baja de empleados: retirar a quien se va de la compañía

Fecha: 2026-08-24
Estado: diseño aprobado, pendiente de plan de implementación

## El problema

Cuando alguien se va de la compañía, hoy no hay ninguna forma de decírselo a la
app de Vacaciones y Permisos. La persona sigue en el organigrama, sigue en el
calendario, sigue en el panel de Saldos — y, sobre todo, **sigue devengando
vacaciones**: `calcularSaldo` calcula el devengo como
`diasEntre(fecha_corte, hoy)`, y `hoy` no deja de avanzar nunca. Un empleado que
se fue en marzo aparece en agosto con cinco meses de vacaciones que no ganó.

La columna `activo` de `portal.empleados` existe y hace casi todo el trabajo:
las consultas del organigrama, de los saldos, del calendario y del alta filtran
por ella (unas quince en `repo.ts`), y `asegurarEmpleado` respeta una ficha
desactivada — su `INSERT ... ON CONFLICT DO NOTHING` no la revive, así que la
persona recibe un 403 y no puede volver a entrar.

Lo que no existe es nada de lo demás: no hay endpoint para desactivar (el router
tiene `PUT` de jefe, copia, visor, exportador, segunda firma y saldo, pero
ninguno de baja), no hay fecha de retiro, no hay forma de ver a los retirados, y
el devengo no se detiene.

## Para qué se hace

**El saldo congelado es el número que se paga.** Es la decisión que gobierna el
resto del diseño: al retirar a alguien, sus vacaciones no disfrutadas son una
deuda de la compañía, así que el número tiene que ser exacto, defendible y
consultable. De ahí salen tres consecuencias que no tendría un diseño de simple
limpieza: se guarda quién registró la baja y cuándo, la vista de retirados
enseña el saldo, y el sistema no decide por nadie sobre días que están a punto
de pagarse.

## Decisiones tomadas

1. **La baja se puede programar con fecha futura.** El caso corriente es «se va
   el 30 de septiembre»: la persona sigue trabajando y pidiendo vacaciones hasta
   ese día.
2. **Bloquear en vez de arreglar por su cuenta.** Si retirar a alguien dejaría
   algo incoherente, la app no lo hace y dice qué falta. No cierra solicitudes
   ajenas ni recorta días: sería el sistema decidiendo por alguien sobre lo que
   se va a pagar.
3. **Solo estorban los días posteriores a la fecha.** Los pendientes anteriores
   son legítimos y se firman con normalidad durante las semanas que quedan.

## Modelo de datos — migración 035

```sql
ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS fecha_retiro DATE;
ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS retirado_por VARCHAR(254);
ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS retirado_at TIMESTAMPTZ;
```

`retirado_por` y `retirado_at` no son adorno: son la constancia de quién fijó el
número que se paga. Se rellenan al registrar la baja, no al aplicarla.

**Hay que añadir la 035 al array `MIGRATIONS` de `db.ts` a mano.** Olvidarlo no
da ningún error: la migración simplemente no corre, y la columna no existe en
producción mientras en local sí.

**No se emite ningún evento de outbox.** Retirar a alguien no manda correos ni
toca Google Calendar, así que el `CHECK` de `evento` no se amplía. Es
deliberado: si en algún momento se quiere avisar por correo, hará falta una
migración que amplíe ese CHECK **antes**, o el INSERT rebotará dentro de la
transacción y el ROLLBACK se llevará también la baja.

### Qué significa exactamente `fecha_retiro`

**Es el último día que la persona trabaja, y ese día todavía está activa.** No es
el primer día que ya no está. De aquí salen todas las comparaciones del resto del
documento, y conviene fijarlo antes que nada porque un `<=` donde va un `<`
retira a alguien un día antes de tiempo y le recorta un día de devengo — sobre
un número que se paga.

### Los tres estados

| Estado | Condición | Dónde aparece |
|---|---|---|
| **Activo** | `activo = true` y `fecha_retiro IS NULL` | Vista Activos, organigrama, saldos, calendario |
| **Con salida prevista** | `activo = true` y `fecha_retiro >= hoy` | Igual que un activo, más la etiqueta «Sale el DD/MM» |
| **Retirado** | `activo = false` | Vista Retirados |

Los dos primeros son indistinguibles para el resto de la app a propósito: quien
tiene salida prevista trabaja, pide y firma como cualquiera.

`activo` se mantiene como la única bandera que apagan las consultas. **La fecha
no cambia ninguna de esas quince consultas**: solo decide *cuándo* se apaga la
bandera. Esa es la virtud del diseño — no hay que revisar cada `WHERE activo`
buscando cuál se olvidó de mirar también la fecha.

## La congelación del devengo

`calcularSaldo(config, ausencias, hoy)` ya recibe `hoy` como parámetro. Para un
empleado con fecha de retiro se le pasa `min(hoy, fecha_retiro)`.

El cambio vive en un solo punto: el bucle de `combinar`, que hoy pasa el mismo
`hoy` a todas las fichas y pasará a calcular el suyo por empleado. `calcularSaldo`
no se toca.

Como el saldo se recalcula en cada lectura y nunca se materializa, corregir una
fecha mal puesta arregla el número solo. No hay nada que rehacer.

Lo que **no** se congela es `disfrutadas`: si al llegar la fecha quedaba una
solicitud sin firmar y el jefe la aprueba después, esos días se descuentan como
corresponde. Ver «El número firme» más abajo.

## Los bloqueos

Al registrar la baja con una fecha, la operación se rechaza —con el detalle de
qué falta— si:

- Tiene vacaciones **pedidas o aprobadas con `fecha_fin` posterior** a la fecha
  de retiro. El mensaje dice cuáles.
- Alguien lo tiene como `aprobador_correo` o `copia_correo`. El mensaje dice
  cuántas personas y quiénes. Hay que reasignarlas antes.

**Las dos comprobaciones se informan JUNTAS**, en un único error
`retiro_bloqueado` cuyo detalle trae las dos listas (vacía la que no aplique).
No se cortocircuita en la primera: quien se topa con ambos problemas es
justamente *el jefe que se va* —tiene equipo por definición y suele tener
vacaciones pendientes—, y los dos remedios se ejecutan en pantallas distintas
(rechazar una solicitud vs. reasignar el equipo en Organigrama), así que
decirle solo uno le hace descubrir el otro después de haber arreglado el
primero, tal vez días más tarde.

Los pendientes anteriores a la fecha **no** bloquean.

Y desde que una ficha tiene fecha de retiro, la validación de alta de solicitudes
rechaza cualquier petición cuya `fecha_fin` pase de ese día. Es la misma regla,
aplicada en el otro extremo.

## El barrido

Lo que aplica una baja programada cuando llega su día:

```sql
UPDATE portal.empleados
   SET activo = false
 WHERE activo AND fecha_retiro IS NOT NULL AND fecha_retiro < $1
```

`<` y no `<=`, por lo que fija la sección de arriba: el día de la fecha todavía
trabaja. Con `<=` se le apagaría el acceso en su último día y perdería un día de
devengo. Es un candado que hay que falsar explícitamente — un test con la fecha
puesta a hoy que exija que la ficha siga activa.

Idempotente y de coste cero cuando no hay nadie que retirar.

**Va colgado de la carga del contexto de la app**, que ejecuta cualquiera que la
abra, y no de un cron nuevo. El razonamiento: no añade infraestructura ni un
punto de fallo silencioso, y si nadie abre la app tampoco hay nadie mirando las
listas que la baja debería limpiar. La alternativa descartada era engancharlo al
ciclo con el que n8n sondea el outbox.

Es una escritura en un camino de lectura, así que va con su comentario: dos
peticiones concurrentes pueden ejecutarlo a la vez y no pasa nada, porque el
`WHERE activo` hace que la segunda no encuentre filas.

## El número firme

La bandeja de aprobación **no filtra por `activo`** (`solicitudesPendientes`
filtra por estado y por correo del aprobador). Comprobado. Eso significa que si
al llegar la fecha le quedaba una solicitud sin firmar, su jefe la sigue viendo
y puede cerrarla con normalidad — y los días aprobados se descuentan del saldo
congelado, que es lo correcto.

La consecuencia es que **el número no es firme hasta que no le quedan solicitudes
vivas**, y eso tiene que verse. La vista de Retirados avisa por fila: «2
solicitudes aún sin firmar — el saldo puede moverse». Sin ese aviso, alguien
pagaría un número provisional creyéndolo definitivo.

## La interfaz — pestaña Empleados

Va en **Empleados** y no en Organigrama: Empleados es el maestro de fichas
(`ImportarEmpleados.tsx`, altas y mantenimiento), Organigrama es de relaciones y
Saldos es de números. El ciclo de vida de una persona pertenece al maestro.

Selector de vista arriba: **Activos** / **Retirados**.

- **Activos**: la lista de hoy. Cada fila gana un botón **Retirar** que pide la
  fecha. Una ficha con fecha futura se queda aquí, con la etiqueta «Sale el
  DD/MM» y la opción de anular la salida.
- **Retirados**: nombre, correo, **fecha de retiro**, quién la registró, **el
  saldo congelado** (vacaciones y compensatorios) y el aviso de solicitudes
  vivas si las hay. Cada fila puede **Reactivar**.

**Reactivar** limpia `fecha_retiro`, `retirado_por` y `retirado_at` y devuelve
`activo = true`. Una baja mal registrada no obliga a tocar la base de datos.

### Las fichas desactivadas sin fecha

Las dos cuentas de prueba que se desactivaron a mano el 2026-08-24
(`algarpibe@hotmail.com`, `ambientaliacol@gmail.com`) tienen `activo = false` y
`fecha_retiro IS NULL`. Aparecen en Retirados con la fecha vacía. Es honesto
—están inactivas— y evita inventar una tercera vista para un caso que ocurre una
vez.

## Qué NO entra

- **Ningún correo ni evento de calendario.** Retirar es un acto administrativo
  interno.
- **Ningún cálculo de liquidación en dinero.** La app da los días; el dinero es
  de nómina.
- **Ninguna baja masiva.** Se retira de una en una, que es como ocurre.
- **Ningún borrado.** Retirar conserva la ficha y su historial entero. Borrar
  sigue siendo una operación aparte y manual.

## Plan de pruebas

- **La congelación**: unitarios sobre `calcularSaldo` y sobre el cálculo del
  `hoy` por empleado. Es función pura, así que aquí un test es barato y directo:
  un retirado el día 10 tiene el mismo devengo el día 11 que el día 40.
- **Los bloqueos**: tests de servicio con el doble de pool, sobre las dos
  condiciones y sobre el caso que NO debe bloquear (pendiente anterior).
- **El barrido y los `WHERE activo`**: `test:db`, contra Postgres de verdad. En
  este repo **una regla escrita en SQL solo la vigila un test de `test:db`** —
  el doble de `router.test.ts` casa por forma y no ejecuta la consulta, y el de
  `users.integration.test.ts` casa por regex y ni siquiera valida el SQL. Es
  literalmente cómo una consulta inválida tumbó la autenticación en producción
  el 2026-08-23.
- **La falsación**: al terminar, romper cada candado a propósito y ver morir el
  test que dice vigilarlo. Conservando la aridad de los bindings — mutar un
  recorte a `WHERE TRUE` a secas rompe el binding y los tests mueren de error de
  conexión, no de dato mal filtrado, que es una falsación falsa.

## Riesgos

1. **Olvidar la 035 en el array `MIGRATIONS`.** No da error. Se comprueba con un
   test de `test:db` que lea `information_schema.columns`, como ya hace el de la
   034 con `token_version`.
2. **El barrido no corre si nadie abre la app.** Asumido a propósito. El efecto
   es que un retirado sigue listado hasta que alguien entra; en ese momento
   desaparece. Si algún día molesta, se cuelga del ciclo de n8n sin cambiar nada
   más.
3. **Una fecha de retiro anterior a `fecha_corte`** daría un devengo de cero
   días y un saldo igual al del corte. Es aritméticamente correcto
   (`Math.max(0, diasEntre(...))` ya lo cubre) pero conviene avisar en la
   interfaz, porque casi siempre significará que alguien se equivocó de fecha.
