# Ausencias — el administrador registra una incapacidad a nombre de otro

**Fecha:** 2026-11-23
**Estado:** diseño aprobado; pendiente de plan.
**Depende de:** el alta de solicitudes (`service/solicitudes.ts`, `service/validacion.ts`), los
avisos (`notificaciones.ts`) y el Registro general (`RegistroGeneral.tsx`), en producción.

## 1. Objetivo

Que el administrador pueda registrar una **incapacidad** a nombre de cualquier empleado activo,
desde el Registro general, con los mismos efectos que si la hubiera registrado la propia persona.

Hoy no hay forma:

- la identidad del alta sale siempre de la sesión, y hay tests que lo fijan a propósito;
- la incapacidad tiene ventana: la fecha de inicio, como mucho, dos días atrás y nunca futura;
- el mensaje de `incapacidad_demasiado_antigua` dice «Habla con administración para que la
  registren ellos», pero administración solo puede corregir filas que ya existen (PATCH) o
  importar el histórico, que no manda correo ni toca el calendario ni la hoja de nómina.

## 2. Decisiones (cerradas en brainstorming)

- **Solo incapacidades.** Vacaciones y permisos se descartaron: pasan por la cadena de firmas y
  habría que decidir si nacen aprobadas o pendientes.
- **Fechas:** inicio en cualquier fecha pasada o hoy, nunca futura. El fin puede pasar de hoy,
  igual que para el empleado.
- **PDF obligatorio**, igual que para el empleado. No hay forma de añadir el adjunto después: el
  PATCH del Registro no toca adjuntos.
- **Mismos efectos que hoy**, con el correo adaptado: evento en el calendario de Staff, fila en
  la hoja de incapacidades de nómina, y acuse al empleado con copia a administración
  (`COPIA_INCAPACIDADES`) y a su copia. El texto no le da las gracias por reportarla: dice que la
  ha registrado administración.
- **Constancia guardada y visible:** columna nueva `registrada_por` y una etiqueta en el
  Registro general.
- **Dónde:** un botón «Registrar incapacidad» en el Registro general, solo para el administrador.

## 3. Enfoque

Una **ruta propia del administrador que reutiliza el núcleo del alta** (opción A).

- La ruta del empleado (`POST /api/ausencias/solicitudes`) no cambia. Sigue sacando la identidad
  de la sesión, y sus candados (`service.test.ts` «ignora cualquier empleadoId…» y los de
  `router.test.ts`) siguen valiendo tal cual.
- Lo delicado se comparte, no se copia: el candado por empleado (`conCandadoDelEmpleado`), la
  regla de no solaparse (`exigirSinSolape`), la inserción, el adjunto, los eventos de la cola y el
  apunte del calendario. El plan decide cómo extraer ese núcleo de `crearSolicitud` sin cambiar su
  comportamiento.

Descartadas:

- **B**, aceptar `empleadoId` en la ruta actual cuando llama un administrador: rompe a propósito
  esos candados y mezcla dos reglas en una puerta.
- **C**, reutilizar la importación del histórico: no emite eventos.

## 4. hub-api

### 4.1 Migración 080

```sql
ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS registrada_por VARCHAR(254);
```

- `NULL` significa que la registró la propia persona (o que viene de la hoja). Con valor, es el
  correo, en minúsculas, del administrador que la registró.
- `IF NOT EXISTS`: las migraciones se vuelven a ejecutar en cada arranque.
- Sin `GRANT` nuevo: es una columna de una tabla que `portal_app` ya tiene concedida. El plan lo
  verifica.
- El test que fija cuál es la última migración se releva a la 080.

### 4.2 Ruta

`POST /api/ausencias/solicitudes/incapacidad-ajena`, detrás de `requireAuth, requireAdmin`.

- Cuelga del prefijo `/api/ausencias/solicitudes`, así que usa el parser de 12 MB que ya existe:
  **no se monta otro parser antes de la autenticación**. Ninguna ruta `POST
  /ausencias/solicitudes/:id` existe con la que pueda chocar (las que hay tienen un segmento más).
- Cuerpo: `{ empleadoId, fechaInicio, fechaFin, comentarios?, adjunto }`. El `tipo` no viaja: el
  servidor lo fija en `incapacidad`.
- Respuesta 201: la solicitud creada, igual que el alta del empleado.

### 4.3 Validación

Lo mismo que `validarNuevaSolicitud` para una incapacidad, **salvo el límite hacia atrás**:

- `empleadoId` tiene que ser una cadena: si no, 400 `empleado_requerido`.
- Formato de fechas, `rango_invertido`, `MAX_DIAS_RANGO` y comentarios ≤ 2000, igual que hoy.
- `fechaInicio > hoy` → 400 `incapacidad_en_el_futuro` (el código que ya existe).
- **No** se aplica `incapacidad_demasiado_antigua`.
- Adjunto obligatorio (`adjunto_requerido`) y validado igual que hoy (`validarAdjunto`, 8 MiB,
  PDF); el nombre del fichero lo normaliza el servidor con el nombre del EMPLEADO.
- `dias` y las horas se rechazan, igual que hoy para una incapacidad.

### 4.4 Servicio

1. La ficha sale de `repo.empleadoPorId` (solo activas). Si no existe o está inactiva → 404
   `empleado_no_encontrado`.
2. Tope de la fecha de baja: `fechaFin > fechaRetiro` → 409 `fecha_posterior_al_retiro`, igual
   que hoy.
3. Nace `registrada`, sin aprobadores, con `solicitante_email` = correo del **empleado**. Así
   siguen valiendo los permisos que miran `solicitante_email`: él puede ver su propio PDF, y su
   jefe con llave también.
4. `registrada_por` = correo del administrador de la sesión.
5. Dentro del candado del empleado: regla de no solaparse (409 `rango_solapado` con su
   `detalle`), inserción, adjunto, evento `registrada` en la cola y apunte del calendario; después,
   el aviso a n8n. Todo exactamente igual que el alta del empleado.

### 4.5 El correo

`acuseSolicitante` con `registradaPor` puesto cambia solo el texto:

- Asunto: «Administración ha registrado tu incapacidad».
- Cuerpo: «¡Hola {nombre}!», «Administración ha registrado tu incapacidad en el portal. Este es el
  resumen:», el resumen, los comentarios y el adjunto de siempre, y «Esperamos tu pronta
  recuperación.».
- Destinatarios, calendario y hoja: sin cambios.

El campo `registradaPor` viaja en la `Solicitud` que usa el payload: lo lee `repo/filas.ts`.

### 4.6 Registro general

Las filas de solicitud del Registro llevan `registradaPor: string | null`. Las de modificación,
siempre `null`.

## 5. Pantalla (apps/ausencias)

### 5.1 Cliente

`registrarIncapacidadAjena({ empleadoId, fechaInicio, fechaFin, comentarios, adjunto })` →
`POST /api/ausencias/solicitudes/incapacidad-ajena`, con su propio lector de errores. Los
mensajes del alta del empleado le hablan al empleado («Tu último día…»), y aquí el lector es el
administrador:

- `rango_solapado` → «Esas fechas chocan con otra ausencia de esa persona: …», con el mismo
  detalle de tipo, fechas y estado que ya se redacta hoy.
- `fecha_posterior_al_retiro` → «El último día de esa persona en la compañía es el {fecha} y
  estas fechas lo pasan.».
- 404 con `empleado_no_encontrado` → «Esa ficha ya no está activa. Recarga la lista.». Un 404
  **sin** ese código, que es lo que daría un hub-api sin la ruta, sale por el mensaje genérico.
- `incapacidad_en_el_futuro` → «La fecha de inicio no puede ser futura.».
- El resto, por el lector que ya usa el alta del empleado para los errores de adjunto y fechas,
  si su texto no habla en segunda persona. Si habla en segunda persona, se reescribe en el lector
  nuevo. El plan revisa uno por uno.

### 5.2 Formulario

Botón «Registrar incapacidad» en el Registro general, visible solo con `esAdmin`. Abre un
formulario (componente propio, no `FormularioSolicitud`) con:

- **Persona:** desplegable de fichas activas, ordenado con `localeCompare(…, 'es')` y con
  «— Elige una persona —» como primera opción, como en `FormularioNota`. Las fichas ya las carga
  el Registro para el administrador (`fetchEmpleados`).
- **Inicio y fin:** `max` del inicio = hoy, sin `min`; el fin no puede ser anterior al inicio.
- **PDF:** obligatorio, `accept="application/pdf,.pdf"` y 8 MB, como en el formulario del
  empleado.
- **Comentarios:** opcionales.
- **Guardar:** desactivado mientras se guarda o falta algo obligatorio. **Cancelar** cierra sin
  guardar.

Al guardar bien: se cierra, aviso verde «Incapacidad de {nombre} registrada. Le hemos enviado el
acuse por correo.» y recarga del Registro. Si falla: el mensaje del lector, y el formulario sigue
abierto con lo rellenado.

### 5.3 La etiqueta

En la fila del Registro con `registradaPor`: una etiqueta pequeña «Registrada por
administración», con `title` = el correo de quien la registró. Se ve igual para el administrador
y para los jefes que ven esa fila.

### 5.4 Textos que dejan de ser falsos

- El comentario de `api/http.ts` que afirma «NO hay vía para que un admin dé de alta una
  incapacidad en nombre de otro» se actualiza.
- El mensaje de `incapacidad_demasiado_antigua` («Habla con administración para que la registren
  ellos») ya es cierto y se queda.

## 6. Verificación

- **Migración:** el test de la última migración pasa a la 080, y la columna existe y admite
  `NULL`.
- **BD (`*.db.test.ts`):**
  - el alta del administrador guarda `registrada_por`, `solicitante_email` = correo del
    empleado, estado `registrada`, el adjunto y el evento `registrada` en la cola;
  - el alta del empleado deja `registrada_por` en `NULL`;
  - la regla de no solaparse sigue mordiendo;
  - una ficha inactiva da 404.
- **Unitarios:**
  - la validación nueva acepta una fecha de hace un año y rechaza mañana;
  - sigue exigiendo el PDF;
  - rechaza la falta de `empleadoId`, `dias` y horas;
  - el correo con `registradaPor` cambia el texto y no los destinatarios.
- **Ruta (supertest con el doble):** 201 para el administrador; 403 para quien no lo es; 400, 404
  y 409 con su código. El doble de `router.test.ts` modela lo que cambie en `repo.ts`.
- **Front:** tests del lector de errores (incluido el 404 sin código) y del formulario en jsdom
  (desplegable, PDF obligatorio, inicio sin futuro, éxito, error con el formulario abierto), y la
  etiqueta en la fila. Portón: `npm run typecheck`, `npm test` y `npm run build`.
- **Candados que NO deben cambiar:** los de «la identidad sale de la sesión» del alta del
  empleado siguen en verde sin tocarlos.
- **Candados falsados** rompiendo el código de verdad (el `requireAdmin`, la exención de la
  ventana solo en esta ruta, el `solicitante_email` del empleado, el `registrada_por`, la regla
  de no solaparse).

## 7. Despliegue

hub-api primero (migración 080) y el portal después. Si el portal llegara antes, el botón
fallaría con el mensaje genérico de 404 y nada más se rompería.

## 8. Fuera de alcance

- Vacaciones, permisos y compensatorios a nombre de otro.
- Añadir o cambiar el adjunto de una incapacidad ya registrada.
- Una columna «Registrada por» en el CSV del Registro.
