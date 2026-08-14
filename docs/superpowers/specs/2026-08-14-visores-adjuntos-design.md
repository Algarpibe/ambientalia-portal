# Diseño — Quién puede abrir cualquier soporte, configurable (app Vacaciones y Permisos)

## Objetivo

Que la lista de quién puede abrir **cualquier** adjunto de **cualquier** persona
se gestione desde el portal, en vez de estar escrita en el código.

Hoy es una constante:

```ts
export const VISORES_ADJUNTOS = ['comercial@ambientalia.com.co', 'administrativo@ambientalia.com.co'];
```

Añadir a alguien exige tocar el fichero y desplegar.

## Lo que ya funciona y NO cambia

Conviene dejarlo escrito, porque es lo que hizo falta aclarar para llegar hasta
aquí: **abrir un adjunto ya lo pueden hacer hoy** el solicitante, su **jefe
inmediato**, la **segunda firma** y cualquier **administrador**, además de los
dos buzones de la constante. Y no solo en teoría: la bandeja «Pendientes de
aprobar» monta la misma tabla que pinta el clip de descarga, así que el jefe
tiene el permiso y el botón en la pantalla donde aprueba.

Esta feature **no amplía** quién puede ver qué. Solo mueve la lista de los dos
buzones del código a la base de datos.

## El dato, y el problema del sembrado

Migración **022**: `ve_adjuntos BOOLEAN NOT NULL DEFAULT FALSE` en
`portal.empleados`.

El sembrado no se resuelve como el de `copia_correo`. Allí valía el mismo valor
para toda la plantilla y bastó un `DEFAULT`; aquí hay que poner `TRUE` **solo a
dos correos**, y eso pide un `UPDATE` — prohibido en este repo, porque las
migraciones se re-ejecutan en cada arranque y volvería a dar la llave a quien se
la hubieran quitado.

La salida es condicionar el `UPDATE` a que la columna **acabe de crearse**:

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'portal' AND table_name = 'empleados'
                    AND column_name = 've_adjuntos') THEN
    ALTER TABLE portal.empleados ADD COLUMN ve_adjuntos BOOLEAN NOT NULL DEFAULT FALSE;
    EXECUTE $upd$
      UPDATE portal.empleados SET ve_adjuntos = TRUE
       WHERE lower(correo) IN ('comercial@ambientalia.com.co', 'administrativo@ambientalia.com.co')
    $upd$;
  END IF;
END $$;
```

En los arranques siguientes la columna ya existe, no se entra en el `IF` y nada
se toca. El repo ya usa `DO $$` en la migración 018.

**El `UPDATE` va dentro de un `EXECUTE`, y no suelto, a propósito.** Una sentencia
SQL estática dentro de plpgsql se planifica contra el catálogo, y aquí referencia
una columna que se crea en la línea de arriba, en el mismo bloque. `EXECUTE`
difiere el análisis hasta el momento de ejecutarlo, cuando la columna ya existe
sin lugar a dudas. No es una precaución gratuita: si eso fallara, la migración
lanza, **`initDb()` no captura errores y hub-api no arranca** — y con él se cae
el portal entero.

**Ojo con el orden:** este bloque depende de que los dos correos tengan ficha en
`portal.empleados`. Si alguno no la tuviera el día del despliegue, ese buzón se
quedaría sin la llave en silencio — que es justo el fallo que esta migración
existe para no provocar. La verificación posterior lo cubre.

## La función pura se queda pura

`puedeVerAdjunto(sesion, adjunto)` es pura y tiene tests. Eso es un invariante
del proyecto: las reglas viven en módulos puros y probables, porque **no hay
Postgres en ningún test**.

Si `esVisorDeAdjuntos` pasara a consultar la base, esa propiedad se pierde. Así
que el dato entra **por parámetro**:

```ts
puedeVerAdjunto(sesion: Sesion, a: repo.AdjuntoCompleto, esVisor: boolean): boolean
```

El router resuelve el booleano con `repo.esVisorDeAdjuntos(db, email)` y se lo
pasa. La regla sigue siendo probable sin base de datos; solo se mueve de dónde
sale el dato.

Los tres sitios que hoy consultan la constante pasan a consultar la base:

- `GET /ausencias/adjuntos/:id` — el permiso de descarga.
- `GET /ausencias/adjuntos` — la lista de la pestaña.
- `GET /ausencias/contexto` — el campo `esVisorAdjuntos`, que decide si la
  pestaña «Soportes adjuntos» aparece.

`VISORES_ADJUNTOS` desaparece de `config.ts`, igual que `COPIA_ADMINISTRACION`.
Su comentario sobre la Ley 1581 no se pierde: se traslada a la documentación y al
aviso del panel, que es donde ahora lo va a leer quien tome la decisión.

## El registro de cambios

Tabla nueva, en la misma migración 022:

```sql
CREATE TABLE IF NOT EXISTS portal.visores_adjuntos_log (
  id              BIGSERIAL   PRIMARY KEY,
  admin_email     VARCHAR(254) NOT NULL,
  empleado_id     UUID         NOT NULL,
  empleado_correo VARCHAR(254) NOT NULL,
  concedido       BOOLEAN      NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

**En base de datos y no por `stdout`**, que es lo que hace el `AuditLogger` de la
gestión de usuarios. El motivo es concreto: en cuanto la lista sale del código,
git deja de ser el historial de quién dio acceso a datos de salud, y los logs de
EasyPanel se rotan. Un registro que se borra solo no sirve para lo que este
registro existe.

Se guarda **el correo además del id**: si la ficha se borra, el registro tiene
que seguir diciendo a quién se le dio la llave. Sin `ON DELETE CASCADE` ni clave
foránea, a propósito — un registro de auditoría que desaparece con su sujeto no
es un registro de auditoría.

Solo se escribe cuando el valor **cambia**, y la comprobación va en el servicio:
`fijarVisor` lee la ficha, y si `ve_adjuntos` ya vale lo que se pide, devuelve el
empleado sin escribir ni en la tabla ni en el registro. Pulsar «Guardar» sin
tocar la casilla no deja rastro, o el registro se llenaría de ruido y dejaría de
leerse — y un registro que nadie lee no es un control, es un fichero que crece.

`EmpleadoConJefatura` gana `veAdjuntos: boolean`, que es lo que la casilla del
panel pinta y lo que el endpoint devuelve tras el cambio.

## El endpoint y la pantalla

```
PUT /ausencias/empleados/:id/visor   { veAdjuntos: boolean }
```

`requireAuth` + `requireAdmin`, como los de jefe y copia. Devuelve el
`EmpleadoConJefatura` actualizado.

Se mantiene el patrón de **un endpoint por campo** en vez de unificar los tres en
un `PATCH`. Unificar sería más limpio con tres campos, pero obliga a rehacer dos
endpoints que acaban de pasar revisión, y el coste real de tenerlos sueltos es
que guardar los tres campos a la vez hace tres llamadas — algo que casi nunca
ocurrirá.

En el **Organigrama**, una cuarta columna con una casilla. El botón «Guardar» ya
manda solo lo que cambió; se le añade la tercera condición.

El aviso ámbar del panel pasa a explicar qué es esa casilla: que abre **cualquier**
soporte de **cualquier** persona, incluidos los médicos de las incapacidades, y
que por eso la lista debe quedarse corta y cada persona estar justificada.

## Alcance: lo que no entra

- **El log de descargas** (quién abrió qué PDF). Va en su propia spec. La
  consecuencia, dicha explícitamente: al terminar esto se sabrá **quién tenía**
  acceso y desde cuándo, pero no **quién lo usó**.
- **El resto de `puedeVerAdjunto`.** El solicitante, el jefe inmediato, la
  segunda firma y los administradores siguen exactamente igual.
- **Una pantalla para consultar el registro.** Se escribe y se consulta por SQL.
  Añadir el visor es trabajo aparte, y sin él el registro ya cumple su función.
- **Unificar los tres endpoints de empleado en un `PATCH`.**

## Pruebas

En hub-api:

- `puedeVerAdjunto` con `esVisor: true` y `false`, y que el `false` **no** quita
  el acceso a quien ya lo tiene por ser solicitante, aprobador o admin.
- `PUT /ausencias/empleados/:id/visor`: 200 al dar, 200 al quitar, **403** a quien
  no es admin, **400** si `veAdjuntos` no es booleano, **404** si el empleado no
  existe.
- Que se escribe **una** fila de registro al cambiar, y **ninguna** cuando el
  valor no cambia.
- Que quitarle la llave a alguien le cierra de verdad la descarga (el gating de
  extremo a extremo, no solo la función pura).

`apps/ausencias` no tiene tests; su cobertura es el `tsc -b` del portal.

## Puesta en marcha

**hub-api primero, portal después.** hub-api trae la migración y el endpoint; el
portal, la casilla que lo llama.

En el log tiene que aparecer `migration applied: 022_...`. La migración es
aditiva y no destruye nada.

**Verificación imprescindible tras desplegar hub-api**, antes de dar la feature
por buena:

```sql
SELECT correo, ve_adjuntos FROM portal.empleados WHERE ve_adjuntos;
```

Tienen que salir exactamente `comercial@` y `administrativo@`. Si falta alguno,
es que su ficha no existía cuando corrió el sembrado y hay que darle la llave a
mano desde el panel — y entonces esa persona ha estado sin acceso desde el
despliegue.
