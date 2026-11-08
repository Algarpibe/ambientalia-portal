# Diseño — Envío manual de los avisos a clientes (Trazabilidad Mantenimientos)

Aprobado por Alfonso, sección a sección, el 2026-11-08.

## Objetivo

Sustituir las dos vistas de «Avisos a clientes» («Manual» y «Simulación
automática») por **una sola**, la de la simulación, en la que cada tarjeta
tenga un botón **«Enviar correo»** que manda el aviso de verdad, por correo,
desde **info@ambientalia.com.co**, a los destinatarios y con el texto que ya
enseña la simulación. El envío es siempre **manual**: lo dispara una persona,
tarjeta a tarjeta. No hay envío automático.

**Restricción vigente:** no se envía ningún correo a clientes hasta que Alfonso
lo decida de forma explícita (fase 5 de las pruebas). Todo se construye y se
prueba con correos que solo llegan a buzones de Ambientalia.

## Contexto y decisiones previas

- Desk 2.0 tiene previsto enviar estos mismos avisos (M4.5 de su documento
  maestro). Alfonso decide construirlo ya en el portal: la app de trazabilidad
  acabará formando parte de Desk 2.0 y esta pieza se reutilizará. Por eso el
  envío vive en **un módulo propio**, separado de la redacción y del plan.
- El correo de la empresa es Google Workspace (los MX del dominio son de
  Google, comprobado el 2026-11-08), así que el envío va por **n8n con su nodo
  Gmail**, como ya hacen Vacaciones y WO-sales (`docs/n8n-automatizaciones.md`).
- Se descarta guardar la contraseña de info@ en hub-api: EasyPanel imprime las
  variables de entorno en los registros de build. La credencial de Gmail vive
  solo dentro de n8n.
- Se descarta la cola con sondeo (patrón outbox de Vacaciones): no da respuesta
  al momento y es el mecanismo del incidente de los 700 correos (agosto 2026).
  Se elige el **envío al momento**: hub-api llama a n8n y espera su respuesta.

## 1. Pantalla

- Desaparecen la vista «Manual», su selector de 30/60/90 días, «Redactar aviso»
  (texto editable) y «Marcar N como avisados hoy». Queda la pantalla de la
  simulación, sin la palabra «simulación».
- Arriba, un rótulo con la posición del interruptor de envío: *apagado*,
  *prueba* (con el buzón al que llega todo) o *real*.
- Las tarjetas van por cliente y en **cuatro grupos**: Primer aviso (90 días),
  Recordatorio (60), Último aviso (30) y **Vencida** (nuevo, sección 2).
- Cada tarjeta conserva lo de hoy (equipos, «Para», «Ver asunto y texto»,
  «Cambiar destinatario», «Copiar texto») y suma **«Enviar correo»**:
  - Con el interruptor en *apagado*, el botón se ve desactivado con el rótulo
    «Envío apagado».
  - Al pulsarlo se abre una ventana de confirmación con destinatarios, asunto y
    texto completo; se confirma con «Enviar». El texto no se edita.
  - Al salir bien, la tarjeta pasa a «Ya avisados» con la fecha y quién envió.
- Las tarjetas «Sin destinatario» no tienen botón de enviar (siguen con su
  editor de contacto).
- Siguen los informativos «Ya avisados en este tramo», «En servicio» y «Fuera
  de ciclo». «Vencidas sin aviso» deja de ser informativo: es el grupo Vencida.
- Al final, una lista plegada con los **últimos envíos** (fecha, quién, cliente,
  grupo, modo y resultado), con las acciones de la sección 4 sobre los «sin
  confirmar».
- Avisar por teléfono sigue siendo posible: la fecha «Aviso enviado al cliente»
  se pone a mano en la ficha del equipo (permiso `seguimiento.write`), como hoy.
- Pueden enviar, y resolver un «sin confirmar», los roles **Comercial** y
  **Director Técnico**: los que hoy tienen `avisos.write`, cuyo significado pasa
  de «marcar como avisado en bloque» a «enviar el aviso». Se actualiza su texto
  en `roles.ts` y en la vista de Roles.

## 2. Grupo «Vencida»

- Entran los equipos que hoy salen en `vencidasSinAviso`: vencidos hace menos
  de un año, fuera de servicio (ni en Ambientalia ni con ticket abierto) y sin
  aviso registrado desde que vencieron (`avisoEnviado < vence` o vacío).
- **Una sola vez por vencimiento:** en cuanto se registra un aviso con fecha
  igual o posterior al vencimiento, el equipo pasa a «Ya avisados».
- Los vencidos hace más de un año (`FUERA_CICLO`) siguen fuera.
- Se agrupa por cliente, como los otros tres: varios equipos vencidos del mismo
  cliente van en un solo correo.
- Texto (aprobado; datos del ejemplo ficticios):

  > **Asunto:** La calibración de su monitor GRIMM está vencida · Cliente Ejemplo S.A.S.
  >
  > Estimado cliente Cliente Ejemplo S.A.S.:
  >
  > Desde el Servicio Técnico de Ambientalia le informamos de que la
  > calibración del siguiente monitor de partículas GRIMM está vencida:
  >
  > • GRIMM EDM 180, serial 18A00001: última calibración 15/09/2025, vencida
  > desde el 15/09/2026.
  >
  > Mientras la calibración esté vencida, las mediciones del equipo pueden
  > perder su validez. Le proponemos programar cuanto antes el servicio de
  > calibración y mantenimiento. Indíquenos la fecha en que podría enviarnos el
  > equipo o, si lo prefiere, coordinamos la recogida.
  >
  > Quedamos atentos.
  >
  > Ambientalia S.A.S. · Servicio Técnico

  Con varios equipos o con equipos que no son todos GRIMM, las mismas variantes
  que los otros tramos («sus monitores GRIMM», «su equipo», «sus equipos»; «los
  siguientes …»; «enviarnos los equipos»). El saludo, la regla de siempre
  (`saludoAviso`).

## 3. Qué pasa al pulsar «Enviar»

1. La pantalla manda solo **qué tarjeta**: clave del cliente, grupo y la lista
   de claves de equipos que el usuario vio (la «huella»).
2. **El servidor redacta el correo.** Vuelve a calcular el plan con los datos
   del momento y, si la tarjeta ya no coincide con la huella, responde 409
   («la tarjeta cambió: recarga») y no envía nada. El navegador nunca decide
   destinatarios ni texto.
3. Registra el envío como **«en curso»**. Un índice único parcial por
   (cliente, grupo) sobre los «en curso» (los «sin confirmar» lo son: ver
   abajo) impide dos envíos a la vez (doble clic o dos personas): el segundo
   recibe 409 («ya se está enviando»).
4. Llama a n8n con un tiempo máximo de espera (30 s).
5. Según la respuesta:
   - **Gmail confirma** → «enviado», con el identificador del mensaje. En modo
     *real*, en la misma transacción, los equipos de la tarjeta quedan con
     «Aviso enviado al cliente» = hoy (`registrarAvisos`, el de siempre). En
     *prueba* no se toca ningún equipo.
   - **n8n o Gmail rechazan** → «fallido», con el motivo; se ve en pantalla, no
     se marca nada y se puede reintentar.
   - **Sin respuesta a tiempo** (o la transacción final falla) → queda
     «en curso» y la pantalla recibe **«sin confirmar»** (sección 4). Un
     «en curso» de más de 2 minutos (por ejemplo, si el servidor se reinició a
     mitad) también se presenta como «sin confirmar». No es un estado guardado
     aparte: es un «en curso» que ya no espera respuesta.
6. **Nada se envía solo.** Ningún reloj, pasada nocturna ni arranque del
   servidor llama al envío; solo la ruta POST del botón.

## 4. «Sin confirmar»

La tarjeta no deja reenviar. En «últimos envíos», el envío muestra «Sin
confirmar: revisa Enviados de info@» y dos botones:

- **«Sí salió»** → pasa a «enviado» (resuelto a mano, con quién y cuándo) y, en
  modo *real*, marca los equipos como avisados.
- **«No salió»** → pasa a «fallido» y la tarjeta vuelve a poder enviarse.

## 5. Interruptor y candados

**Interruptor** (variable de entorno de hub-api, se cambia solo en EasyPanel):

| Variable | Valor |
|---|---|
| `TMC_AVISOS_ENVIO` | `apagado` (por defecto) · `prueba` · `real`. Cualquier otro valor, o ninguno = `apagado`. |
| `TMC_AVISOS_BUZON_PRUEBA` | Buzón interno al que va todo en *prueba*. Si falta o no es `@ambientalia.com.co`, *prueba* se comporta como *apagado*. |
| `TMC_AVISOS_N8N_URL`, `TMC_AVISOS_N8N_TOKEN` | Webhook de n8n y su token. Si falta alguno, el modo efectivo es `apagado`. |

El modo efectivo (y por qué) lo sirve una ruta GET para el rótulo de la
pantalla. **El modo no se puede cambiar desde el portal.**

**En *prueba*:** el único destinatario es el buzón de prueba; el asunto empieza
por «[PRUEBA]»; el cuerpo empieza diciendo a quién habría ido de verdad. El
registro guarda los destinatarios reales y a quién se mandó.

**Tres candados independientes:**

1. El interruptor, que falla cerrado.
2. El modo *prueba* reescribe los destinatarios en el servidor.
3. **n8n tiene su propia barrera:** rechaza cualquier destinatario que no sea
   `@ambientalia.com.co`. Quitarla es un paso aparte, explícito, de la fase 5.

**Pruebas que leen el código (candados), ampliadas:**

- Las de hoy («nada de esto envía» en `router.ts`, `repo.ts`, `dominio.ts`,
  `types.ts` y demás módulos) **se mantienen intactas**: el envío vive en un
  módulo nuevo, y la configuración de n8n se lee solo ahí (no en el router).
- Nuevas: ese módulo es el único de `src/trazabilidad/` que llama a la red; no
  tiene `setInterval`, `setTimeout` ni programador (la espera máxima usa
  `AbortSignal.timeout`); solo lo importa el router; un modo desconocido es
  `apagado`; en *prueba* el destinatario es solo el buzón de prueba.

## 6. Unidades

- **Dominio puro (hub-api, compartido con la sub-app):** el grupo Vencida en
  `planAvisos`; la redacción del correo (`correoAviso`, `mensajeAviso`,
  `saludoAviso`) se **mueve** de la sub-app a hub-api para que el servidor y la
  pantalla usen el mismo texto; la transformación de *prueba* (destinatario,
  asunto, cabecera). TDD estricto.
- **Módulo de envío (hub-api):** lee la configuración, decide el modo efectivo
  y llama a n8n. Es la única pieza que cambiará al pasar a Desk 2.0.
- **Registro (migración nueva en `users/migrations`):** tabla
  `portal.tmc_avisos_envios` con fecha, quién, modo, cliente, grupo, equipos,
  destinatarios reales, a quién se mandó, asunto, estado (`en_curso`,
  `enviado`, `fallido`), identificador del mensaje, error y resolución manual.
  Se añade al inventario de datos de `docs/PRIVACY-RETENTION.md`.
- **Rutas:** GET del modo y de los últimos envíos; POST de enviar una tarjeta;
  POST de resolver un «sin confirmar». Se retira la ruta de marcar en bloque
  (`POST /trazabilidad/avisos`), que ya no usa nadie; `registrarAvisos` se
  reutiliza dentro del envío.
- **Pantalla (sub-app):** la vista única, la ventana de confirmación, el rótulo
  del modo y la lista de últimos envíos.
- **n8n:** flujo nuevo Webhook (con token) → barrera de dominio → Gmail (cuenta
  info@, la credencial la engancha Alfonso a mano) → responde con el
  identificador del mensaje o el error. Se crea y se valida con el MCP de n8n.
- **Documentación:** `apps/trazabilidad-mantenimientos/CLAUDE.md` deja de decir
  que la app no envía nada y explica el interruptor.

## 7. Plan de pruebas (aprobado)

1. **Todo construido con el interruptor en *apagado*.** El botón se ve y dice
   «Envío apagado». Pruebas automáticas en verde.
2. **n8n:** Alfonso engancha la cuenta info@ en el flujo; se manda un correo de
   prueba desde el propio n8n al buzón de prueba.
3. **Modo *prueba* en EasyPanel:** se pulsa «Enviar» en tarjetas reales.
   Alfonso revisa el correo en ordenador y móvil y en Enviados de info@.
   Se comprueba que ningún equipo quedó marcado como avisado.
4. **Fallos:** n8n parado → error en pantalla y nada marcado; doble clic → un
   solo correo; «sin confirmar» → se resuelve con «Sí salió» / «No salió».
5. **Solo con la decisión explícita de Alfonso y con los secretos ya rotados:**
   se quita la barrera de dominio de n8n, primer envío real controlado a un
   cliente de confianza y, después, modo *real*.

La fase de prueba puede hacerse antes de rotar los secretos: solo llega a
buzones de Ambientalia.

## 8. Fuera de alcance

- Envío automático (sin persona que pulse).
- Editar el texto antes de enviar.
- Copias (CC/CCO) a otras direcciones.
- Avisos a los equipos fuera de ciclo.
- Sacar el contacto y la frecuencia de Desk 2.0 (E-275).

## 9. Entregas (lotes de menos de 800 líneas)

1. Dominio puro: grupo Vencida, redacción movida a hub-api, transformación de
   *prueba*.
2. hub-api: migración, módulo de envío, rutas, candados y pruebas de BD.
3. Sub-app: pantalla única, confirmación, rótulo y últimos envíos.
4. n8n: flujo con barrera; variables en EasyPanel (en *apagado*).

Orden de despliegue: hub-api primero, después el portal.
