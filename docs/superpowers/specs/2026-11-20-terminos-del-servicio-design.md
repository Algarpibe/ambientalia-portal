# Portal — condiciones de uso y tratamiento de datos, con constancia de aceptación

**Fecha:** 2026-11-20
**Estado:** fusionado en `main` (merge `d00858b`; plan
`docs/superpowers/plans/2026-11-20-terminos-del-servicio.md`), con fecha de vigencia 23 de noviembre
de 2026; pendiente de desplegar ese día (hub-api primero, luego el portal).
**Depende de:** la gestión de usuarios (`apps/hub-api/src/users/`), el registro y el acceso del portal
(`apps/portal/src/components/Auth/AuthRightPanel.tsx`, `RequireAuth.tsx`) y la página de Ajustes
(`apps/portal/src/pages/Configuracion.tsx`).
**Fuente del texto:** `docs/Politica_Tratamiento_Datos_Portal_v1.0_BORRADOR.docx` (ignorado por Git:
`*.docx`). El texto definitivo de la v1.0, con los cambios acordados, está en el **Anexo** de este
documento, que es lo que se implementa.

## 1. Objetivo

Que el portal tenga sus condiciones de uso y su política de tratamiento de datos personales a la vista,
y que guarde constancia de quién las aceptó, qué versión y cuándo: la prueba de autorización que piden
la Ley 1581 de 2012 y el Decreto 1377 de 2013.

Hoy el registro tiene la casilla «Acepto todos los términos de servicio», pero su enlace es `href="#"`
(no hay texto) y la aceptación no llega al servidor: no queda constancia de nada. Los usuarios que ya
tienen cuenta nunca aceptaron nada.

## 2. Decisiones (cerradas en brainstorming)

- **Página y constancia** (opción 2): página pública con el texto y registro de cada aceptación.
- **Cuándo se pide:** a quien no tenga aceptada la versión vigente, en su siguiente acceso al portal
  (incluidas las sesiones ya abiertas, en la siguiente carga de página). Quien se registra la acepta en
  la casilla del registro. Cuando cambie la versión, se vuelve a pedir.
- **Cómo:** una pantalla intermedia en el portal (opción 1). No se bloquea en hub-api: `requireAuth`
  no se toca. La prueba legal es el registro de la aceptación; la interfaz no deja seguir sin aceptar.
- **Texto:** el del borrador `.docx`, con estos cambios:
  - Domicilio: **Calle 86 # 24-27, Bogotá D.C., Colombia** (el borrador decía otra dirección).
  - Canal de contacto: **comercial@ambientalia.com.co**, como en el borrador (decisión del usuario,
    sabiendo que es la cuenta de administrador y que quedará en una página pública y en el repo).
  - §2.4: **sin la promesa** de «autorización expresa y separada antes de la primera carga» de soportes
    de incapacidad, que Ausencias no implementa. Esa autorización será una función aparte (v1.1),
    después de la revisión legal.
  - §2.4: la lista de quién ve los soportes se corrige a lo que hace el código (ver §6).
  - §2.8: plazos de conservación de **3 años**; fecha de vigencia, la del despliegue.
  - Sin la sección «Pendientes de la empresa (no se publica)».
  - Corregido antes de publicar, tras la revisión final: el §2.5 omitía los datos de Ausencias que
    pasan por Google Calendar y Sheets; el §2.2 omitía el cargo y las notas de los administradores;
    el §2.4 ahora dice qué muestra el calendario compartido de ausencias; y el §2.8 ya no promete
    que la foto se pueda retirar (el portal no tiene cómo y desactivar la cuenta no la borra).
- **Constancia mínima:** usuario, versión y fecha. Ni IP ni navegador: el texto promete «fecha y
  versión», y guardar más obligaría a declararlo en el §2.2.

## 3. Comportamiento

| Situación | Qué pasa |
|---|---|
| Registro nuevo con la casilla marcada | hub-api crea la cuenta y guarda la aceptación de la versión vigente. En su primer acceso no ve la pantalla. |
| Usuario con sesión (nueva o ya abierta) sin la versión vigente aceptada | Pantalla intermedia a pantalla completa en cualquier ruta protegida: el portal, la TV del taller y «Mis equipos». |
| Acepta | hub-api guarda la aceptación; la pantalla desaparece y sigue a la ruta que pedía. |
| «Salir» | Cierra la sesión (`logout`) y vuelve a «Iniciar sesión». |
| `/users/me` falla o viene de un hub-api sin `terms` | No se muestra la pantalla (se deja pasar); se pedirá en la siguiente carga que funcione. Un fallo pasajero no deja a nadie fuera. |
| Fallo al guardar la aceptación | Aviso «No se pudo guardar tu aceptación. Inténtalo de nuevo.»; la pantalla sigue. |
| Versión nueva publicada | La misma pantalla aparece a todos, también a quien aceptó la anterior. |

## 4. hub-api

| Pieza | Cambio |
|---|---|
| Migración `079_terms_acceptances.sql` | `portal.terms_acceptances (user_id UUID NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE, version TEXT NOT NULL, accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, version))`. Idempotente, en el array `MIGRATIONS` de `db.ts`, con el bloque de permisos DATA-332 (`GRANT … TO portal_app`). |
| Versión vigente | Constante `CURRENT_TERMS_VERSION = '1.0'` en el módulo de usuarios. |
| Repositorio | Guardar una aceptación (`INSERT … ON CONFLICT DO NOTHING`) y saber si un usuario aceptó una versión. |
| `GET /api/users/me` | Añade `terms: { current: '1.0', accepted: boolean }`. |
| `POST /api/users/me/terms` `{ version }` | `requireAuth`. Versión distinta de la vigente → 400 `invalid_terms_version`. Si ya estaba aceptada, no cambia nada. Éxito → 200 `{ accepted: true }`. |
| `POST /api/auth/register` | Acepta `termsVersion` opcional. Si es la vigente, guarda la aceptación al crear la cuenta. Si falta o no coincide, crea la cuenta igual (sin constancia): la pantalla se la pedirá en su primer acceso. Así un portal antiguo, durante el despliegue, sigue pudiendo registrar. |

- Logs con `user_id`, nunca con el correo.
- `POST /users/me/terms` pasa por el limitador de `/users/*` (20 por minuto por IP), como el resto.
- Un borrado de cuenta arrastra sus aceptaciones (`ON DELETE CASCADE`): coherente con la supresión.
- `portal_app` solo puede leer e insertar en la tabla (`GRANT SELECT, INSERT` y `REVOKE UPDATE,
  DELETE, TRUNCATE`, como la 070): la constancia no se puede reescribir ni borrar desde la
  aplicación. La cascada no necesita ese permiso, porque Postgres la ejecuta con los del dueño de la
  tabla.

**Norma de uso (decisión del usuario, 2026-11-21).** Eliminar una cuenta borra en cascada su
constancia, pero NO borra su ficha de empleado, sus ausencias ni sus soportes
(`portal.empleados.user_id` es `ON DELETE SET NULL`), que el §2.8 conserva 3 años. Por eso:

- A quien deja la compañía se le **desactiva** la cuenta; no se elimina hasta que pasen los 3 años
  del §2.8 («se desactiva y se elimina a los 3 años»).
- «Eliminar» queda para registros que nunca llegaron a ser empleados (solicitudes de acceso
  rechazadas o de prueba).
- No hay cambio de código: es una regla de operación. Queda en los pendientes de la revisión legal,
  junto con la tabla de conservación. La alternativa descartada era impedir en la base de datos
  eliminar cuentas que ya aceptaron (`ON DELETE RESTRICT`), que obligaba a tocar el panel de
  usuarios y bloqueaba borrar registros basura.

## 5. Portal

| Pieza | Cambio |
|---|---|
| `src/legal/terminos.ts` (nuevo) | El texto del Anexo como datos estructurados (secciones, párrafos, listas y tablas), más `TERMS_VERSION = '1.0'` y `TERMS_EFFECTIVE_DATE`. Sin dependencias nuevas (nada de librerías de Markdown). |
| `/terminos` (nueva, pública) | Página fuera de `RequireAuth` que pinta ese texto, con el estilo del portal y legible en el celular. |
| Pantalla de aceptación (nueva) | Componente dentro de `RequireAuth`, para que cubra todas las rutas protegidas. Lee `terms` de `/api/users/me`. Mientras carga no muestra la pantalla ni parpadea. |
| Registro (`AuthRightPanel.tsx`) | Texto de la casilla: «Acepto las condiciones de uso y autorizo el tratamiento de mis datos personales según la política de AMBIENTALIA S.A.S.», con «condiciones de uso» enlazando a `/terminos` en pestaña nueva. Envía `termsVersion: TERMS_VERSION`. |
| Ajustes (`Configuracion.tsx`) | Enlace «Condiciones de uso y datos personales» a `/terminos`. |

**Textos de la pantalla de aceptación:**

- Título: «Condiciones de uso y tratamiento de datos»
- Texto: «Para seguir usando el portal, lee y acepta las condiciones de uso y la política de tratamiento
  de datos personales de AMBIENTALIA S.A.S. (versión 1.0).»
- Enlace: «Leer el documento completo» → `/terminos` en pestaña nueva.
- Casilla: el mismo texto que la del registro.
- Botones: «Aceptar y continuar» (deshabilitado hasta marcar la casilla y mientras se guarda) y «Salir».

**Candados:**

- Test en hub-api que lee `apps/portal/src/legal/terminos.ts` como texto y falla si `TERMS_VERSION`
  no coincide con `CURRENT_TERMS_VERSION` (mismo patrón que el catálogo de apps de los correos de
  acceso: hub-api no puede importar del portal).
- Test en el portal que falla si el texto publicado contiene un hueco `[` … `]`: imposible publicar
  con «[plazo por definir]» o «[fecha de aprobación]».

## 6. Quién ve los soportes (comprobado en el código)

`puedeVerAdjunto` (`apps/hub-api/src/ausencias/service/registro.ts:91-116`) deja abrir un soporte a:

- quien hizo la solicitud;
- su primer y su segundo aprobador;
- quien tiene la llave «Soportes» (`ve_adjuntos`) y el solicitante está en su rama de dos niveles;
- **cualquier administrador del portal**, sin recorte.

La frase del borrador «Solo los ven el usuario y las personas encargadas de aprobar y tramitar
ausencias» omitía a los administradores. El Anexo la sustituye por una que dice exactamente esto.

## 7. Tests

- **hub-api** (`users.integration.test.ts`, supertest con el pool falso, sin Docker):
  - `GET /users/me` devuelve `terms.current` y `terms.accepted` (falso sin aceptación, verdadero con ella).
  - `POST /users/me/terms`: 401 sin token; 400 con otra versión; 200 y queda aceptada; repetir no falla.
  - Registro con `termsVersion` vigente → aceptación guardada; sin ella o con otra → cuenta creada
    sin aceptación.
- **hub-api** (`*.db.test.ts`, con Docker): la migración 079 crea la tabla, la clave primaria evita
  duplicados y el borrado de la cuenta arrastra sus aceptaciones. Es la primera vez que estas
  consultas tocan Postgres real; el pool falso no valida SQL.
- **Candado de versión** (hub-api) y **candado de huecos** (portal), del §5.
- **Portal:**
  - Pantalla de aceptación: aparece con `accepted: false`; no aparece con `true`, sin `terms`, ni si
    `/users/me` falla; el botón está deshabilitado hasta marcar la casilla; aceptar llama a
    `POST /api/users/me/terms` con la versión y la quita; un fallo muestra el aviso y la mantiene;
    «Salir» cierra la sesión.
  - Registro: el enlace apunta a `/terminos` y el envío lleva `termsVersion`.
  - `/terminos`: pinta el título, la versión, la fecha y las secciones; accesible sin sesión.

## 8. Despliegue

hub-api primero (migración 079 y rutas), luego el portal. En cualquier orden no rompe nada:

- Portal nuevo con hub-api viejo: `/users/me` sin `terms` → no hay pantalla; el registro manda un campo
  que hub-api ignora.
- hub-api nuevo con portal viejo: `terms` se ignora; los registros no traen `termsVersion` y la
  aceptación se pedirá cuando llegue el portal nuevo.

La **fecha de vigencia** (`TERMS_EFFECTIVE_DATE` y el texto del §2.8) se fija en el último commit antes
de fusionar, con el día en que el usuario vaya a desplegar el portal.

## 9. Fuera de alcance

- La autorización separada para los soportes de incapacidad en Ausencias (v1.1, tras la revisión legal).
- El borrado automático de los datos a los 3 años: hoy habría que hacerlo a mano.
- Una vista de las aceptaciones en el panel de administración. Si alguien pide prueba de su
  autorización (§2.6), se consulta la tabla.
- Bloquear la API en hub-api para quien no haya aceptado.
- Pendiente de la revisión legal: decidir si el calendario compartido debe mostrar «Ausencia» en
  lugar de «Incapacidad» (es un cambio en Ausencias, fuera de esta rama).

---

## Anexo — Texto de la versión 1.0

> Lo que se publica en `/terminos`. `{fecha de vigencia}` se sustituye por la fecha del despliegue
> (§8); no puede quedar ningún otro hueco.

### Condiciones de uso y política de tratamiento de datos personales — Portal de aplicaciones

Este documento reúne las condiciones de uso del portal de aplicaciones internas de AMBIENTALIA S.A.S.
y la política con la que la compañía trata los datos personales de quienes lo usan. Al ingresar al
portal, el usuario acepta ambas.

Versión 1.0 · Vigente desde {fecha de vigencia}

#### 1. Condiciones de uso

**1.1 Quién puede usarlo.** El portal es para empleados y colaboradores de AMBIENTALIA. La cuenta
solo queda activa después de que un administrador la aprueba.

**1.2 Cuenta.** La cuenta es personal e intransferible. La contraseña no se comparte con nadie. Si
otra persona la conoce o el usuario sospecha un acceso indebido, debe avisar de inmediato a un
administrador. AMBIENTALIA puede desactivar la cuenta en cualquier momento, y lo hará cuando termine el
vínculo con la compañía.

**1.3 Uso aceptable.** El portal se usa solo para el trabajo. No está permitido sacar información
fuera de la compañía, intentar entrar a aplicaciones que no han sido asignadas ni automatizar accesos.
El incumplimiento puede llevar a la desactivación de la cuenta y a las medidas previstas en el
Reglamento Interno de Trabajo.

**1.4 Confidencialidad.** El portal muestra información de clientes, contabilidad e inventario. Esa
información es confidencial: no se divulga ni se comparte con terceros, durante el vínculo con la
compañía ni después de terminado.

**1.5 Registro de actividad.** Por seguridad y auditoría, el portal registra las acciones de
administración y los errores técnicos. Los errores se registran con el servicio Sentry.

**1.6 Disponibilidad.** AMBIENTALIA no garantiza un servicio continuo. El portal puede tener
interrupciones por mantenimiento o por fallas.

**1.7 Cambios.** Estas condiciones y la política de tratamiento de datos llevan número de versión y
fecha. Cuando cambien, el portal lo avisará a los usuarios.

#### 2. Política de tratamiento de datos personales

AMBIENTALIA trata los datos personales de los usuarios del portal conforme a la Ley 1581 de 2012 y al
Decreto 1377 de 2013, compilado en el Decreto 1074 de 2015.

**2.1 Responsable del tratamiento**

| Dato | Información |
|---|---|
| Razón social | AMBIENTALIA S.A.S. |
| NIT | 900.700.933-5 |
| Domicilio | Calle 86 # 24-27, Bogotá D.C., Colombia |
| Canal de contacto | comercial@ambientalia.com.co |

**2.2 Datos que se tratan**

| Dato | Detalle |
|---|---|
| Nombre, correo y rol | Los registra el usuario al crear la cuenta; el rol lo asigna un administrador |
| Contraseña | Se guarda solo como huella cifrada; nadie en la compañía puede conocerla |
| Foto de perfil | Opcional; solo si el usuario decide subirla |
| Ausencias | Fechas, tipo de ausencia, comentarios y soportes que el usuario carga en Ausencias, y el cargo de su ficha de empleado |
| Notas de los administradores | Notas internas sobre retrasos o solicitudes de ausencia; solo las ven los administradores |

El portal registra además las acciones de administración y los errores técnicos, que pueden quedar
asociados al usuario que los originó.

**2.3 Finalidad**

Los datos se usan únicamente para:

- Gestionar el acceso al portal: crear, aprobar, administrar y desactivar cuentas.
- Operar las aplicaciones internas, incluida la gestión de ausencias.
- Enviar los correos de acceso y de recuperación de contraseña.
- Mantener la seguridad del portal y permitir su auditoría.

AMBIENTALIA no usa estos datos con fines comerciales ni los entrega a terceros para fines propios de
estos.

**2.4 Autorización y datos sensibles**

El tratamiento se basa en la autorización previa, expresa e informada del usuario, que la otorga al
aceptar esta política al crear su cuenta o, si ya la tenía, en su siguiente ingreso al portal. Cuando
la política cambie de versión, el portal pedirá aceptarla de nuevo. El portal guarda constancia de cada
aceptación, con fecha y versión.

Los soportes de incapacidad que se cargan en Ausencias contienen datos de salud, que la ley considera
sensibles. Para ellos:

- El usuario no está obligado a autorizar el tratamiento de datos sensibles.
- Solo se usan para tramitar y soportar la ausencia.
- Solo los ven el usuario, quienes aprueban su solicitud, las personas que AMBIENTALIA autoriza
  expresamente para tramitar ausencias y los administradores del portal.
- El calendario de ausencias compartido con el personal muestra el tipo de ausencia, incluida «Incapacidad», y el nombre de la persona; los documentos de soporte no se publican en él.

**2.5 Terceros que procesan datos**

Estos proveedores procesan datos por cuenta de AMBIENTALIA, solo para las finalidades de esta
política:

| Proveedor | Servicio | Datos |
|---|---|---|
| Hostinger | Alojamiento del portal y de su base de datos | Todos los datos del portal |
| Google (Gmail, Calendar y Sheets), mediante n8n | Correos del portal y de Ausencias; calendario de ausencias del personal y hoja de registro que usa nómina | Nombre y correo; en Ausencias, además el tipo de ausencia, las fechas, los comentarios y el nombre del archivo del soporte |
| Sentry | Registro de errores técnicos | Datos técnicos del error, que pueden incluir el usuario afectado |

Algunos de estos proveedores tienen servidores fuera de Colombia, por lo que los datos pueden
almacenarse o procesarse en otros países. Al aceptar esta política, el usuario autoriza esa
transmisión.

**2.6 Derechos del titular**

El usuario puede, sin costo:

- Conocer, actualizar y rectificar sus datos.
- Solicitar la supresión de sus datos.
- Revocar la autorización.
- Solicitar prueba de la autorización y ser informado del uso que se ha dado a sus datos.
- Presentar una queja ante la Superintendencia de Industria y Comercio, después de haber tramitado la
  consulta o el reclamo ante AMBIENTALIA.

La supresión y la revocatoria no proceden mientras exista un deber legal o contractual de conservar los
datos.

**2.7 Procedimiento para ejercer los derechos**

Las solicitudes se envían a comercial@ambientalia.com.co con el asunto “Datos personales”, indicando
nombre, identificación y lo que se solicita.

| Trámite | Para qué sirve | Plazo de respuesta |
|---|---|---|
| Consulta | Conocer los datos que tiene el portal y cómo se usan | 10 días hábiles desde el recibo, prorrogables hasta por 5 más |
| Reclamo | Corregir, actualizar o suprimir datos, revocar la autorización o advertir un incumplimiento | 15 días hábiles desde el día siguiente al recibo, prorrogables hasta por 8 más |

Si AMBIENTALIA necesita la prórroga, informará antes del vencimiento el motivo y la nueva fecha. Si un
reclamo llega incompleto, pedirá completarlo dentro de los 5 días hábiles siguientes al recibo.

**2.8 Vigencia y conservación**

Esta política rige desde el {fecha de vigencia}. Los datos se conservan así:

| Dato | Conservación |
|---|---|
| Cuenta: nombre, correo, rol y huella de la contraseña | Mientras dure el vínculo con la compañía; después la cuenta se desactiva y se elimina a los 3 años |
| Foto de perfil | Mientras exista la cuenta |
| Ausencias y sus soportes | 3 años después de terminado el vínculo con la compañía |
| Registros de administración y de errores | 3 años desde que se generan |

Vencidos estos plazos, los datos se eliminan, salvo que una norma obligue a conservarlos por más tiempo.

**Casilla del registro y de la pantalla de aceptación:** «Acepto las condiciones de uso y autorizo el
tratamiento de mis datos personales según la política de AMBIENTALIA S.A.S.»
