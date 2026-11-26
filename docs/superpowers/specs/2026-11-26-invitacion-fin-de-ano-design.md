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

- **Ruta `/fin-de-ano`**, fuera del shell (sin menú lateral), como `/terminos`,
  envuelta en `RequireAuth`. Quien llega sin sesión pasa por el login y vuelve a
  la página (`destinoTrasLogin` ya lo hace).
- **Aviso en el Inicio** (`Dashboard`): «🥂 Confirma tu asistencia al almuerzo de
  fin de año», con enlace a `/fin-de-ano`. Se muestra mientras la persona no
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
4. **Fecha, hora y lugar**, con Google Maps, Waze y «Copiar dirección».
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

Link para el WhatsApp: `https://portal.ambientalia.cloud/fin-de-ano`. El dominio
es el `PORTAL_URL` por defecto de hub-api y hay que confirmarlo antes de enviar
el mensaje.

## Fuera de alcance

- Un módulo genérico de eventos con pantalla para crearlos. Para otro evento se
  cambia la configuración del módulo y el identificador.
- Ocultar cuentas concretas del muro. Si hay cuentas de prueba, se desactivan.
- Que el admin suba fotos ajenas.
- Acompañantes (+1).
- Recordatorios automáticos por correo o WhatsApp a quien no ha respondido.
