-- Migración 024: el trabajador puede pedir que se modifique una solicitud ya
-- enviada —cambiar las fechas o anularla— y su jefe lo aprueba o lo rechaza.
--
-- La propuesta vive en una tabla APARTE y la fila de `solicitudes_ausencia` no se
-- toca hasta que hay decisión. Eso deja intacta la máquina de estados: ni un
-- estado nuevo, ni el CHECK de `estado` que ampliar, ni los seis `estado IN (...)`
-- escritos a mano que habría que revisar. Uno de esos seis falla en ABIERTO
-- (`repo.ausenciasEntre` filtra `estado <> 'rechazada'`), así que un estado
-- `anulada` habría seguido pintándose en el calendario como ausencia vigente:
-- el fallo que nadie detecta.
--
-- Solo DDL e idempotente: `initDb()` la re-ejecuta en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- ── La propuesta de cambio ──────────────────────────────────────────────────
-- Las columnas `*_previa` no son redundancia con la solicitud: son la FOTO del
-- instante en que se pidió, y sostienen dos cosas que sin ellas no se pueden
-- hacer. Una, el correo dice «de estas fechas a estas otras», que es lo único
-- que permite ajustar el calendario a mano. Y dos, son el testigo de
-- concurrencia al aplicar el cambio: si un admin corrigió las fechas por PATCH
-- entre medias, la aprobación choca en vez de pisarle la corrección en silencio.
--
-- Aquí SÍ hay clave foránea, al revés que en `visores_adjuntos_log`. Aquel es
-- auditoría de un permiso y debe sobrevivir a su sujeto; esto es una propuesta
-- SOBRE una fila, inaplicable si la fila no existe, y un evento de outbox sobre
-- una solicitud borrada sería basura que n8n reintentaría.
CREATE TABLE IF NOT EXISTS portal.solicitud_modificaciones (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id         UUID         NOT NULL REFERENCES portal.solicitudes_ausencia(id) ON DELETE CASCADE,
  clase                VARCHAR(20)  NOT NULL CHECK (clase IN ('fechas', 'anulacion')),

  -- La foto de la solicitud al pedir el cambio.
  estado_previo        VARCHAR(20)  NOT NULL,
  fecha_inicio_previa  DATE         NOT NULL,
  fecha_fin_previa     DATE         NOT NULL,
  -- NUMERIC(4,1) y no INTEGER: la 016 cambió `dias_habiles` para admitir los
  -- medios días que traía el histórico. Un INTEGER aquí truncaría al copiar.
  dias_habiles_previos NUMERIC(4,1) NOT NULL,

  -- Lo propuesto. Los tres van NULL en una anulación.
  fecha_inicio_nueva   DATE,
  fecha_fin_nueva      DATE,
  dias_habiles_nuevos  NUMERIC(4,1),

  motivo               TEXT,
  estado               VARCHAR(20)  NOT NULL DEFAULT 'pendiente'
                                    CHECK (estado IN ('pendiente', 'aprobada', 'rechazada', 'retirada')),

  -- Copiado de la SOLICITUD, nunca rederivado del organigrama. Una modificación
  -- no es una solicitud nueva: es una enmienda sobre una que ya está en vuelo o
  -- ya concedida. Rederivar mandaría «anula mis vacaciones aprobadas» a un jefe
  -- que no sabe que se aprobaron ni por qué.
  aprobador_correo     VARCHAR(254) NOT NULL,
  -- Desnormalizado como en `visores_adjuntos_log`: que el registro siga siendo
  -- legible aunque la ficha cambie de correo.
  solicitante_email    VARCHAR(254) NOT NULL,

  aprobador_user_id    UUID         REFERENCES portal.users(id) ON DELETE SET NULL,
  decidida_at          TIMESTAMPTZ,
  motivo_rechazo       TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT modificaciones_rango_valido
    CHECK (fecha_fin_nueva IS NULL OR fecha_fin_nueva >= fecha_inicio_nueva),

  -- Que la clase y los campos no puedan contradecirse. Sin esto, una anulación
  -- con fechas o un cambio de fechas sin ellas serían filas legales que el
  -- código tendría que interpretar, y cada lectura elegiría su interpretación.
  CONSTRAINT modificaciones_campos_por_clase CHECK (
    (clase = 'anulacion'
      AND fecha_inicio_nueva IS NULL AND fecha_fin_nueva IS NULL AND dias_habiles_nuevos IS NULL)
    OR
    (clase = 'fechas'
      AND fecha_inicio_nueva IS NOT NULL AND fecha_fin_nueva IS NOT NULL AND dias_habiles_nuevos IS NOT NULL)
  )
);

-- ── Como mucho UNA propuesta viva por solicitud ─────────────────────────────
-- Esta restricción no es higiene, es lo que sostiene el resto. `SELECT_SOLICITUD`
-- gana un LEFT JOIN contra esta tabla y se usa en OCHO consultas, incluidas las
-- que no filtran nada (el registro general, los adjuntos). Dos filas vivas para
-- la misma solicitud multiplicarían resultados en todas ellas.
--
-- Va como índice único parcial y no como comprobación en el servicio porque dos
-- peticiones a la vez pasarían las dos comprobaciones antes de que cualquiera
-- de las dos escribiera. La garantía tiene que estar en la base.
CREATE UNIQUE INDEX IF NOT EXISTS ux_modificaciones_una_pendiente
  ON portal.solicitud_modificaciones (solicitud_id)
  WHERE estado = 'pendiente';

-- La bandeja del jefe pregunta por su correo y solo por lo pendiente. Mismo
-- patrón que los dos índices parciales de aprobador que ya existen (015 y 018).
CREATE INDEX IF NOT EXISTS idx_modificaciones_aprobador
  ON portal.solicitud_modificaciones (aprobador_correo)
  WHERE estado = 'pendiente';

-- ── La marca de anulada ─────────────────────────────────────────────────────
-- Anular NO estrena estado: deja la solicitud en `rechazada` y marca aquí el
-- cuándo. `rechazada` hereda ya la semántica correcta en los seis filtros que
-- miran el estado —deja de consumir saldo, no entra en trámite, desaparece del
-- calendario, no entra en la bandeja, y sigue en el historial del jefe, que es
-- lo correcto porque él la decidió—. La etiqueta «Anulada» se deriva al pintar.
--
-- Sin DEFAULT y sin backfill (patrón de la 021/023): NULL en las filas que ya
-- existen significa exactamente lo que tiene que significar, «no se anuló».
ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS anulada_at TIMESTAMPTZ;

-- ── El CHECK de `evento` admite los tres avisos de modificación ─────────────
-- Va en la MISMA migración que la tabla, por lo mismo que documenta la 018: si
-- el INSERT del outbox rebotara contra este CHECK, reventaría DENTRO de la
-- transacción de la decisión y el ROLLBACK la desharía entera.
--
-- ⚠️ La guarda NO puede copiarse de la 018. Allí se preguntaba por el NOMBRE
-- (`conname = 'outbox_evento_check'`) porque el constraint todavía no existía
-- con ese nombre. Aquí SÍ existe —lo creó la 018—, así que esa misma guarda
-- daría siempre falso, el bloque no se ejecutaría nunca y el CHECK se quedaría
-- con los seis eventos viejos: un no-op silencioso que solo se descubriría al
-- reventar el primer INSERT del outbox, dentro de la transacción de la primera
-- decisión. Por eso la guarda mira el CONTENIDO.
--
-- El aviso de la 018 contra `pg_get_constraintdef` era para LOCALIZAR el
-- constraint a borrar (un LIKE podría pillar de rebote otro CHECK que mencionara
-- la palabra). Eso no cambia: la localización se sigue haciendo por `conkey`.
-- El LIKE es solo la marca de idempotencia, sobre un constraint ya fijado por
-- nombre y por columna.
DO $$
DECLARE
  viejo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.ausencias_outbox'::regclass
       AND conname  = 'outbox_evento_check'
       AND pg_get_constraintdef(oid) LIKE '%modificacion_solicitada%'
  ) THEN
    FOR viejo IN
      SELECT con.conname
        FROM pg_constraint con
       WHERE con.conrelid = 'portal.ausencias_outbox'::regclass
         AND con.contype  = 'c'
         AND con.conkey   = ARRAY[(SELECT a.attnum
                                     FROM pg_attribute a
                                    WHERE a.attrelid = con.conrelid
                                      AND a.attname  = 'evento')]::int2[]
    LOOP
      EXECUTE format('ALTER TABLE portal.ausencias_outbox DROP CONSTRAINT %I', viejo);
    END LOOP;

    ALTER TABLE portal.ausencias_outbox
      ADD CONSTRAINT outbox_evento_check
      CHECK (evento IN ('creada', 'aprobacion', 'aprobacion_2', 'aprobada', 'rechazada', 'registrada',
                        'modificacion_solicitada', 'modificacion_aprobada', 'modificacion_rechazada'));
  END IF;
END $$;
