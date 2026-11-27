# Diseño — Invitación al almuerzo de fin de año 2026

Aprobado el 2026-11-26.

## Objetivo

Una página del portal, a la que se llega con un link enviado por WhatsApp, donde
cada empleado con cuenta en el portal:

- confirma si asiste al almuerzo de fin de año, con su preferencia de menú;
- descarga su pase digital;
- sube su propia foto al muro del equipo;
- vota, de forma anónima para sus compañeros, las cualidades de los demás.

El administrador ve en la misma página quién va, quién no y quién no ha
respondido, y lo descarga en Excel para el restaurante.

La referencia visual es la invitación hecha con Gemini (un HTML estático en
tiiny.site). En ella nada se guarda: la foto, el brindis y la confirmación se
pierden al recargar. Esta versión conserva el aspecto y guarda todo en la BD.

## El evento

| Dato | Valor |
|---|---|
| Identificador | `fin-de-ano-2026` |
| Fecha y hora | viernes 18 de diciembre de 2026, 12:30 p. m. (Bogotá, UTC-5) |
| Fin (para el calendario) | 4:00 p. m. |
| Lugar | Restaurante Anfitriona, Cl. 83 Bis #24-09, Bogotá D.C. |
| Vestimenta | Smart casual |
| Cierre de confirmaciones | 4 de diciembre de 2026, 23:59:59 (Bogotá) |
| Cierre de votos | el inicio del evento (18 de diciembre, 12:30 p. m.) |

Plazo: el corte es el 4 de diciembre, así que la página debe estar en producción
hacia el 28 o 29 de noviembre para que el equipo tenga días para responder.

## Decisiones tomadas

1. **Con sesión.** La página exige login y la aceptación de las condiciones de
   uso (`RequireAuth`), pero **no** una app asignada: entra cualquier usuario
   activo. Cada uno confirma por sí mismo; no hay lista de nombres para elegir.
2. **El muro sale de los usuarios activos** del portal (`portal.users`,
   `status = 'active'`). Los nombres no pueden ir en el código porque el repo es
   público.
3. **Cada uno sube solo su foto.** Es la foto de perfil del portal
   (`portal.users.avatar`), la misma de Configuración, y se guarda con el
   endpoint que ya existe (`PATCH /api/users/me/avatar`). Cambia también en la
   barra superior y en el tablero del taller. Consecuencia: en esta página, la
   foto de perfil de cada uno la ven todos los usuarios activos.
4. **Votación de cualidades:**
   - Hay una lista fija de cualidades positivas (ver abajo).
   - «Enviar brindis» es votar: abre la lista y se marcan **hasta 3** cualidades
     para ese compañero.
   - Nadie puede votarse a sí mismo.
   - Los votos se pueden cambiar hasta el inicio del evento.
   - La tarjeta muestra las **3 más votadas con su número** (ej. «Empatía · 4»).
   - Es anónimo para los compañeros: la página nunca dice quién votó qué. La BD
     sí guarda quién votó, porque es la única forma de impedir votos repetidos.
5. **Confirmación «Sí voy» / «No podré ir»**, cambiable hasta el corte del
   4 de diciembre.
6. **Panel de admin con Excel**, en la misma página.

## Cualidades

Lista fija en hub-api. El portal la recibe del servidor; no tiene copia propia.

Liderazgo · Empatía · Compromiso · Creatividad · Trabajo en equipo ·
Proactividad · Alegría contagiosa · Organización · Precisión técnica ·
Confiabilidad · Generosidad · Perseverancia · Actitud resolutiva · Atención al
detalle · Compañerismo · Calidez humana · Visión estratégica · Espíritu positivo

## Preferencias de menú

| Código | Texto |
|---|---|
| `general` | Menú general (sin restricciones) |
| `vegetariano` | Opción vegetariana |
| `sin_gluten` | Sin gluten |
| `sin_mariscos` | Sin mariscos ni pescados |

## Arquitectura

### hub-api: módulo `celebracion/`

Router, servicio y repositorio, con el mismo patrón que `password-reset`: el
servicio depende de un puerto (`CelebracionStore`), que el repositorio SQL
implementa y los tests sustituyen por un falso. El reloj se inyecta.

La configuración del evento (tabla de arriba, cualidades y preferencias) vive en
un archivo de configuración del módulo. Es la única copia: el portal la lee por
la API y el servidor la usa para hacer cumplir los cierres.

### Migración 081

```sql
portal.celebracion_confirmaciones (
  evento          TEXT        NOT NULL,
  user_id         UUID        NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  asiste          BOOLEAN     NOT NULL,
  preferencia     TEXT        NULL,      -- solo si asiste
  mensaje         TEXT        NULL,      -- opcional, máx. 200 caracteres
  actualizado_en  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (evento, user_id)
)

portal.celebracion_votos (
  evento      TEXT        NOT NULL,
  votante_id  UUID        NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  votado_id   UUID        NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  cualidad    TEXT        NOT NULL,
  creado_en   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (evento, votante_id, votado_id, cualidad),
  CHECK (votante_id <> votado_id)
)
```

`ON DELETE CASCADE`, como en `user_apps` y `terms_acceptances`. El tope de 3
cualidades por compañero y la validez de la
cualidad y de la preferencia los hace cumplir el servicio, no la BD, porque las
listas viven en la configuración.

### Endpoints

Todos bajo `/api/celebracion`, con `requireAuth`. Los errores de validación
responden 400 o 409 con un código; **nunca 401**, porque el interceptor del
portal lo tomaría por una sesión caducada.

| Método y ruta | Quién | Qué hace |
|---|---|---|
| `GET /api/celebracion` | todos | Devuelve el evento (datos, cierres, cualidades, preferencias), el equipo (id, nombre, avatar y sus 3 cualidades más votadas con número), mi respuesta y mis votos. |
| `GET /api/celebracion/mi-estado` | todos | Versión ligera para el aviso del Inicio: si he respondido y si sigue abierto. |
| `PUT /api/celebracion/confirmacion` | todos | `{ asiste, preferencia?, mensaje? }`. Crea o reemplaza mi respuesta. |
| `PUT /api/celebracion/votos/:userId` | todos | `{ cualidades: string[] }`. Reemplaza mis votos a ese compañero (de 0 a 3). |
| `GET /api/celebracion/resumen` | admin (`requireAdmin`) | Totales (van, no van, sin responder), conteo por preferencia, y la lista completa: los que respondieron con su respuesta y los usuarios activos sin responder. |

Códigos de error:

| Código | Cuándo |
|---|---|
| `confirmaciones_cerradas` (409) | Confirmar después del 4 de diciembre. |
| `votos_cerrados` (409) | Votar después del inicio del evento. |
| `preferencia_invalida` (400) | Asiste y la preferencia no está en la lista, o no asiste y manda preferencia. |
| `mensaje_invalido` (400) | Más de 200 caracteres o caracteres de control. |
| `cualidad_invalida` (400) | Una cualidad que no está en la lista, o repetida. |
| `demasiadas_cualidades` (400) | Más de 3 para el mismo compañero. |
| `voto_propio` (400) | Votarse a sí mismo. |
| `usuario_no_valido` (400) | Votar a alguien que no existe o no está activo. |

Solo cuentan los usuarios activos: los votos y las respuestas de una cuenta
desactivada dejan de aparecer en el muro y en el resumen.

### Portal

- **Ruta `/celebracion-navidad-2026`**, fuera del shell (sin menú lateral), como `/terminos`,
  envuelta en `RequireAuth`. Quien llega sin sesión pasa por el login y vuelve a
  la página (`destinoTrasLogin` ya lo hace).
- **Aviso en el Inicio** (`Dashboard`): «🥂 Confirma tu asistencia al almuerzo de
  fin de año», con enlace a `/celebracion-navidad-2026`. Se muestra mientras la persona no
  haya respondido y las confirmaciones sigan abiertas. Usa `mi-estado`.
- La página se divide en componentes pequeños (portada, contador, tarjetas del
  evento, muro, modal de cualidades, confirmación, pase, panel de admin), con
  las llamadas a la API separadas de la presentación.

## La página

Pensada **primero para celular**, porque el link llega por WhatsApp. Conserva el
aspecto del HTML de referencia: fondo claro con manchas de color, la franja con
el degradado de la marca y el confeti. Cambia lo siguiente:

- **Logo real** (`apps/portal/src/assets/ambientalia-logo.png`) en lugar del SVG
  que dibujó Gemini.
- **Tipografías del portal**: Outfit para los títulos, en peso 800-900, e Inter
  para el texto. Ya se cargan y la CSP ya las permite.
- **El confeti y las animaciones** se desactivan si el sistema pide movimiento
  reducido (`prefers-reduced-motion`).

Secciones, en orden:

1. **Portada** con «Abrir invitación». Aparece en cada visita y se abre con un
   clic y confeti.
2. **Cabecera** con el logo y el botón «¡Celebrar!» (confeti).
3. **Hero** con el título, el texto y la cuenta atrás hasta el 18 de diciembre a
   las 12:30 p. m.
4. **Fecha, hora y lugar**, con Google Maps (la ficha exacta del restaurante) y
   «Copiar dirección». Waze se quitó el 2026-11-27.
5. **Agenda y detalles**: experiencia gastronómica, vestimenta, Google Calendar y
   «Descargar .ics».
6. **Nuestro equipo**: una tarjeta por usuario activo, con la foto (o las
   iniciales sobre un color de la marca), el nombre y sus 3 cualidades más
   votadas con su número. Si nadie ha votado todavía: «Sé el primero en brindar
   por {nombre}».
   - En las tarjetas ajenas, **«🥂 Enviar brindis»** abre el modal con la lista
     de cualidades. Vienen marcadas las que ya voté; puedo marcar hasta 3 y
     guardar. Si ya voté a esa persona, el botón dice «🥂 Brindis enviado» y
     sigue abriendo el modal para cambiar los votos.
     Después del cierre de votos, el botón desaparece.
   - En **mi tarjeta**, en lugar del brindis, **«📷 Subir mi foto»**. La foto se
     redimensiona con `fileToResizedDataUrl`, como en Configuración.
7. **Confirmación**:
   - Sin responder: «Sí voy» / «No podré ir». Si voy, la preferencia de menú y un
     mensaje opcional.
   - Ya respondida: mi respuesta y el botón «Cambiar respuesta».
   - Después del 4 de diciembre: mi respuesta, solo para consultar, y el aviso
     «Las confirmaciones se cerraron el 4 de diciembre». Quien no respondió ve
     ese mismo aviso.
8. **Pase digital** (solo si voy): una tarjeta con el logo, mi nombre, la fecha,
   el lugar, mi preferencia y mi mensaje, y el botón «Descargar pase (PNG)». **Sin el falso
   QR** del HTML de referencia, que parece escaneable y no lo es.
9. **Panel del admin** (solo si el rol es admin), con los datos de `resumen`:
   - totales: van, no van, sin responder;
   - conteo por preferencia de menú;
   - lista: nombre, respuesta, preferencia, mensaje y fecha; los que no han
     respondido aparecen como «Sin responder»;
   - botón «Descargar Excel», con la librería `xlsx` que ya usa el repo.

Cada guardado muestra un aviso con `notify` y vuelve a cargar los datos del
servidor. Los errores salen también con `notify`, con un texto claro para cada
código.

## Pruebas

TDD estricto: primero la prueba que falla, después el código.

**hub-api:**

- Servicio, con el repositorio falso y el reloj fijo:
  - confirmar antes y después del corte;
  - preferencia obligatoria si asiste y prohibida si no;
  - límites del mensaje;
  - votos: tope de 3, cualidad desconocida o repetida, voto propio, compañero
    inactivo o inexistente, después del inicio del evento;
  - reemplazar votos (de 3 a 1, de 2 a 0);
  - top 3 con desempate estable (por votos y luego por el orden de la lista);
  - el resumen solo cuenta usuarios activos e incluye a los que no respondieron.
- Router: los códigos HTTP de cada error y que `resumen` exige admin.
- Contra la BD (`*.db.test.ts`): la migración 081 y el `CHECK` de voto propio.

**Portal:**

- Los tres estados de la confirmación (sin responder, respondida, cerrada).
- El modal no deja marcar una cuarta cualidad.
- «Subir mi foto» solo en mi tarjeta; «Enviar brindis» solo en las ajenas.
- El panel solo aparece para el admin.
- El aviso del Inicio aparece y desaparece según `mi-estado`.

## Despliegue

1. hub-api primero: trae la migración 081 y los endpoints.
2. Después el portal.
3. No toca n8n.

Link para el WhatsApp, confirmado por el usuario:
`https://portal.ambientalia.cloud/celebracion-navidad-2026`. Hay que enviarlo
después de desplegar: antes, la ruta no existe y el portal manda al Inicio.

## Ampliación: quitar personas de la invitación (2026-11-27)

Tras el despliegue apareció en el panel una usuaria activa que no está invitada
y que debe conservar su acceso al portal. Desactivarla no sirve, así que el admin
puede quitar a cualquier usuario activo de la invitación y volver a invitarlo.

- **BD:** migración 082, tabla `portal.celebracion_excluidos (evento, user_id)`,
  con `ON DELETE CASCADE`. `portal_app` puede leer, insertar y borrar, pero no
  modificar.
- **Quien no está invitado:**
  - desaparece del muro y del resumen, y sus votos no cuentan;
  - no ve el aviso del Inicio (`mi-estado` trae `invitado`);
  - si abre el link, `GET /api/celebracion` responde 403 `no_invitado` y la
    página dice «Esta invitación no está disponible para tu cuenta»;
  - no puede confirmar ni votar (403 `no_invitado`);
  - votarle a él da 400 `usuario_no_valido`.
- **Sus datos no se borran:** respuestas y votos se quedan en la BD. Si se le
  vuelve a invitar, reaparecen.
- **Admin:**
  - `PUT /api/celebracion/excluidos/:userId` quita a alguien de la invitación y
    `DELETE` lo vuelve a invitar.
  - El resumen trae la lista `excluidos`.
  - En el panel, cada fila tiene «Quitar» y hay una sección «No invitados» con
    «Volver a invitar».
  - Es reversible, así que no se pide confirmación.
  - El admin no puede quitarse a sí mismo (400 `exclusion_propia`); si pudiera,
    perdería el panel.

## Ampliación: brindar por todos para poder responder (2026-11-27)

Para responder, sea «Sí voy» o «No podré ir», hay que haber brindado antes por
todos los compañeros invitados, dándole al menos una cualidad a cada uno. El
usuario empezó pidiendo 3 brindis, lo subió a 4 y al final lo dejó en todos.

- **Servidor:**
  - El mínimo es el número de personas invitadas menos uno, sin tope. Quienes no
    están invitados y las cuentas inactivas ni se exigen ni cuentan.
  - Si se invita a alguien nuevo, el mínimo sube para todos.
  - `GET /api/celebracion` trae `brindis: { dados, minimo }`.
  - `PUT /confirmacion` responde 409 `faltan_brindis` si no se llega al mínimo. El
    orden de las comprobaciones es: `no_invitado`, `confirmaciones_cerradas`,
    `faltan_brindis` y después el cuerpo.
- **Página:**
  - Mientras falten brindis y las confirmaciones sigan abiertas, la tarjeta de
    confirmación se ve apagada y no se puede usar. Muestra «Brinda por todos tus
    compañeros para confirmar · 3 de 12» y un botón «Ir al muro», que sube hasta
    el muro.
  - El muro también muestra cuántos brindis llevas.
  - Al completar el último brindis necesario, la página baja sola hasta la
    confirmación, que ya se ve encendida. Respeta el movimiento reducido.
- **Respuestas anteriores:** quien ya había respondido conserva su respuesta, pero
  para cambiarla le aplica la misma regla.

## Ampliación: foto graciosa obligatoria (2026-11-27)

Para responder también hay que subir una foto graciosa. Es una foto solo para la
celebración, aparte de la foto de perfil del portal, que no se toca.

- **BD:**
  - Migración 083, tabla `portal.celebracion_fotos`:
    `(evento, user_id FK portal.users ON DELETE CASCADE, foto TEXT con un data URL, actualizada_en)`,
    con clave primaria `(evento, user_id)`.
  - `portal_app` puede leer, insertar y actualizar, pero no borrar.
- **Servidor:**
  - `PUT /api/celebracion/mi-foto` con `{ foto }` crea o reemplaza la foto de
    quien llama.
  - Valida que sea un data URL JPEG, PNG o WebP en base64, de 300 000 caracteres
    como mucho. Si no, responde 400 `foto_invalida`.
  - Quien no está invitado recibe 403 `no_invitado`.
  - En la vista, cada miembro del equipo trae `foto`, que es la graciosa o `null`.
  - `confirmar` responde 409 `falta_foto` si no hay foto. El orden de las
    comprobaciones es: `no_invitado`, `confirmaciones_cerradas`, `falta_foto`,
    `faltan_brindis` y el cuerpo.
- **Página:**
  - El muro muestra la foto graciosa; sin ella, la de perfil o las iniciales.
  - En la tarjeta propia, el botón dice «📷 Subir mi foto graciosa», o «Cambiar mi
    foto graciosa» si ya hay una. Usa la ruta nueva; la foto de perfil no cambia.
  - Mientras falte algo, la tarjeta de confirmación apagada lista los requisitos,
    cada uno marcado como hecho o pendiente: «Sube tu foto graciosa» y «Brinda por
    todos tus compañeros (3 de 12)».
  - Al cumplir los dos, la página baja sola hasta la confirmación.

## Ampliación: cualidades ocultas y presentación para el admin (2026-11-27)

Los empleados ya no ven los resultados de las votaciones de cualidades: ni las
de sus compañeros ni las suyas. Se desvelan el día del almuerzo, cuando el admin
las presenta. La página **nunca** vuelve a mostrarlas a quien no es admin; esa
fue la decisión del usuario, frente a desvelarlas solas al empezar el evento o
con un botón.

- **Servidor** (sin migración):
  - Se ocultan en hub-api y no solo en la pantalla. Si no, los conteos seguirían
    llegando en la respuesta y se verían en las herramientas del navegador.
  - `GET /api/celebracion` para quien no es admin trae `cualidades: []` en cada
    miembro del equipo, también en el suyo, y `cualidadesOcultas: true`. El admin
    la recibe como hasta ahora, con el top 3, y `cualidadesOcultas: false`.
  - Cada uno sigue recibiendo `misVotos`, los brindis que dio, para poder
    cambiarlos. Eso no es un resultado.
  - Ruta nueva `GET /api/celebracion/cualidades`, con `requireAdmin`, igual que
    `resumen`: 403 para los demás. Devuelve `{ equipo }`, con los invitados en el
    orden del equipo (alfabético). Cada uno lleva `userId`, `nombre`, `avatar`,
    `foto` y `cualidades`: **todas** las que recibió, con su número.
  - El orden de las cualidades es el mismo del top 3: por votos y, si empatan,
    por el orden de la lista de cualidades. Así, las 3 primeras coinciden con las
    que ve el admin en el muro.
  - Solo trae conteos, nunca quién votó: el voto sigue siendo anónimo. Cuentan
    los mismos votos que en el muro (votantes activos e invitados).
- **Página del empleado:**
  - En cada tarjeta del muro, en lugar del top 3: «🤫 Se desvelan el día del
    almuerzo». Desaparecen «Aún nadie ha brindado por ti» y «Sé el primero en
    brindar por {nombre}».
  - Al guardar el brindis que completa el mínimo, el aviso dice «🥂 ¡Ya brindaste
    por todos! Los resultados se desvelarán el día del almuerzo».
  - Con los brindis completos, «Nuestro equipo» muestra fija la línea «🤫 Los
    resultados de los brindis se desvelarán el día del almuerzo». También se ve
    después del cierre de confirmaciones del 4 de diciembre, cuando los pasos ya
    no aparecen.
  - El admin no ve ninguno de estos textos: su muro sigue mostrando el top 3.
- **Presentación del admin:**
  - El panel del admin tiene el botón «🎤 Presentar cualidades». Los datos se
    piden a `GET /cualidades` al abrirla, no con el panel, para no descargar las
    fotos en cada recarga. Mientras cargan se ve «Cargando…»; si falla, un aviso
    con «Reintentar».
  - Se abre a pantalla completa: una capa que cubre la página y, si el navegador
    lo permite, la pantalla completa del sistema. En el iPhone, que no la
    permite, se queda en la capa.
  - Muestra una persona por pantalla: su foto graciosa (o la de perfil o las
    iniciales), su nombre, el top 3 en grande y el resto de cualidades en
    pequeño debajo, todas con su número. Si nadie brindó por ella: «Sin
    brindis».
  - Se mueve con «Anterior» y «Siguiente» y con las flechas del teclado. Esc o
    «Cerrar» la cierran. Un contador indica la posición, por ejemplo «5 / 24».
  - **Versión imprimible:** el botón «🖨️ Imprimir» abre el diálogo de impresión
    del navegador. Se imprime a todos los invitados, uno por hoja, sin botones ni
    el resto del portal. Sirve también para guardar un PDF.
  - Las fotos graciosas miden 256 px: en papel se ven pequeñas pero nítidas.
- **Pruebas:**
  - hub-api: la vista sin cualidades para el empleado y con el top 3 para el
    admin; `GET /cualidades` con 403 para el empleado, el orden alfabético, la
    lista completa con el desempate y sin los no invitados.
  - Portal: el texto oculto en las tarjetas, el aviso del último brindis, la
    línea fija, la navegación de la presentación y que la versión imprimible
    tenga a todos.
- **Despliegue:** hub-api primero y después el portal. Si el portal anterior
  sigue publicado un rato, las tarjetas salen sin cualidades, sin mostrar nada
  que no deba.

## Fuera de alcance

- Un módulo genérico de eventos con pantalla para crearlos. Para otro evento se
  cambia la configuración del módulo y el identificador.
- Que el admin suba fotos ajenas.
- Acompañantes (+1).
- Recordatorios automáticos por correo o WhatsApp a quien no ha respondido.
