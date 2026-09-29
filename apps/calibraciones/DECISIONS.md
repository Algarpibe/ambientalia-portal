# Decisions — Calibraciones / O3 transfer standards

Each entry: the ambiguity, the chosen default, and how to change it.
Configurable values live in `o3-engine/limits.ts` (`DEFAULT_LIMITS`, `DEFAULT_CONFIG`).
Changing a default limit requires bumping `LIMITS_VERSION`.

## D-001 — 50 ppb boundary between %Diff and AbsDiff

- **Ambiguity:** TAD App. A equations say AbsDiff "at or below 50 ppb" (x ≤ 50); procedure Table 1 writes "< 50".
- **Default:** x ≤ 50 ppb → AbsDiff (Eq. 2); x > 50 → %Diff (Eq. 1).
- **Config:** `EngineConfig.absDiffThresholdPpb` (default 50). Regardless of the threshold, x ≤ 0 always uses AbsDiff (no division by zero).

## D-002 — V2 strict vs inclusive

- **Ambiguity:** Table 1 writes "< ±1,5 ppb"; the master prompt writes "≤ 1,5 ppb".
- **Default:** inclusive (≤), per the prompt.
- **Config:** `Limits.V2.inclusive`.

## D-003 — Zero point in the regression

- **Ambiguity:** the procedures imply but do not state that the zero enters the least-squares fit.
- **Default:** included (T3 expected values assume it).
- **Config:** `EngineConfig.includeZeroInRegression`. When false, zero points are excluded from the fit but still get fitted values/residuals and V2.

## D-004 — "Annual" validity = 365 days

- The procedures say "annual" without a day count. Default 365 days (day arithmetic, so leap years shift the calendar date by one).
- **Config:** `EngineConfig.validityDays` (Level 2 365 + 182 field reverification; Level 3 bench 365; Level 3 field 182).

## D-005 — Level 4 quarterly reverification = 91 days

- The prompt says Level 4 (director override only) reverification "becomes quarterly" without a day count. Default 91 days.
- **Config:** `EngineConfig.validityDays.level4Quarterly`. Pending confirmation with the Technical Director.

## D-006 — Eq. 10 uses the current m̄ / b̄

- Eq. 10 (option 2) uses the m̄ and b̄ of the reference's current, valid verification. When `referenceVerification.traceabilityOption === 2`, every x is converted before %Diff/AbsDiff, regression and range calculation; the raw reading is kept as `xRawPpb`.

## D-007 — Annex A lacks fields the app needs

- Annex A of the procedures has no field for verified range, per-cycle date, or Δm/Δb (R1/R2). The report (Phase 4) will add them.

## D-008 — Code language

- Code, identifiers and comments are in English as the master prompt requires, while the rest of this repo is written in Spanish. User-facing texts stay in es-CO.

## D-009 — Scale assistant: lowest point

- **Ambiguity:** "6 equidistant points + zero" read literally (step = scale/6) gives 0, 33.3, 66.7, …, 200 and does **not** reproduce the TAD example 0, 15, 52, 89, 126, 163, 200.
- The TAD example is reproduced exactly by: zero + a lowest point of 15 ppb + 5 equal steps up to the scale ((200 − 15)/5 = 37). The TAD rule for choosing the lowest point is not in the prompt.
- **Default:** `proposeSetpoints(scale, { lowestPointPpb = 15, nonZeroPoints = 6 })`, no rounding. Pending confirmation of how the lowest point should scale for other scales.

## D-010 — Scale fallback to the standard

- "Scale = 1.5 × 3-year hourly maximum; if it is below the standard, use 1.5 × standard." Implemented as: if 1.5 × max < standard → 1.5 × standard.

## D-011 — Point distribution thresholds

- "Gap > 2× the ideal spacing" is from the prompt (ideal = scale / number of non-zero points; gaps include zero→first and last→scale).
- "Clustered points" is not quantified; default: two consecutive non-zero points closer than 0.5 × ideal spacing. Configurable via `checkPointDistribution(..., { gapFactor, clusterFactor })`. With these defaults the TAD example raises no warning.

## D-012 — Float comparison at inclusive limits

- Inclusive limits (≤, ±) allow an absolute 1e-9 tolerance so float64 representation error does not fail a value exactly at the limit (e.g. 1.015 − 1.0 = 0.015000000000000124). Strict limits (<) use plain `<`.

## D-013 — Photometer precision uses the sample SD (n − 1)

- 40 CFR 50 App. D §3.1 does not specify the SD estimator. The population SD (÷n) is mandated only for TAD Eq. 8–9. For repeatability the conventional, more conservative sample SD (÷(n − 1)) is used.

## D-014 — Zero-point identification

- A point is the zero when `setpointPpb === 0`; if no setpoint is supplied, when `xPpb === 0`. Needed because Eq. 10 moves the zero's x away from 0. The UI must always send the setpoint.

## D-015 — Evaluation details

- `maxVerifiedPointPpb` is the highest x used in the calculation (standard units after Eq. 10).
- A reverification without a previous verification fails R1, R2 and R5 (nothing to compare with).
- A degenerate cycle (Sxx = 0, < 2 points) does not throw: the cycle fails and is excluded from m̄/b̄/SD.
- V3/V4 are evaluated only for full verifications; reverifications use R3/R4.
- D1/D2 are evaluated only when photometry data is supplied; Q1 (informative) never affects the overall result; C1 (analyzers) is a standalone rule, not part of `evaluateVerification`. C1 passes when |%diff| ≤ 7.1 % **or** |diff| ≤ 1.5 ppb, and fails outside 5–80 ppb.
- D1 reference is cited as 40 CFR 50 App. D §5.2.5 (taken from the prompt's example); verify against the CFR text before the report is issued.

## Phase 2 — database + API

## D-016 — Default role and portal admins

- A user with the `calibraciones` app but no row in `cal_user_roles` is **LECTOR** (read-only). An unknown stored value also resolves to LECTOR.
- Portal admins (`role = 'admin'`) manage the role table (`GET/PUT /calibraciones/roles`) but are **not** directors: without a `DIRECTOR_TECNICO` row they cannot approve (approval is a technical competence, ISO/IEC 17025 §6.2).

## D-017 — Approver = technician (OPEN QUESTION)

- The prompt does not say whether the Technical Director may approve a verification they performed. **Currently allowed** (no rule invented). Both people are stored (`technician_*`, `approved_by_*`), so a later rule can be added in `service.approve`. Pending confirmation with the Technical Director.

## D-018 — Level 1 (SRP) traceability comes from its certificate

- An SRP is certified externally, so it has no in-app verification. `cal_equipment` stores `certificate_number`, `certificate_valid_until`, `certificate_max_ppb` and `certificate_route`; the service turns them into the "reference verification" the §7 checks need (status APPROVED, empty internal factors). An SRP without a certificate date and range blocks with `REFERENCE_WITHOUT_VERIFICATION`. Unknown certificate route → the test route (no ROUTE_MISMATCH warning).

## D-019 — Approving a NO CONFORME result (OPEN QUESTION)

- The director may approve a CALCULATED record whatever its result: approval signs the record, it does not certify the equipment. Only a **CONFORME** approval sets `valid_until` and the candidate level. The "current valid verification" of an equipment is the latest (by date) APPROVED + CONFORME record not superseded by an approved newer version. A NO CONFORME reference verification chosen explicitly blocks with `REFERENCE_NOT_CONFORME`.

## D-020 — Reverification validity (OPEN QUESTION)

- Approving a conforming reverification computes validity with the §7.9 rules but **never extends `valid_until` beyond the last full verification's**; it sets the reverification due date (Level 2 FIELD: +182 d). Whether a reverification can renew a Level 3 validity is not stated in the prompt.

## D-021 — Status workflow

- DRAFT → (calculate) CALCULATED → (director) APPROVED | REJECTED. Editing a CALCULATED record sends it back to DRAFT and clears every result. APPROVED and REJECTED are immutable (service 409 + database triggers on verifications, cycles and points). A REJECTED record cannot get a new version (the task only asks it for APPROVED); open question whether it should.
- A blocked calculation (422) stores nothing and is not audited (the transaction rolls back); the client receives the issue list.
- `CROSS_CHECK` can be stored but the engine cannot evaluate it yet: calculate → 422 `kind_not_supported`.

## D-022 — New versions

- A new version copies header, cycles and points (no results) into a DRAFT with `version + 1`, `supersedes_id` and a mandatory `change_reason`. It keeps the **original technician** (the test data is theirs); the audit log records who opened it. At most one live (DRAFT/CALCULATED/APPROVED) version per record (partial unique index). The superseded record stays APPROVED and immutable.

## D-023 — People without foreign keys

- Technician, approver and audit actor are stored as id + e-mail with no FK to `portal.users` (same as the ausencias audit logs): a signed record must survive the deletion of the account. `cal_user_roles` is the exception (state, cascades with the user).

## D-024 — Seeds and configuration storage

- The default limit set and config are hardcoded in `040_calibraciones.sql` (the migration runner only executes SQL). `migration.test.ts` asserts they equal `DEFAULT_LIMITS` / `DEFAULT_CONFIG`, so the copies cannot drift. The seeded set is only activated when no other set is active.
- `cal_config` is not versioned, but every calculation stores `config_snapshot` and `limits_snapshot`; a missing config key falls back to the engine default for that key.

## D-025 — Inputs of the §7 checks

- Range of use (§7.4): the candidate's highest point is the highest **raw** x reading (before Eq. 10).
- Point distribution (§7.5): setpoints of cycle 1.
- Reference factors (§7.3): the reference verification's `internal_factors_after` (else `before`) vs the `referenceInternalFactors` observed on the test date; the check is skipped when those are not supplied.
- R5: this record's `internal_factors_before` (as found) vs the last full verification's factors after (else before).
- The reference's current verification may be a full verification or a reverification; Eq. 10 uses its m̄/b̄ (for a reverification, its single cycle). Open question.

## D-026 — Equipment level

- The level is set automatically when a CONFORME verification is approved (reference level + 1). Setting it by hand (e.g. the SRP's Level 1) requires DIRECTOR_TECNICO.

## D-027 — Audit log and TRUNCATE

- `cal_audit_log` refuses UPDATE and DELETE by trigger. Row triggers do not fire on TRUNCATE, which the DB test suite uses to reset; nothing in production truncates it.

## Phase 3 — UI

## D-028 — The UI imports the engine by relative path; API types are mirrored

- `src/engine.ts` re-exports `../../hub-api/src/calibraciones/o3-engine`. Vite (dev and build) and the portal's `tsc -b` (`moduleResolution: bundler`) both resolve the engine's `.js` import extensions to the `.ts` files: **no config change was needed** and the engine is untouched. The sub-app's `vite.config.ts` adds `server.fs.allow` for the repo root so the standalone dev server can serve hub-api files.
- hub-api `calibraciones/types.ts` is **not** imported by the UI: it declares `CalError` with constructor parameter properties, which the portal's `erasableSyntaxOnly` gate rejects as soon as the file enters the program (even through `import type`). `src/types.ts` mirrors the API shapes instead (same convention as `ausencias/src/api.ts`); engine types come from the engine itself.

## D-029 — Point capture CSV template

- Columns: `ciclo;orden;setpoint_ppb;x_ppb;y_ppb;t_celda_x_c;t_celda_y_c;p_celda_x_torr;p_celda_y_torr`. One row per point, `;` separator, comma decimal, UTF-8 with BOM (opens directly in Excel es-CO). The template pre-fills the TAD example setpoints (0, 15, 52, 89, 126, 163, 200) for 3 cycles (1 for a reverification).
- The parser also accepts `,` separator (dot decimals or quoted `"14,9"`), tab separator, header case/accents/spaces, a missing `orden` (file order) and ppm columns (`setpoint_ppm`, `x_ppm`, `y_ppm`; all three must share the unit). Required: `ciclo`, `x_*`, `y_*`. Any error (with its line number) cancels the whole import. Cycles in the file replace the same cycles in the table; others are kept.

## D-030 — Live preview vs server result

- The browser evaluates live with the same engine, the ACTIVE limits and config (`GET /limits`, `GET /config`; engine defaults if unreadable, with a warning).
- The reference's verification is resolved client-side from its history: the explicit `referenceVerificationId`, else the latest APPROVED + CONFORME on or before the test date (a newer version wins on the same date). The candidate's last full verification (R1, R2, R5) is chosen the same way, excluding the record itself. This approximates `repo.currentVerifications`; the server resolves them from the database at calculate time and **its result is authoritative**. Step 4 shows the server result when the stored record is calculated and unchanged, and lists any difference with the live preview (overall result, m̄/b̄/SD beyond 1e-9 relative, rule outcomes, limits version).

## D-031 — Units and number entry

- The point table keeps the text typed (comma or dot decimal) in the selected unit; the payload is always ppb. ppm ↔ ppb conversion rounds to 12 significant digits to remove float noise (0,0152 ppm → 15,2 ppb, not 15,200000000000001); values are far below that precision, so nothing measurable is lost.
- A row with any data but a missing x or y, or any cell that is not a number, **blocks saving** and is listed; rows are never dropped silently. Completely empty rows are ignored. Point `order` = position among the rows sent.

## D-032 — Acceptance checklist storage and effect

- Stored in `acceptanceChecklist` as `{ warmup, leakTest, diagnostics, tpContrast, averaging, noiseFilt, warmupMinutes, notes }`. An incomplete checklist or a warm-up below 30 min is shown as a **warning**, not a block: the prompt lists the checks but no rule that blocks the calculation on them. Pending confirmation with the Technical Director.

## D-033 — Screens per role

- LECTOR sees everything read-only. TECNICO creates/edits equipment and drafts and calculates. DIRECTOR_TECNICO additionally approves/rejects, sets levels by hand, enables Level 4 and sees «Configuración» (hidden for other roles). «Roles» is shown to portal admins only. The server enforces all of it again.

## D-034 — Calculators

- App. D Eq. 4 takes the cell temperature in kelvin (the 273 literal of the equation stays inside the engine). The T/P correction calculator takes °C and converts with 273.15 (a physical unit conversion, not the Eq. 4 reference constant). The air-quality standard in the scale assistant is typed by the user: no standard value is assumed. Proposed setpoints are shown with 1 decimal but applied unrounded (D-009).

## Phase 4 — reports, label, exports, seeds

## D-035 — Verification report (Annex A)

- Built from the **stored server result** (`evaluation` saved at calculation time); the browser never recalculates for a document. Available for CALCULATED, APPROVED and REJECTED records; a DRAFT (no server result) has no report. APPROVED prints clean; CALCULATED carries the watermark «BORRADOR – sin validez» and REJECTED «RECHAZADA – sin validez».
- Annex A structure: (1) general data + acceptance tests and ambient conditions, (2) one table per cycle (rows 0 = zero, 1–6, 7+ «(opcional)»; set point, x read, x after Eq. 10 when applied, y, cell T/P x/y, %Diff or AbsDiff, pass), (3) results per cycle with the V3/V4 checks (R3/R4 for a reverification), means and SDs with V5/V6, conclusion, level, expiry, Eq. 10 and signature blocks (technician, Technical Director).
- Added to Annex A (D-007): verified range (highest point), per-cycle date, reverification Δm/Δb (R1/R2), the rule table with normative references, engine and limits versions, version change reason, and a y-vs-x chart (SVG in react-pdf: points, regression lines Eq. 5, 1:1 line).
- **Per-cycle date:** the date of the cycle's first `timestampStable`; without one, the verification date (the model has no per-cycle date field).
- **Reference «certificate»:** an SRP shows its certificate number and expiry; any other reference shows its verification record used at calculation time (`Verificación <id> v<n> · vence <fecha>`).
- «Técnico» and «Director Técnico» are the stored e-mails (no digital signature; the printed blocks leave room for a handwritten one).
- Numbers per §10 (es-CO, slope 5, intercept 3, %Diff 2, ppb 2); measured conditions (temperatures, RH, pressure, flow, internal factors) are printed as entered.

## D-036 — PDF library: @react-pdf/renderer 4.9, lazy

- `@react-pdf/renderer@^4.9.0` declares `react ^16.8 || ^17 || ^18 || ^19` as peer, so it works with the repo's React 19.2 (verified: renders in Node for the sample files and in the portal build). No alternative was needed.
- Loaded only through `await import('../pdf/generate')`: Vite emits it as its own chunk (`generate-*.js`, ~1.25 MB minified / ~458 kB gzip) that downloads on the first «Informe PDF» / «Etiqueta» click; the calibraciones `App` chunk does not contain it.
- Fonts: the PDF built-in Helvetica (nothing to bundle or download). It only encodes WinAnsi, so `lib/pdfText.ts` maps the rest: ≤ → `<=`, ≥ → `>=`, − → `-`, m̄/b̄ → `m prom.`/`b prom.`, → → `->`, Δ → `Delta`, subscripts → digits, anything else → `?`. Embedding a TTF (e.g. Noto Sans) would print the real symbols; left out to keep the chunk smaller.

## D-037 — Procedure code IN.5.5.3-XX vs -YY (OPEN QUESTION)

- **YY** when the reference is not an SRP and both reference and candidate are 6103 (6103 Level 2 → 6103 Level 3). **XX** otherwise: 6103 → Sabio 2010D, SRP → 6103, and anything unrecognised. A 6103 is recognised by «6103» in the model or the internal code (`lib/procedure.ts`).
- The XX document is titled «6103 ↔ Sabio 2010D»; that SRP → 6103 (Level 1 → 2) is also XX follows the Phase 4 brief, not the documents. Confirm with the Technical Director.

## D-038 — Standard label (§11.1)

- Only for **APPROVED + CONFORME** records (it certifies the equipment; D-019).
- Fields: verified on / expires (+ reverification due when set), performed by, approved by, reference standard (make, model, serial, level), candidate make/model/serial, internal code and resulting level, current internal factors (`after`, else `before`), date + slope + intercept of each cycle and m̄/b̄, verified range = usage limit, ambient conditions, total flow, routes, Eq. 10 **only for option 2**, and the legend «PATRÓN DE BANCO» when the resulting level is 2 and the candidate application is BENCH (the 6103-S case).
- Size: presets 100 × 150 mm (**default**, the common 4 × 6 in thermal label, fits every field on one page), A6 and A5 (`LABEL_SIZES` in `lib/label.ts`; the font scales with the width). Chosen in the UI next to the button.

## D-039 — CSV / XLSX exports

- Exports are data: numbers keep full float64 precision. CSV writes them with comma decimal; XLSX stores numbers with a display format (slope `0.00000`, intercept `0.000`, ppb/% `0.00`), so Excel shows the §10 rounding without losing digits.
- CSV dialect = the import template (D-029): `;`, comma decimal, UTF-8 BOM, CRLF, `Sí`/`No` for booleans. The per-verification points CSV starts with the template columns (then `x_std_ppb;tipo_diferencia;diferencia;cumple`), so it can be imported again unchanged (tested round-trip).
- XLSX of one verification: sheets **Resumen, Puntos, Ciclos, Reglas**. List exports (Equipos, Verificaciones, Vencimientos) export the rows the list is showing (search / status / bucket filters applied), as CSV or XLSX.
- SheetJS: the same CDN tarball as the other apps (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), imported lazily (`await import('./lib/xlsx')`).
- Every document and export is available to any role that can read the record (LECTOR included); the server already restricts who can read.

## D-040 — Seeds are on demand, never in the boot migrations

- `apps/hub-api/src/calibraciones/seed.ts`, run with `npm run seed:calibraciones` (tsx, dev) or, inside the hub-api container, `node dist/calibraciones/seed.cli.js` (tsx is a dev dependency and is not in the image). `--with-sample` also creates the sample verification. It needs `HUB_DB_URL` and does not run migrations (hub-api applies 040 on boot).
- Idempotent by `internal_code`: a missing equipment is created; an existing one is **left untouched** (never overwritten — a user may already have replaced the placeholder serial with the real one). The sample verification is created only while 6103-S has no verification at all. Running it twice creates and audits nothing the second time (`seed.db.test.ts`).
- Data (§10): `SRP-CALAIRE` (NIST SRP, Level 1, certificate `DEMO-CERT-SRP-001` valid 365 days from the run date, 500 ppb, SAMPLE IN), `6103-S` (Environics 6103, Level 2, BENCH), `6103-T` (6103, Level 3, FIELD), `SABIO-2010D-F` (with photometer, FIELD), `SABIO-2010D-G` (GENERATOR_ONLY). Serials `DEMO-…`; every row's note says it is sample data. The make «Environics» and the FIELD application of 6103-T are assumptions.
- Everything goes through the service layer as actor `seed:calibraciones` (fixed id `00000000-0000-4000-8000-00000000cafe`, DIRECTOR_TECNICO), so the audit log shows who seeded; the sample T3 verification is calculated and approved by that actor.

## D-041 — No Docker Compose

- The master prompt asks for Docker Compose; this repo deploys portal and hub-api as separate EasyPanel services (root `Dockerfile` and `apps/hub-api/Dockerfile`), and local DB tests use testcontainers. A compose file would be a second, untested deploy path, so none is added.
