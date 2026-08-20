# Requirements Document

## Introduction

El Portal Ambientalia necesita un área de gestión de usuarios que reemplace el modelo actual basado en variables de entorno. La funcionalidad abarca el registro por autoservicio (self-registration), la aprobación administrativa del acceso, la asignación de roles y el control granular sobre qué aplicaciones puede usar cada usuario aprobado.

El sistema interactúa con dos capas: el frontend (`portal`, React/TypeScript) y el backend (`hub-api`, Express/Node.js). Los usuarios se almacenan en la base de datos del hub (PostgreSQL), y el flujo de autenticación existente (JWT vía `/api/login`) se extiende para soportar el nuevo modelo.

---

## Glossary

- **Portal**: La aplicación React principal (`apps/portal`) que sirve de punto de entrada a todas las sub-aplicaciones.
- **Hub_API**: El servicio backend Express (`apps/hub-api`) que emite JWTs y expone la API de datos.
- **Usuario**: Persona que solicita acceso al Portal.
- **Administrador**: Usuario con el rol `admin` que puede aprobar, desactivar, eliminar usuarios y asignar aplicaciones.
- **Lector**: Usuario con el rol `reader` que tiene acceso de solo lectura a las aplicaciones asignadas.
- **Aplicacion**: Cada una de las sub-aplicaciones del monorepo (p.ej. `customer-profitability`, `payment-reconciliation`).
- **Registro_Pendiente**: Estado de un Usuario que se ha registrado pero cuyo acceso no ha sido aprobado aún.
- **Usuario_Activo**: Estado de un Usuario cuyo acceso ha sido aprobado y no ha sido desactivado.
- **Usuario_Inactivo**: Estado de un Usuario que ha sido desactivado por un Administrador.
- **JWT**: Token JSON Web Token firmado con `JWT_SECRET`, emitido por Hub_API tras un login exitoso.
- **Panel_Admin**: Sección del Portal accesible solo a Administradores donde se gestiona la lista de usuarios.

---

## Requirements

### Requirement 1: Registro de Usuario por Autoservicio

**User Story:** Como visitante del portal, quiero poder registrarme con mi correo y contraseña, para solicitar acceso sin depender de que un administrador cree mi cuenta manualmente.

#### Acceptance Criteria

1. THE Portal SHALL mostrar un formulario de registro con los campos: nombre completo (máximo 100 caracteres), correo electrónico (máximo 254 caracteres) y contraseña.
2. WHEN un visitante envía el formulario de registro y todos los campos pasan la validación, THE Hub_API SHALL crear un Usuario en estado `pending` con los datos proporcionados y responder en un tiempo estrictamente inferior a 3 segundos; una respuesta que alcance exactamente 3 segundos se considera un fallo.
3. THE Hub_API SHALL almacenar la contraseña del Usuario como un hash bcrypt con factor de coste mínimo 12; nunca en texto plano.
4. IF un visitante intenta registrarse con un correo electrónico que ya existe en la base de datos, THEN THE Hub_API SHALL rechazar la solicitud con HTTP 409 y un mensaje de error indicando que el correo ya está registrado.
5. IF el correo electrónico enviado no tiene formato RFC 5321 válido, THEN THE Hub_API SHALL devolver HTTP 400 con un mensaje de error indicando formato de correo inválido.
6. IF la contraseña enviada tiene menos de 8 caracteres, THEN THE Hub_API SHALL devolver HTTP 400 con un mensaje de error indicando que la contraseña es demasiado corta.
7. IF el campo nombre completo está vacío o supera los 100 caracteres, THEN THE Hub_API SHALL devolver HTTP 400 con un mensaje de error indicando que el nombre completo es inválido.
8. WHEN el registro es exitoso, THE Portal SHALL mostrar un mensaje informando al Usuario que su solicitud está pendiente de aprobación y no emitir un JWT.
9. IF el registro falla por errores de validación, THEN THE Portal SHALL mostrar el mensaje de error correspondiente sin mostrar el mensaje de aprobación pendiente.

---

### Requirement 2: Aprobación, Desactivación y Eliminación de Usuarios

**User Story:** Como Administrador, quiero gestionar el ciclo de vida de los usuarios (aprobar, desactivar o eliminar), para controlar quién tiene acceso al portal en todo momento.

#### Acceptance Criteria

1. WHILE un Usuario autenticado tiene el rol `admin`, THE Panel_Admin SHALL mostrar la lista completa de usuarios con su estado (`pending`, `active`, `inactive`), nombre, correo y fecha de registro, con paginación de hasta 50 usuarios por página.
2. WHEN un Administrador aprueba un Registro_Pendiente, THE Hub_API SHALL cambiar el estado del Usuario a `active` y devolver HTTP 200 confirmando el cambio.
3. WHEN un Administrador desactiva un Usuario_Activo, THE Hub_API SHALL cambiar el estado del Usuario a `inactive` y devolver HTTP 200 confirmando el cambio.
4. WHEN el estado de un Usuario cambia a `inactive`, THE Hub_API SHALL rechazar el JWT del Usuario devolviendo HTTP 401 en la siguiente petición autenticada.
5. WHEN un Administrador reactiva un Usuario_Inactivo, THE Hub_API SHALL cambiar el estado del Usuario a `active` y devolver HTTP 200 confirmando el cambio.
6. WHEN un Administrador elimina un Usuario, THE Hub_API SHALL eliminar el registro del Usuario de la base de datos de forma permanente y devolver HTTP 200 confirmando la eliminación.
7. IF un Administrador intenta eliminar o desactivar su propia cuenta, THEN THE Hub_API SHALL rechazar la operación con HTTP 403 y un mensaje de error indicando que no es posible modificar la propia cuenta; el estado del Administrador no SHALL ser alterado.
8. WHILE el estado de un Usuario no es `active`, THE Hub_API SHALL rechazar cualquier intento de login de ese Usuario con HTTP 403 y un mensaje de error indicando que la cuenta no ha sido aprobada.
9. IF una petición a un endpoint de gestión de usuarios llega sin JWT o con un JWT inválido, THEN THE Hub_API SHALL rechazar la petición con HTTP 401.
10. IF una petición a un endpoint de gestión de usuarios llega con un JWT válido cuyo payload no contiene `role: "admin"`, THEN THE Hub_API SHALL rechazar la petición con HTTP 403.
11. IF un Administrador intenta realizar una operación sobre un Usuario que no existe en la base de datos, THEN THE Hub_API SHALL devolver HTTP 404 y un mensaje de error indicando que el usuario no fue encontrado.

---

### Requirement 3: Asignación de Rol

**User Story:** Como Administrador, quiero asignar el rol `reader` o `admin` a cada usuario aprobado, para definir su nivel de acceso dentro del portal.

#### Acceptance Criteria

1. WHEN un Administrador aprueba un Registro_Pendiente, THE Hub_API SHALL asignar el rol `reader` al Usuario aprobado por defecto.
2. WHEN un Administrador cambia el rol de un Usuario_Activo, THE Hub_API SHALL actualizar el rol del usuario en la base de datos y devolver una respuesta de éxito; IF la actualización falla, THEN THE Hub_API SHALL devolver un mensaje de error indicando que el cambio de rol no pudo completarse sin modificar el rol previo.
3. THE Hub_API SHALL incluir el campo `role` (`"admin"` o `"reader"`) en el payload del JWT emitido en cada login exitoso.
4. WHEN un Usuario completa un login exitoso, IF el campo `role` del JWT es `"admin"`, THEN THE Portal SHALL mostrar el Panel_Admin en la navegación lateral; IF el campo `role` del JWT es `"reader"`, THEN THE Portal SHALL ocultar el Panel_Admin de la navegación lateral.
5. IF un Usuario con rol `reader` intenta acceder a un endpoint de gestión de usuarios cuyo recurso objetivo no pertenece al propio usuario autenticado (identificado por el `user_id` del JWT), THEN THE Hub_API SHALL rechazar la petición con HTTP 403 y un mensaje de error indicando permisos insuficientes.
6. IF un Usuario con rol `reader` intenta acceder a un endpoint de gestión cuyo recurso objetivo pertenece al propio usuario autenticado (identificado por el `user_id` del JWT), THEN THE Hub_API SHALL permitir la petición.
7. WHEN un Administrador cambia el rol de un Usuario_Activo, THE Hub_API SHALL aplicar el nuevo rol a partir del siguiente login exitoso del usuario; el JWT activo del usuario en sesiones en curso conservará el rol previo hasta su expiración.

---

### Requirement 4: Asignación de Aplicaciones por Usuario

**User Story:** Como Administrador, quiero asignar a cada usuario las aplicaciones específicas a las que puede acceder, para garantizar que cada persona solo vea lo que le corresponde.

#### Acceptance Criteria

1. THE Hub_API SHALL mantener una relación persistente y consultable entre cada Usuario_Activo y el conjunto de Aplicaciones a las que tiene acceso.
2. WHEN un Administrador asigna o revoca el acceso a una Aplicacion para un Usuario, THE Hub_API SHALL actualizar esa relación en la base de datos antes de emitir la respuesta de confirmación, de modo que el cambio sea efectivo en el próximo login del Usuario.
3. WHEN un login es exitoso, THE Hub_API SHALL incluir el campo `apps` en el payload del JWT con la lista de identificadores de Aplicacion asignados al Usuario; IF el Usuario no tiene ninguna Aplicacion asignada, THEN el campo `apps` SHALL contener una lista vacía.
4. WHEN el Portal carga la sesión de un Usuario, THE Portal SHALL leer el campo `apps` del JWT y mostrar únicamente las Aplicaciones cuyos identificadores figuren en esa lista en la navegación y en la página de Aplicaciones; IF el campo `apps` está vacío o ausente, THEN THE Portal SHALL mostrar la sección de Aplicaciones sin ninguna entrada.
5. IF un Usuario intenta navegar directamente a la ruta de una Aplicacion cuyo identificador no figura en el campo `apps` de su JWT, THEN THE Portal SHALL redirigir al Usuario a la página de inicio y mostrar una notificación visible al Usuario indicando acceso no autorizado.
6. IF el campo `apps` del JWT está malformado o tiene un tipo de dato inesperado, THEN THE Portal SHALL tratar la lista de aplicaciones asignadas como vacía y mostrar la sección de Aplicaciones sin ninguna entrada.

---

### Requirement 5: Seguridad del Panel de Administración

**User Story:** Como sistema, quiero que el Panel_Admin sea accesible solo a Administradores autenticados, para evitar que usuarios sin privilegios gestionen cuentas.

#### Acceptance Criteria

1. IF un Usuario no autenticado intenta acceder a cualquier ruta del Panel_Admin, THEN THE Portal SHALL redirigir al Usuario a la página de autenticación `/auth`.
2. IF un Usuario autenticado con rol `reader` intenta acceder a cualquier ruta del Panel_Admin, THEN THE Portal SHALL redirigir al Usuario a la página de inicio `/`.
3. IF un Usuario autenticado con un rol diferente a `admin` o `reader` intenta acceder a cualquier ruta del Panel_Admin, THEN THE Portal SHALL redirigir al Usuario a la página de inicio `/`.
4. THE Hub_API SHALL aplicar rate limiting de máximo 20 peticiones por minuto por dirección IP a los endpoints de gestión de usuarios; IF el límite es superado, THEN THE Hub_API SHALL devolver una respuesta de error indicando que el límite de peticiones ha sido alcanzado.
5. THE Hub_API SHALL registrar en el log del servidor cada operación de gestión de usuarios con: timestamp en formato ISO 8601 UTC, email del Administrador que ejecutó la acción, tipo de operación realizada y email del Usuario afectado.
6. WHEN la sesión de un Administrador expira mientras está dentro del Panel_Admin, THE Portal SHALL redirigir al Usuario a la página de autenticación `/auth` sin ejecutar ninguna operación de mutación de datos pendiente.

---

### Requirement 6: Persistencia de Usuarios en Base de Datos

**User Story:** Como sistema, quiero que los usuarios se almacenen en la base de datos del hub y no en variables de entorno, para poder gestionar el ciclo de vida de los usuarios de forma dinámica.

#### Acceptance Criteria

1. THE Hub_API SHALL leer y escribir los datos de usuarios desde una tabla `users` en el esquema de la base de datos configurada vía `HUB_DB_URL`; la tabla SHALL contener al menos los campos: identificador único, nombre completo (máximo 255 caracteres), correo electrónico único, contraseña hasheada, rol y estado.
2. THE Hub_API SHALL mantener compatibilidad con el endpoint de login JWT existente (`/api/login`) tras la migración a base de datos, de modo que credenciales válidas devuelvan un JWT con la misma estructura que antes de la migración.
3. IF `HUB_DB_URL` no está configurado al iniciar Hub_API, THEN THE Hub_API SHALL terminar el proceso con un mensaje de error indicando que la variable de entorno no está definida, en un plazo máximo de 5 segundos desde el inicio.
4. THE Hub_API SHALL usar transacciones de base de datos para operaciones de escritura que afecten a múltiples tablas; IF una transacción falla, THEN THE Hub_API SHALL revertir todos los cambios parciales y devolver un error al llamante.
5. IF la base de datos no es alcanzable al iniciar Hub_API, THEN THE Hub_API SHALL terminar el proceso con un mensaje de error indicando que la conexión a la base de datos falló.
6. IF una operación de lectura o escritura en la base de datos falla en tiempo de ejecución, THEN THE Hub_API SHALL devolver una respuesta de error al llamante sin ejecutar escrituras parciales y preservando el estado previo de los datos.
