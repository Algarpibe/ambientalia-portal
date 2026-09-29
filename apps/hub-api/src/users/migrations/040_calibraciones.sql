-- Migration 040: Calibraciones app (O3 transfer standards, TAD 2023 + 40 CFR 50 App. D).
--
-- Tables: equipment, verifications (+ cycles, points), versioned limit sets,
-- engine config, per-user roles and an append-only audit log (ISO/IEC 17025).
--
-- IDEMPOTENT: initDb() re-runs every migration on every boot. Everything here
-- is CREATE ... IF NOT EXISTS, CREATE OR REPLACE, or an INSERT ... ON CONFLICT
-- DO NOTHING. Never add a statement that fails or changes data on a second run.
--
-- People (technician, approver, actor) are stored as id + email WITHOUT a
-- foreign key to portal.users, same as the ausencias audit logs (022/031/032):
-- a signed calibration record must survive the deletion of the user account.
-- The one exception is cal_user_roles, which is state, not history.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS portal;

-- ── Equipment ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portal.cal_equipment (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  brand                   VARCHAR(120)  NOT NULL,
  model                   VARCHAR(120)  NOT NULL,
  serial                  VARCHAR(120)  NOT NULL,
  internal_code           VARCHAR(60)   NOT NULL,
  type                    VARCHAR(30)   NOT NULL
                          CHECK (type IN ('SRP', 'PHOTOMETRIC_CALIBRATOR', 'GENERATOR_ONLY', 'ANALYZER')),
  has_photometer          BOOLEAN       NOT NULL,
  application             VARCHAR(10)   NOT NULL CHECK (application IN ('BENCH', 'FIELD')),
  current_level           SMALLINT      NULL CHECK (current_level BETWEEN 1 AND 4),
  notes                   TEXT          NULL,
  -- Level 1 (SRP): its traceability comes from an external certificate, not
  -- from an in-app verification. These fields stand in for that verification.
  certificate_number      VARCHAR(120)  NULL,
  certificate_valid_until DATE          NULL,
  certificate_max_ppb     DOUBLE PRECISION NULL,
  certificate_route       VARCHAR(20)   NULL CHECK (certificate_route IN ('SAMPLE_IN', 'INTERNAL', 'OTHER')),
  active                  BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT cal_equipment_internal_code_unique UNIQUE (internal_code)
);

-- ── Verifications ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portal.cal_verifications (
  id                         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                       VARCHAR(30)  NOT NULL
                             CHECK (kind IN ('VERIFICATION_3_CYCLES', 'REVERIFICATION_1_CYCLE', 'CROSS_CHECK')),
  verification_date          DATE         NOT NULL,
  location                   VARCHAR(200) NULL,
  technician_id              UUID         NOT NULL,
  technician_email           VARCHAR(254) NOT NULL,
  approved_by_id             UUID         NULL,
  approved_by_email          VARCHAR(254) NULL,
  status                     VARCHAR(12)  NOT NULL DEFAULT 'DRAFT'
                             CHECK (status IN ('DRAFT', 'CALCULATED', 'APPROVED', 'REJECTED')),
  reference_equipment_id     UUID         NOT NULL REFERENCES portal.cal_equipment(id),
  candidate_equipment_id     UUID         NOT NULL REFERENCES portal.cal_equipment(id),
  -- The reference's valid verification (null when the reference is an SRP).
  reference_verification_id  UUID         NULL REFERENCES portal.cal_verifications(id),
  -- The candidate's last full verification used for R1/R2/R5 (reverifications).
  candidate_last_verification_id UUID     NULL REFERENCES portal.cal_verifications(id),
  reference_route            VARCHAR(20)  NULL CHECK (reference_route IN ('SAMPLE_IN', 'INTERNAL', 'OTHER')),
  candidate_route            VARCHAR(20)  NULL CHECK (candidate_route IN ('SAMPLE_IN', 'INTERNAL', 'OTHER')),
  traceability_option        SMALLINT     NOT NULL DEFAULT 1 CHECK (traceability_option IN (1, 2)),
  internal_factors_before    JSONB        NULL,
  internal_factors_after     JSONB        NULL,
  reference_internal_factors JSONB        NULL,
  lab_temp_start_c           DOUBLE PRECISION NULL,
  lab_temp_end_c             DOUBLE PRECISION NULL,
  lab_rh_pct                 DOUBLE PRECISION NULL,
  baro_pressure_torr         DOUBLE PRECISION NULL,
  total_flow_slpm            DOUBLE PRECISION NULL,
  calibration_scale_ppb      DOUBLE PRECISION NULL,
  acceptance_checklist       JSONB        NULL,
  photometry                 JSONB        NULL,
  director_override_level4   BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Aggregated results (engine output, also kept whole in `evaluation`).
  mean_slope                 DOUBLE PRECISION NULL,
  mean_intercept             DOUBLE PRECISION NULL,
  sd_slope                   DOUBLE PRECISION NULL,
  sd_intercept               DOUBLE PRECISION NULL,
  max_verified_point_ppb     DOUBLE PRECISION NULL,
  overall_result             VARCHAR(12)  NULL CHECK (overall_result IN ('CONFORME', 'NO_CONFORME')),
  fail_reasons               JSONB        NOT NULL DEFAULT '[]'::jsonb,
  candidate_level            SMALLINT     NULL CHECK (candidate_level BETWEEN 1 AND 4),
  valid_until                DATE         NULL,
  reverification_due         DATE         NULL,
  -- Reproducibility (ISO/IEC 17025): what the engine ran with, exactly.
  engine_version             VARCHAR(40)  NULL,
  limits_version             VARCHAR(40)  NULL,
  limits_snapshot            JSONB        NULL,
  config_snapshot            JSONB        NULL,
  engine_input               JSONB        NULL,
  evaluation                 JSONB        NULL,
  traceability_warnings      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  -- Versioning of approved records: a change is a new row that supersedes it.
  version                    INTEGER      NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id              UUID         NULL REFERENCES portal.cal_verifications(id),
  change_reason              TEXT         NULL,
  rejection_reason           TEXT         NULL,
  calculated_at              TIMESTAMPTZ  NULL,
  approved_at                TIMESTAMPTZ  NULL,
  rejected_at                TIMESTAMPTZ  NULL,
  created_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT cal_verifications_distinct_equipment CHECK (reference_equipment_id <> candidate_equipment_id)
);

CREATE INDEX IF NOT EXISTS idx_cal_verifications_candidate ON portal.cal_verifications (candidate_equipment_id, verification_date DESC);
CREATE INDEX IF NOT EXISTS idx_cal_verifications_reference ON portal.cal_verifications (reference_equipment_id, verification_date DESC);
CREATE INDEX IF NOT EXISTS idx_cal_verifications_status ON portal.cal_verifications (status);
-- At most one live (open or approved) new version per record: no branching chains.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cal_verifications_one_live_version
  ON portal.cal_verifications (supersedes_id)
  WHERE supersedes_id IS NOT NULL AND status IN ('DRAFT', 'CALCULATED', 'APPROVED');

CREATE TABLE IF NOT EXISTS portal.cal_cycles (
  id               UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id  UUID     NOT NULL REFERENCES portal.cal_verifications(id) ON DELETE CASCADE,
  cycle_index      SMALLINT NOT NULL CHECK (cycle_index BETWEEN 1 AND 3),
  slope            DOUBLE PRECISION NULL,
  intercept        DOUBLE PRECISION NULL,
  r2               DOUBLE PRECISION NULL,
  pass             BOOLEAN  NULL,
  regression_error TEXT     NULL,
  CONSTRAINT cal_cycles_unique_index UNIQUE (verification_id, cycle_index)
);

CREATE TABLE IF NOT EXISTS portal.cal_points (
  id                UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id          UUID     NOT NULL REFERENCES portal.cal_cycles(id) ON DELETE CASCADE,
  point_order       SMALLINT NOT NULL CHECK (point_order >= 1),
  setpoint_ppb      DOUBLE PRECISION NULL,
  -- Reference reading as indicated (input). x_std_ppb is the x the engine used
  -- (after Eq. 10 when the reference verification used option 2).
  x_ppb             DOUBLE PRECISION NOT NULL,
  y_ppb             DOUBLE PRECISION NOT NULL,
  x_std_ppb         DOUBLE PRECISION NULL,
  cell_temp_x_c     DOUBLE PRECISION NULL,
  cell_temp_y_c     DOUBLE PRECISION NULL,
  cell_press_x_torr DOUBLE PRECISION NULL,
  cell_press_y_torr DOUBLE PRECISION NULL,
  readings_count    INTEGER  NULL CHECK (readings_count >= 0),
  timestamp_stable  TIMESTAMPTZ NULL,
  diff_value        DOUBLE PRECISION NULL,
  diff_type         VARCHAR(10) NULL CHECK (diff_type IN ('PERCENT', 'ABS_PPB')),
  pass              BOOLEAN  NULL,
  CONSTRAINT cal_points_unique_order UNIQUE (cycle_id, point_order)
);

-- ── Immutability of APPROVED / REJECTED records (ISO/IEC 17025) ────────────
-- The service already answers 409; these triggers make the database refuse
-- too, so no code path (or manual query) can alter a signed record.

CREATE OR REPLACE FUNCTION portal.cal_verification_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'cal_verifications %: record is locked (status %)', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE TRIGGER trg_cal_verifications_locked
  BEFORE UPDATE OR DELETE ON portal.cal_verifications
  FOR EACH ROW EXECUTE FUNCTION portal.cal_verification_locked();

CREATE OR REPLACE FUNCTION portal.cal_cycle_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM portal.cal_verifications
   WHERE id = CASE WHEN TG_OP = 'INSERT' THEN NEW.verification_id ELSE OLD.verification_id END;
  IF v_status IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'cal_cycles: verification is locked (status %)', v_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE TRIGGER trg_cal_cycles_locked
  BEFORE INSERT OR UPDATE OR DELETE ON portal.cal_cycles
  FOR EACH ROW EXECUTE FUNCTION portal.cal_cycle_locked();

CREATE OR REPLACE FUNCTION portal.cal_point_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT v.status INTO v_status
    FROM portal.cal_cycles c JOIN portal.cal_verifications v ON v.id = c.verification_id
   WHERE c.id = CASE WHEN TG_OP = 'INSERT' THEN NEW.cycle_id ELSE OLD.cycle_id END;
  IF v_status IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'cal_points: verification is locked (status %)', v_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE TRIGGER trg_cal_points_locked
  BEFORE INSERT OR UPDATE OR DELETE ON portal.cal_points
  FOR EACH ROW EXECUTE FUNCTION portal.cal_point_locked();

-- ── Versioned limit sets ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portal.cal_limit_sets (
  id               SERIAL       PRIMARY KEY,
  version          VARCHAR(40)  NOT NULL,
  limits           JSONB        NOT NULL,
  active           BOOLEAN      NOT NULL DEFAULT FALSE,
  created_by_id    UUID         NULL,
  created_by_email VARCHAR(254) NOT NULL,
  reason           TEXT         NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT cal_limit_sets_version_unique UNIQUE (version)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cal_limit_sets_one_active ON portal.cal_limit_sets (active) WHERE active;

-- Default limit set = o3-engine DEFAULT_LIMITS (LIMITS_VERSION). Hardcoded on
-- purpose (the migration runner only runs SQL); migration.test.ts asserts the
-- JSON below equals DEFAULT_LIMITS, so the two copies cannot drift. It is only
-- made active when no other set is active, so a later director choice survives
-- every reboot.
-- seed:limits:begin
INSERT INTO portal.cal_limit_sets (version, limits, active, created_by_email, reason)
SELECT '1.0.0',
       '{"version":"1.0.0","V1":{"maxPercent":3.1},"V2":{"maxAbsPpb":1.5,"inclusive":true},"V3":{"nominal":1.0,"tolerance":0.03},"V4":{"nominal":0,"tolerancePpb":3},"V5":{"max":0.0075},"V6":{"maxPpb":1.0},"V7":{"requiredCycles":3},"V8":{"minZeroPoints":1,"minNonZeroPoints":6},"R1":{"max":0.015},"R2":{"maxPpb":1.5},"R3":{"nominal":1.0,"tolerance":0.03},"R4":{"nominal":0,"tolerancePpb":3},"Q1":{"percent":4,"ppb":4},"D1":{"maxLossFraction":0.05},"D2":{"maxPercent":3},"C1":{"percent":7.1,"ppb":1.5,"minPpb":5,"maxPpb":80},"photometerPrecision":{"ppb":5,"percent":3}}'::jsonb,
       NOT EXISTS (SELECT 1 FROM portal.cal_limit_sets WHERE active),
       'system',
       'Tabla por defecto: TAD 2023 Tabla 4-1 y 40 CFR 50 App. D (o3-engine DEFAULT_LIMITS)'
ON CONFLICT (version) DO NOTHING;
-- seed:limits:end

-- ── Engine configuration ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portal.cal_config (
  key              VARCHAR(60)  PRIMARY KEY,
  value            JSONB        NOT NULL,
  updated_by_id    UUID         NULL,
  updated_by_email VARCHAR(254) NULL,
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Default config = o3-engine DEFAULT_CONFIG (asserted by migration.test.ts).
-- seed:config:begin
INSERT INTO portal.cal_config (key, value) VALUES
  ('absDiffThresholdPpb', '50'::jsonb),
  ('includeZeroInRegression', 'true'::jsonb),
  ('validityDays', '{"level2Annual":365,"level2FieldReverification":182,"level3Bench":365,"level3Field":182,"level4Quarterly":91}'::jsonb)
ON CONFLICT (key) DO NOTHING;
-- seed:config:end

-- ── Roles ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portal.cal_user_roles (
  user_id          UUID         PRIMARY KEY REFERENCES portal.users(id) ON DELETE CASCADE,
  role             VARCHAR(20)  NOT NULL CHECK (role IN ('TECNICO', 'DIRECTOR_TECNICO', 'LECTOR')),
  updated_by_email VARCHAR(254) NULL,
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Append-only audit log (ISO/IEC 17025) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS portal.cal_audit_log (
  id          BIGSERIAL    PRIMARY KEY,
  actor_id    UUID         NULL,
  actor_email VARCHAR(254) NOT NULL,
  entity      VARCHAR(40)  NOT NULL,
  entity_id   VARCHAR(80)  NOT NULL,
  action      VARCHAR(40)  NOT NULL,
  old_value   JSONB        NULL,
  new_value   JSONB        NULL,
  reason      TEXT         NULL,
  at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cal_audit_log_entity ON portal.cal_audit_log (entity, entity_id, id);

CREATE OR REPLACE FUNCTION portal.cal_audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'cal_audit_log is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Row triggers do not fire on TRUNCATE; the test suite relies on that to reset
-- the table. In production nothing issues TRUNCATE on it.
CREATE OR REPLACE TRIGGER trg_cal_audit_log_append_only
  BEFORE UPDATE OR DELETE ON portal.cal_audit_log
  FOR EACH ROW EXECUTE FUNCTION portal.cal_audit_log_append_only();
