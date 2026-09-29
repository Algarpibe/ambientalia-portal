# Calibraciones app

Internal portal app for Ambientalia S.A.S. that calculates, evaluates and manages
calibration records. One tab per calibration type; the first tab is
**«Verificación Patrones de Ozono»** (O3 transfer standards, procedures
IN.5.5.3-XX and IN.5.5.3-YY, chapters 10–11).

Full functional spec: `verificacion-patrones-o3/Prompt_Maestro_App_Verificacion_Patrones_O3.md`.
Ambiguities and assumptions: `DECISIONS.md` (update it whenever you make one).

## Stack decision

The master prompt assumes Next.js + Prisma + NextAuth. This repo does not use
them, so the app integrates with the existing portal instead:

| Prompt | Used here |
|---|---|
| Next.js App Router | Vite + React sub-app in `apps/calibraciones`, lazy-loaded by the portal (same pattern as `apps/ausencias`) |
| Prisma + Postgres | hub-api Postgres with raw SQL + numbered migrations in `apps/hub-api/src/users/migrations/` registered in `src/db.ts` |
| NextAuth + roles | Portal JWT (`requireApp('calibraciones')`) + own role table (TECNICO / DIRECTOR_TECNICO / LECTOR) |
| `/packages/o3-engine` | `apps/hub-api/src/calibraciones/o3-engine/` (the hub-api Dockerfile only installs its own package.json). The UI imports the engine by relative path for live calculation; the server recalculates authoritatively on save |
| Docker Compose | Existing EasyPanel deploy (portal + hub-api); no compose file (D-041) |

## Calculation engine (`apps/hub-api/src/calibraciones/o3-engine/`)

- Pure TypeScript: **zero imports outside the folder** (no Node APIs, no DB, no UI). Enforced by `index.test.ts`.
- Deterministic, float64, **no intermediate rounding**.
- ESM with `.js` import extensions (hub-api convention).
- Every function documents its normative reference (e.g. "TAD 2023 App. A Eq. 8").
- `ENGINE_VERSION` (`version.ts`) and `LIMITS_VERSION` (`limits.ts`) are stored with every verification. Bump them on any behavior or default-limit change so old verifications stay reproducible.
- Modules: `units`, `differences` (Eq. 1–2), `regression` (Eq. 3–5), `statistics` (Eq. 6–9, population SD), `equation10`, `photometry` (App. D), `limits`, `rules` (V1–V8, R1–R5, Q1, D1, D2, C1), `traceability` (§7), `evaluate`, `index`.

## Database (migration `040_calibraciones.sql`, schema `portal`)

Registered in `MIGRATIONS` (`src/db.ts`); re-runs on every boot, so it is idempotent.

| Table | Content |
|---|---|
| `cal_equipment` | brand, model, serial, `internal_code` (unique), type, has_photometer, application, current_level, notes, SRP certificate fields (D-018), active |
| `cal_verifications` | §4 header + results + reproducibility (`engine_version`, `limits_version`, `limits_snapshot`, `config_snapshot`, `engine_input`, `evaluation`) + versioning (`version`, `supersedes_id`, `change_reason`, `rejection_reason`) |
| `cal_cycles`, `cal_points` | cascade from the verification; points store inputs (`x_ppb` as indicated) and computed `x_std_ppb` (after Eq. 10), diff, pass |
| `cal_limit_sets` | versioned limits (`version` unique, one `active`), seeded with `DEFAULT_LIMITS` |
| `cal_config` | key → jsonb (`absDiffThresholdPpb`, `includeZeroInRegression`, `validityDays`) |
| `cal_user_roles` | user_id → TECNICO / DIRECTOR_TECNICO / LECTOR |
| `cal_audit_log` | append-only (trigger refuses UPDATE/DELETE): actor, entity, entity_id, action, old/new value, reason, at |

APPROVED/REJECTED verifications, their cycles and points are locked by triggers too.

## API (`apps/hub-api/src/calibraciones/`, mounted under `/api`, `requireAuth` + `requireApp('calibraciones')`)

Files: `router.ts` (HTTP + error mapping), `service.ts` (rules, transactions, audit), `repo.ts` (raw SQL), `types.ts` (types + input parsing), `roles.ts` (permission matrix).
Errors: `{ error: code, message: <es-CO>, field?, detail? }`; 400 invalid input, 403 role, 404, 409 state/lock/duplicate, 422 traceability or structure.

| Method | Path | Role |
|---|---|---|
| GET | `/calibraciones/roles/me` | any |
| GET · PUT | `/calibraciones/roles` · `/calibraciones/roles/:userId` `{role}` | portal admin |
| GET · POST | `/calibraciones/equipment` (`?today=`) | read · TECNICO+ |
| GET · PATCH | `/calibraciones/equipment/:id` (detail: ancestors, descendants, validity, history) | read · TECNICO+ (level: director) |
| GET | `/calibraciones/expirations?today=` (buckets EXPIRED, DUE_TODAY, DUE_15, DUE_30, OK) | read |
| GET | `/calibraciones/downstream-impact/:equipmentId` | read |
| GET · POST | `/calibraciones/verifications` (`?equipmentId=&status=`) | read · TECNICO+ |
| GET · PUT · DELETE | `/calibraciones/verifications/:id` (PUT replaces header + cycles + points) | read · TECNICO+ (not APPROVED/REJECTED) |
| POST | `/calibraciones/verifications/:id/calculate` | TECNICO+ |
| POST | `/calibraciones/verifications/:id/approve` · `/reject {reason}` | DIRECTOR_TECNICO |
| POST | `/calibraciones/verifications/:id/new-version {reason}` | TECNICO+ |
| POST | `/calibraciones/verifications/:id/recalculate-check` | read |
| GET · PUT | `/calibraciones/limits` `{version, limits, reason}` | read · DIRECTOR_TECNICO |
| GET · PUT | `/calibraciones/config` `{config, reason}` | read · DIRECTOR_TECNICO |
| GET | `/calibraciones/audit?entity=&entityId=` | read |

Level 4 override (`directorOverrideLevel4`) can only be set by DIRECTOR_TECNICO.

## UI (`apps/calibraciones/src/`)

Vite + React sub-app, default export `App.tsx`, lazy-loaded by the portal at `/calibraciones/*` (registered in `portal/src/lib/apps.ts`, `portal/src/App.tsx`, `portal/src/pages/Aplicaciones.tsx`, `portal/tailwind.config.js` and the root `Dockerfile`).

- **Hash routing** (`lib/hash.ts`): `#<type>/<section>/<id>`. Top-level tabs = calibration types (`CALIBRATION_TYPES`; today only `o3` «Verificación Patrones de Ozono»). A new type = new entry + its own tab component in `App.tsx`.
- **O3 sections** (`o3/O3Tab.tsx`): Equipos · Verificaciones · Calculadoras · Vencimientos · Configuración (only with `limits.write`/`config.write`, i.e. DIRECTOR_TECNICO) · Roles (portal admins, `canManageRoles`). Actions are shown per `GET /roles/me` `permissions`; LECTOR is read-only.
- **Wizard** (`o3/wizard/`): 1 setup + live §7 traceability (blocking vs warnings, plus the server 422 list) · 2 checklist + lab conditions + App. D data · 3 points per cycle (ppb/ppm toggle, comma decimals, CSV template/import, scale assistant, live calc) · 4 results (server result when calculated, else live preview; differences listed) with rules table and Recharts charts · 5 review/approval, locked banner, new version, reproducibility check, delete draft.
- **Engine in the browser**: `src/engine.ts` re-exports `../../hub-api/src/calibraciones/o3-engine` (the same code the server runs). No UI module imports the engine from anywhere else. hub-api `types.ts` is **not** imported (see D-028): `src/types.ts` mirrors the API shapes.
- **Pure, tested modules** (`src/lib/*.test.ts`): `format` (§10 rounding, es-CO), `parse` (comma/dot decimals), `csv` (template + parser), `draft` (wizard state ↔ payload ↔ engine input), `traceabilityLive`, `results` (rule formatting, chart series, live vs server comparison), `calculators`, `apiError`, `hash`, `domain`, `report` (Annex A view model), `label` (§11.1 model + sizes), `procedure` (XX/YY), `exports` (CSV + sheet specs), `xlsx` (SheetJS writer), `chartGeometry` (PDF chart), `pdfText` (WinAnsi mapping). Test data: `lib/fixtures.test-data.ts` (T3 evaluated by the engine).
- **Documents** (step 5 «Documentos y exportaciones», `o3/VerificationDocuments.tsx`): Informe PDF (CALCULATED/REJECTED watermarked, APPROVED clean), Etiqueta (APPROVED + CONFORME only, size selectable, default 100 × 150 mm), CSV of points (re-importable) and XLSX (Resumen, Puntos, Ciclos, Reglas). Lists (Equipos, Verificaciones, Vencimientos) have «Exportar CSV / XLSX» (`o3/ListExport.tsx`) of the rows shown. Any role can download.
- **PDF** (`src/pdf/`): `ReportDocument`, `LabelDocument` (react-pdf, built-in Helvetica, text through `pdfSafeDeep`), `generate.tsx` = the only entry point, always imported with `await import()` so @react-pdf/renderer stays in its own lazy chunk (D-036). SheetJS is lazy too (`await import('../lib/xlsx')`).

## Conventions

- Code, identifiers and comments in **English** (per the prompt; the rest of the repo uses Spanish).
- UI and user-facing rule texts (`textEs`, `messageEs`) in **Spanish (es-CO)**, comma decimal.
- Concentrations stored and computed in **ppb**; UI accepts ppm or ppb and converts.
- Display rounding only (never in the engine): slope 5 decimals, intercept 3, %Diff 2, ppb 2.
- Strict TDD: tests first, next to the code (`*.test.ts`).
- Never edit files with PowerShell `Set-Content`/`Out-File` (corrupts accented characters).

## Commands

```bash
cd apps/hub-api
npx vitest run src/calibraciones   # engine + API unit tests (run from apps/hub-api, not the repo root)
npx tsc --noEmit                   # typecheck
npm run test:db -- calibraciones   # Postgres tests (Docker / testcontainers)
npm run seed:calibraciones [-- --with-sample]   # ON-DEMAND demo data, needs HUB_DB_URL (container: node dist/calibraciones/seed.cli.js)

cd apps/calibraciones
npx vitest run                     # UI pure-logic tests (node environment, no jsdom)
npx tsc --noEmit -p tsconfig.json  # typecheck (also type-checks the engine through the relative import)
npm run dev                        # standalone dev server on http://localhost:5186 (needs VITE_HUB_API_URL and a portal token in localStorage)

npm run build --workspace=apps/portal   # repo root: tsc -b + vite build, the real integration gate
```

## Normative references

- **EPA-454/B-22-003** (TAD, Jan 2023) — *Transfer Standards for Calibration of Air Monitoring Analyzers for Ozone*: App. A Eq. 1–10, Table 4-1, §3.2 (photometer required), §4.5 (Level 4 discouraged).
- **40 CFR Part 50, Appendix D** — UV photometry: Eq. 4 (concentration, α = 308, 273 literal), Eq. 6 (dilution), §5.2.3 (linearity), §3.1 (precision), O3 loss ≤ 5 %.
- Internal procedures IN.5.5.3-XX (6103 ↔ Sabio 2010D) and IN.5.5.3-YY (6103 Level 2 → Level 3), chapters 10–11 and Annex A.
- ISO/IEC 17025: immutable audit log, versioned limits, reproducibility.

## Roadmap

1. **Phase 1 — engine** with tests T1–T7 green. *(done)*
2. **Phase 2 — DB + API**: migration, router/service/repo/types/roles, append-only audit log, APPROVED records locked (new version with reason). *(done, not deployed)*
3. **Phase 3 — UI**: Vite sub-app, 5-step wizard with live calculation, calculators, expirations, configuration, roles; registered in the portal. *(done, not deployed)*
4. **Phase 4 — reports**: Annex A PDF report, §11.1 label, CSV/XLSX exports (one verification + lists), on-demand seeds (`seed.ts`, not in the migrations), expiration board and downstream impact (from Phase 3). *(done, not deployed)*

### Pending

- **E2E / browser test** of the whole flow (create → calculate → approve → PDF/label/XLSX download) against a real hub-api; only pure logic, DB and a Node render of the PDFs are tested.
- **Deploy order: hub-api first, then portal** (the UI calls `/api/calibraciones/*`; migration 040 runs on hub-api boot). Seeds only if wanted, by hand, after the first boot.
- Do not commit/push hub-api changes until the user says so (pushing = deploying).

### Open questions for the Technical Director (consolidated)

| # | Question | Current default |
|---|---|---|
| D-005 | Days of the Level 4 quarterly reverification | 91 days |
| D-009 | How the lowest set point scales with the calibration scale | 15 ppb + 5 equal steps |
| D-015 | D1 reference (40 CFR 50 App. D §5.2.5) to check against the CFR text | as in the prompt |
| D-017 | May the director approve a verification they performed? | allowed |
| D-019 | Approving a NO CONFORME result (signs the record, no validity) | allowed |
| D-020 | Can a reverification renew a Level 3 validity? | never extends `valid_until` |
| D-021 | May a REJECTED record get a new version? | no |
| D-025 | May a reverification serve as the reference's current verification (Eq. 10)? | yes |
| D-032 | Should an incomplete checklist / warm-up < 30 min block the calculation? | warning only |
| D-037 | Is SRP → 6103 (Level 1 → 2) governed by IN.5.5.3-XX? | XX |
| D-038 | Label size and the exact «patrón de banco» rule | 100 × 150 mm; level 2 + BENCH |
| D-040 | Real make/serials/certificate of the seeded equipment | `DEMO-…` placeholders |
