# Diseño — La segunda firma, opcional por trabajador (app Vacaciones y Permisos)

## Objetivo

Poder decidir, persona a persona, si sus solicitudes necesitan **dos** firmas o
basta con **una**.

Hoy la cascada no es negociable: si por encima del jefe inmediato hay alguien
más, ese alguien tiene que firmar. Cuando el jefe inmediato ya tiene autoridad
suficiente, eso es un trámite que solo añade espera.

La regla nueva, con lo que la hace distinta de simplemente «quitar el segundo
nivel»:

> Si un trabajador tiene un superior de segundo nivel pero **no** se requiere su
> firma, la primera firma cierra la solicitud — y el correo del resultado sigue
> llegando a **todos los interesados**: el trabajador, el jefe inmediato que
> firmó, y el superior de segundo nivel que ya no firma.

Ese superior deja de ser un **firmante** y pasa a ser un **informado**. Es el eje
de todo el diseño.

## Lo que ya funciona y NO cambia

- La derivación del organigrama. La segunda firma se sigue deduciendo subiendo un
  escalón desde `aprobador_correo`, con sus cuatro reglas de corte (raíz, jefe sin
  ficha activa, jefe repetido, ciclo). Esta feature no toca ninguna.
- Las solicitudes **en vuelo**. Los firmantes se congelan en el alta y el nuevo
  campo también: cambiar la casilla no mueve nada que ya esté en trámite.
- Las **incapacidades**. No pasan por aprobación ni por `cadenaDeDecision`, y su
  copia a gerencia (`COPIA_INCAPACIDADES`) se queda exactamente donde está. Esta
  feature toca destinatarios, así que conviene dejar dicho que ese caso se miró:
  no le afecta.
- **Quién puede abrir un adjunto** y **quién ve la pestaña de soportes**.
- El correo al **segundo aprobador** (`aprobacion_2`) y su texto. Se sigue
  emitiendo para todos los que sí conserven la doble firma.

## El reparto: firmante o informado, nunca los dos

`aprobadoresDe` deja de devolver dos campos y devuelve tres:

```ts
export interface Aprobadores {
  /** Quien firma primero. Siempre el `aprobadorCorreo` del solicitante. */
  primero: string;
  /** Quien firma DESPUÉS, o `null` si no hay segunda firma. */
  segundo: string | null;
  /** El de segundo nivel cuando NO firma: solo se le avisa del resultado. */
  informado: string | null;
}
```

**Invariante: `segundo` e `informado` nunca son ambos no nulos.** Es una firma o
es un aviso, no las dos cosas, y se prueba como tal.

Las reglas de corte se aplican **antes** de repartir. Solo si hay alguien arriba
hay algo que repartir:

| Ficha del solicitante | `segundo` | `informado` |
|---|---|---|
| Requiere 2ª firma, y hay alguien arriba | el abuelo | `null` |
| No la requiere, y hay alguien arriba | `null` | el abuelo |
| No hay nadie arriba (raíz, ciclo, jefe sin ficha activa) | `null` | `null` |

La última fila importa: apagar la casilla **no inventa un destinatario**. Si el
árbol se acaba en el jefe inmediato, no hay a quién informar y el correo sale
igual que hoy.

`aprobadoresDe` sigue recibiendo la ficha del solicitante como primer parámetro,
así que la llamada no cambia de forma: `Empleado` gana `requiereSegundaFirma` y
entra con él. `EmpleadoConJefatura` lo hereda.

Y el maestro que pinta el Organigrama necesita los **dos** resultados del
reparto, no solo el firmante: `EmpleadoConJefatura` gana `informadoCorreo` junto
al `segundoAprobadorCorreo` que ya tiene, ambos derivados de la misma llamada en
`empleadosConJefatura`. Sin esto, apagar la casilla dejaría `segundo` en `null` y
la columna no tendría el nombre que enseñar — pintaría «una sola firma» donde sí
hay alguien arriba, que es justo lo que esta feature quiere hacer visible.

## Por qué esto casi no toca el código

Es la razón de haber elegido este diseño frente al que primero se ocurre —un
booleano `requiere_segunda_firma` en la solicitud que cada lectura tiene que
consultar.

Con la casilla apagada, `segundo_aprobador_correo` se guarda como **`NULL`**. Y
`NULL` ahí **ya significa hoy** «una sola firma», por un camino escrito,
comentado y probado:

- `transicionAlDecidir` cierra en `aprobada` con la primera firma y sella las dos
  parejas de columnas.
- `puedeDecidir` no deja firmar a nadie en `pendiente_2`, porque nunca se llega a
  ese estado.
- `puedeVerAdjunto` no da acceso al de segundo nivel.
- El **historial de aprobaciones** no le cuenta la solicitud.
- El acuse al solicitante deja de anunciar «pasa por dos aprobaciones» — pasa a
  decir la verdad sin tocar el texto, porque ese cierre ya depende del campo.

La alternativa exigía que **cinco** lecturas de `segundo_aprobador_correo`
aprendieran a mirar un booleano, y que cuatro de ellas dijeran que no. Olvidar
una no rompe ningún test ni ningún portón: solo deja al de segundo nivel abriendo
soportes médicos que ya no le tocan. Es exactamente el modo de fallo que la
revisión de la sesión anterior encontró ocho veces — el comentario o el test que
deja de ser cierto sin que nada avise.

## El dato

Migración **023**, dos columnas y ningún `UPDATE`:

```sql
ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS requiere_segunda_firma BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS informado_correo VARCHAR(254);
```

`requiere_segunda_firma` es **sembrado uniforme**, así que va por `DEFAULT` como
la 021 y no necesita el bloque `DO $$` de la 022: toda la plantilla arranca con
doble firma y el día del despliegue no cambia nada para nadie. Las casillas se
apagan después, una a una, sin ninguna ventana en la que alguien apruebe solo por
error.

`informado_correo` no lleva valor: las solicitudes anteriores se quedan en `NULL`
y eso ya es correcto, porque todas nacieron con doble firma.

**La migración se añade al array `MIGRATIONS` de `db.ts`.** Olvidarlo no da
error: simplemente no se aplica.

## El alta

En `crearSolicitud`, el reparto ya viene resuelto y solo hay que guardarlo:

```ts
aprobadorCorreo:        firmantes ? firmantes.primero  : null,
segundoAprobadorCorreo: firmantes ? firmantes.segundo  : null,
informadoCorreo:        firmantes ? firmantes.informado : null,
```

Congelado, igual que los dos firmantes y por el mismo motivo. Aquí hay una
diferencia deliberada con `copia_correo`, que **no** se congela: la copia se lee
de la ficha al consultar, para que corregirla arregle lo que aún no ha salido. El
informado se congela porque nace del **árbol**, no de una preferencia de aviso, y
un cambio de organigrama a mitad de trámite no debe reescribir a quién se le
prometió el resultado.

`informado_correo` entra en `SELECT_SOLICITUD`, en `FilaSolicitudDb`, en
`aSolicitud`, en `DatosInsercion`, en el `INSERT`, en la interfaz `Solicitud` y en
el espejo manual de `apps/ausencias/src/api.ts`.

## Los correos

Un solo cambio, en `cadenaDeDecision`:

```ts
const cadenaDeDecision = (s: Solicitud) =>
  destinatarios(s.solicitanteEmail, s.aprobadorCorreo, s.segundoAprobadorCorreo, s.informadoCorreo, s.copiaCorreo);
```

`destinatarios` ya deduplica y ya filtra nulos, así que los dos campos conviven
sin ninguna rama: en una solicitud de doble firma el informado es `null` y no
aparece; en una de firma única el segundo es `null` y aparece el informado.

`cadenaDeDecision` la usan **la aprobación y el rechazo**, así que el informado se
entera de las dos. Esto va más allá de lo pedido —que hablaba del correo de
aprobación— y se hace a propósito: el argumento que ya está escrito en el código
para el rechazo (quien va a tener que reorganizar el trabajo tiene que enterarse)
vale igual cuando esa persona no firma.

Lo que el informado **no** recibe: el acuse del alta ni el aviso de aprobación
pendiente. Solo el veredicto.

## El panel

Cuarto endpoint del Organigrama, con `requireAuth` + `requireAdmin` como los
otros tres:

```
PUT /ausencias/empleados/:id/segunda-firma   { requiereSegundaFirma: boolean }
```

Devuelve el `EmpleadoConJefatura` actualizado. Detrás, un `fijarSegundaFirma`
calcado de `fijarVisor` **sin el registro de auditoría**: comprueba que el cuerpo
trae un booleano y que el empleado existe, y nada más. No hay ciclos que validar
—esto no es un árbol— ni correos que comprobar contra la plantilla.

Se mantiene el patrón de **un endpoint por campo**, por lo mismo que se decidió en
la 022: unificar en un `PATCH` obligaría a rehacer tres endpoints que ya pasaron
revisión.

El botón «Guardar» de la fila llama al nuevo **solo si el campo cambió**, en la
misma cadena secuencial que ya existe, y `haCambiado` gana la cuarta condición.
No se toca `cargar()`, que es lo que conserva las ediciones en curso de las demás
filas.

La columna «2ª firma» pasa de texto muerto a llevar la casilla y decir en qué
queda:

| Casilla | Hay alguien arriba | Qué se lee |
|---|---|---|
| Marcada | Sí | el nombre de quien firma (como hoy) |
| Marcada | No | `— una sola firma` (como hoy) |
| Desmarcada | Sí | `<nombre> — solo informado`, en gris |
| Desmarcada | No | `— una sola firma` |

La casilla se puede marcar aunque no haya nadie arriba: no hace nada, y
deshabilitarla obligaría a acordarse de rehabilitarla al cambiar el jefe.

**El texto explicativo del panel cambia**, y no es cosmético. Hoy dice que la
segunda firma se deduce sola; tendrá que decir además que **el de segundo nivel
sigue recibiendo el correo del resultado aunque no firme**. La confusión que
costó media sesión la provocó exactamente una frase de la interfaz que decía qué
*no* daba una casilla sin decir qué *sí* ocurría.

## Alcance: lo que no entra

- **Registro de auditoría de esta casilla.** El cambio no da acceso a ningún dato
  personal, así que se queda al nivel del jefe y la copia, que tampoco se
  registran — no al de la llave de los soportes, que sí. Si algún día se quiere,
  el patrón de la 022 vale tal cual.
- **Doble firma por tipo de solicitud** (vacaciones sí, permisos no) y
  **interruptor global**. Se descartaron a favor del ámbito por trabajador.
- **Un tercer nivel de firma.** El árbol sigue teniendo como mucho dos.
- **Reescribir las solicitudes en vuelo** al cambiar la casilla.
- **Unificar los endpoints de empleado en un `PATCH`.**

## Pruebas

En hub-api, sobre los módulos puros que ya existen:

- `jerarquia.test.ts`: las tres filas de la tabla del reparto, y la invariante de
  que `segundo` e `informado` nunca coexisten.
- `notificaciones.test.ts`: el informado entra en la aprobación **y** en el
  rechazo; **no** entra en el acuse del alta ni en el aviso al aprobador; y no
  sale duplicado cuando coincide con la copia o con el jefe inmediato.
- `service.test.ts`: el alta congela el campo correcto según la casilla, y una
  incapacidad no congela ninguno de los tres.
- `router.test.ts`: el endpoint nuevo — 200 al encender y al apagar, **400** si el
  cuerpo no trae un booleano, **403** a quien no es admin, **404** si el empleado
  no existe.

**Dos candados que hay que falsar**, rompiendo el código a propósito y
comprobando que se ponen rojos: con la casilla apagada, el de segundo nivel **no
puede firmar** y **no puede abrir el adjunto**. Los dos pasan hoy por
construcción, y un test que pasa por construcción es el que un día deja de probar
lo que dice sin que nada avise.

`apps/ausencias` no tiene tests y su `typecheck` no es portón, así que los cuatro
estados de la columna se verifican **mirándolos en el navegador**. Los tres
portones de siempre cubren lo demás:

```
npm run build --workspace=apps/hub-api
npm run test  --workspace=apps/hub-api
npm run build --workspace=apps/portal
```

## Puesta en marcha

**hub-api primero, portal después.** hub-api trae la migración y el endpoint; el
portal, la casilla que lo llama. Entre los dos despliegues no hay ventana de
riesgo: todas las fichas arrancan con doble firma, que es el comportamiento
actual, y sin el portal nuevo nadie puede cambiarlas.

Verificación tras desplegar hub-api:

```sql
\c "zoho-hub"
SELECT count(*) FILTER (WHERE requiere_segunda_firma) AS con_doble,
       count(*) FILTER (WHERE NOT requiere_segunda_firma) AS con_una
  FROM portal.empleados WHERE activo;
```

Tienen que salir **todas** en `con_doble` y **cero** en `con_una`. Si la consulta
falla con `column ... does not exist`, la 023 no se aplicó — casi siempre por no
estar en el array `MIGRATIONS`.
