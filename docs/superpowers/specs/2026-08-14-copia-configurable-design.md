# Diseño — La copia de los correos, configurable por persona (app Vacaciones y Permisos)

## Objetivo

Que quien recibe **copia** de los correos de una persona se decida desde el
portal, ficha por ficha, en vez de estar escrito en el código para toda la
empresa.

Hoy es una constante:

```ts
export const COPIA_ADMINISTRACION = ['comercial@ambientalia.com.co', 'administrativo@ambientalia.com.co'];
```

Cambiarla exige tocar código y desplegar. Y es la misma para todo el mundo, así
que no hay forma de que las solicitudes de un área las siga su coordinador sin
que las siga también todo el resto.

## Qué recibe copia hoy, exactamente

Importa porque es más pequeño de lo que parece. `COPIA_ADMINISTRACION` entra en
**dos** de los seis correos:

| Correo | ¿Lleva copia hoy? |
|---|---|
| Acuse de solicitud (vacaciones, permiso, compensatorio) | No |
| Acuse de **incapacidad** | **Sí** |
| Aviso al jefe inmediato (1ª firma) | No |
| Aviso al segundo aprobador | No |
| **Aprobada** | **Sí** |
| **Rechazada** | **Sí** |

La copia configurable ocupa **exactamente ese hueco**, ni más ni menos: es un
reemplazo, no una ampliación, y nadie empieza a recibir correos que antes no
existían.

**Nómina no depende de estos correos.** Los datos le llegan por la hoja
`consulta_vacaciones`, que no se toca. Retirar la copia deja a alguien sin el
aviso, nunca sin el dato.

## El dato

Migración **021**: una columna en `portal.empleados`.

```sql
ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS copia_correo VARCHAR(254) DEFAULT 'administrativo@ambientalia.com.co';
```

`NULL` significa **sin copia**.

El `DEFAULT` es lo que hace el sembrado, y es deliberado que no haya ningún
`UPDATE`: las migraciones de este repo **se re-ejecutan en cada arranque**, así
que un `UPDATE` volvería a poner `administrativo@` en cada despliegue y
machacaría las copias que se hubieran ajustado a mano. `ADD COLUMN ... DEFAULT`
rellena las filas existentes una sola vez, y a partir de ahí el `IF NOT EXISTS`
hace que la migración no toque nada. (Desde Postgres 11 ese relleno es solo
metadatos, sin reescribir la tabla; antes la reescribía, lo que con una plantilla
de dos docenas de filas daría igual de todos modos.)

El `DEFAULT` **se queda** después del relleno: así una ficha nueva —las crea
`asegurarEmpleado` en el primer acceso de cada persona— tampoco nace sin copia
por descuido. Quitarla es una edición explícita.

## Quién recibe qué

`COPIA_ADMINISTRACION` **desaparece de `config.ts`**. En su lugar, los dos
correos que la usaban leen `copiaCorreo` de la ficha del solicitante.

Efecto que conviene tener presente: esa constante lleva también **`comercial@`**,
que deja de ser copia fija. Con el organigrama actual no pierde ni un correo —es
el primer o el segundo firmante de todas las personas, así que sigue recibiendo
por `cadenaDeDecision`—, pero si algún día alguien cuelga de una rama que no pase
por él, dejaría de enterarse de esa decisión.

`destinatarios()` ya deduplica y filtra nulos, así que una copia que coincida con
un firmante no duplica el correo, y una copia a `NULL` no mete un destinatario
vacío. Esa función no se toca; se apoya el diseño en ella.

## La copia NO se congela

Los dos firmantes se congelan en el alta. **La copia se lee en el momento de
notificar**, del `copia_correo` que tenga la ficha en ese instante.

La asimetría es a propósito: un firmante determina **quién puede decidir** —es un
permiso, y moverlo a mitad de trámite cambiaría las reglas de algo que ya está en
vuelo—, mientras que la copia solo determina a quién se avisa. Congelarla
obligaría a una columna más en `solicitudes_ausencia` y, peor, haría que corregir
una copia mal puesta no arreglara ninguna de las solicitudes ya en curso.

Sale gratis: `SELECT_SOLICITUD` ya hace `JOIN portal.empleados e`, así que basta
añadir `e.copia_correo` y el campo `copiaCorreo` al tipo `Solicitud`. Todas las
funciones de `notificaciones.ts` reciben ya una `Solicitud`, así que **ninguna
firma cambia**.

## La pantalla

Tercera columna en la pestaña **Organigrama**, junto a «jefe inmediato» y «2ª
firma»: un desplegable con las personas activas más una opción **«— sin copia»**.
Mismo componente y mismo patrón de guardado que el jefe.

Endpoint nuevo:

```
PUT /ausencias/empleados/:id/copia   { copiaCorreo: string | null }
```

`requireAuth` + `requireAdmin`, como el del jefe. Valida que el correo sea el de
un empleado **activo**, o `NULL`. No hay comprobación de ciclos: esto no es un
árbol, nadie se aprueba a sí mismo por estar en copia.

El desplegable **no excluye a la propia persona**, y no hace falta que lo haga:
ponerse a uno mismo en copia es inofensivo porque `destinatarios()` deduplica, y
añadir la excepción sería una regla más que explicar y mantener por un caso que
no rompe nada.

No manda ningún correo, igual que cambiar el jefe o fijar el saldo: tocar la
configuración no es decidir nada sobre una solicitud.

## El riesgo que hay que mirar de frente

**El acuse de incapacidad lleva copia, y una incapacidad es un dato de salud.**

Hoy ese acuse solo lo ven dos buzones de administración. En cuanto la copia sea
configurable, poner ahí a un compañero significa que ese compañero se entera de
cada incapacidad de esa persona. El repo ya cita la Ley 1581 a propósito de esto
en el JSDoc de `VISORES_ADJUNTOS`.

No se bloquea —es una decisión de la empresa, no del código—, pero:

- El panel lleva un **aviso explícito** junto a la columna, que diga que quien
  esté en copia recibirá también los acuses de incapacidad.
- La documentación lo recoge.
- **`VISORES_ADJUNTOS` no cambia.** Estar en copia da el aviso, no la llave para
  abrir el PDF de nadie: son dos permisos distintos y siguen siéndolo.

## Alcance: lo que no entra

- **Varios destinatarios en copia.** Uno por persona. Si hiciera falta un
  segundo, la columna se convierte en tabla; hoy no hay caso que lo pida.
- **Copia a buzones sin ficha de empleado** (un `nomina@` genérico). El
  desplegable solo ofrece personas activas: así el correo siempre existe y una
  errata no manda los avisos al vacío.
- **Cambiar qué correos llevan copia.** Los mismos dos de hoy.
- **Tocar `VISORES_ADJUNTOS`** ni el acceso a los adjuntos.

## Pruebas

En hub-api, que es donde hay tests:

- La copia entra en el correo de **aprobada** y en el de **rechazada**.
- La copia entra en el **acuse de incapacidad**.
- La copia **no** entra en el acuse normal ni en los avisos a los aprobadores —
  lo contrario sería la ampliación silenciosa que este diseño descarta.
- `copiaCorreo: null` no añade un destinatario vacío.
- Una copia que coincide con un firmante **no duplica** el correo (apoyado en
  `destinatarios()`).
- `PUT /ausencias/empleados/:id/copia`: 200 con un empleado activo, 200 con
  `null`, **400** con un correo que no es de nadie o de alguien inactivo, 403 a
  quien no es admin.

`apps/ausencias` no tiene tests; su cobertura es el `tsc -b` del portal.

## Puesta en marcha

**hub-api primero, portal después.** hub-api trae la migración y el endpoint; el
portal, la columna que lo llama.

La migración 021 es aditiva y **no destruye nada**: si hubiera que revertir,
basta con volver el build atrás — la columna sobrante no molesta a nadie. Es lo
contrario del caso de la 020.

El día del despliegue **nadie deja de recibir nada**, aunque la copia pase de dos
buzones a uno: todo el mundo queda con `administrativo@` en copia, y `comercial@`
—el que se cae de la constante— sigue llegando a esos mismos correos por
`cadenaDeDecision`, porque en el organigrama actual es primer o segundo firmante
de toda la plantilla. El conjunto de destinatarios efectivo es el mismo; lo que
cambia es por qué vía llega cada uno.
