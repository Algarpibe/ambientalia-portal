# PROMPT MAESTRO – App de verificación de patrones de transferencia de ozono (TAD 2023 + 40 CFR 50 App. D)

> Copia todo lo que está debajo de la línea en una sesión nueva de Claude Code, dentro de una carpeta vacía del proyecto.

---

## 1. Rol y contexto

Actúa como ingeniero de software sénior con experiencia en metrología y aseguramiento de calidad en laboratorios (ISO/IEC 17025). Vas a construir, para **Ambientalia S.A.S.** (Colombia), una aplicación web interna que **calcula, evalúa y gestiona** las verificaciones de patrones de transferencia de ozono (O₃).

La app se basa en dos procedimientos internos ya redactados:

- **IN.5.5.3-XX** – Transferencia de trazabilidad de O₃ entre Environics 6103 y Sabio 2010D.
- **IN.5.5.3-YY** – Transferencia de trazabilidad de O₃ entre dos Environics 6103 (Nivel 2 → Nivel 3).

Su alcance funcional son los **capítulos 10 (Cálculos) y 11 (Criterios de aceptación y registros)** de esos procedimientos, que aplican:

- **EPA-454/B-22-003** – *Transfer Standards for Calibration of Air Monitoring Analyzers for Ozone* (TAD, enero 2023), en especial el Apéndice A (ecuaciones 1 a 10) y la Tabla 4-1.
- **40 CFR Parte 50, Apéndice D** – fotometría UV del ozono (ecuación 4, dilución, linealidad y pérdidas).

La interfaz debe estar en **español de Colombia**. El código, los identificadores y los comentarios van en inglés.

## 2. Objetivo de la app

1. Registrar equipos (patrones y candidatos) y su posición en la cadena de trazabilidad (Nivel 1, 2 o 3).
2. Capturar los datos de una verificación (3 ciclos) o de una reverificación (1 ciclo): puntos, lecturas x/y, temperatura, presión y metadatos.
3. **Calcular automáticamente** las ecuaciones del TAD y del App. D y **evaluar cada criterio de aceptación**, con un resultado CONFORME o NO CONFORME y los motivos.
4. Hacer cumplir las **reglas de trazabilidad** (jerarquía, vigencias, rango de uso, prohibición de ajustes antes de una reverificación, etc.).
5. Generar el **informe de verificación**, la **etiqueta del patrón** y la exportación de datos. Alertar de vencimientos.

## 3. Stack técnico (por defecto)

- **Next.js 14+ (App Router) + TypeScript estricto**, con Tailwind CSS.
- **PostgreSQL + Prisma**. Debe poder desplegarse en un VPS propio con Docker Compose.
- **Motor de cálculo como paquete TypeScript puro** (`/packages/o3-engine` o `/lib/engine`), sin dependencias de UI ni de base de datos, 100 % determinista y **cubierto con Vitest**. La UI y la API solo llaman a este motor.
- Gráficos con Recharts. Informes PDF con `@react-pdf/renderer` o Playwright (HTML → PDF). Exportación a CSV y XLSX (SheetJS).
- Autenticación sencilla (NextAuth con credenciales) y roles `TECNICO`, `DIRECTOR_TECNICO` y `LECTOR`.

Si ves una razón técnica fuerte para cambiar algo del stack, proponla en el plan **antes** de implementar.

## 4. Modelo de datos (mínimo)

- **Equipment**: `id, brand, model, serial, internalCode (p. ej. "6103-S"), type (SRP | PHOTOMETRIC_CALIBRATOR | GENERATOR_ONLY | ANALYZER), hasPhotometer (bool), application (BENCH | FIELD), currentLevel (1–4 | null), notes`.
- **Verification**:
  - `id, kind (VERIFICATION_3_CYCLES | REVERIFICATION_1_CYCLE | CROSS_CHECK), date, location, technicianId, approvedById, status (DRAFT | CALCULATED | APPROVED | REJECTED)`
  - `referenceEquipmentId (x), candidateEquipmentId (y), referenceVerificationId` (verificación vigente del patrón)
  - `referenceRoute y candidateRoute (SAMPLE_IN | INTERNAL | OTHER)`
  - `traceabilityOption (1 = ajuste de factores | 2 = Ecuación 10)`, `internalFactorsBefore/After (JSON: span, zero)`
  - `labTempStart/End (°C), labRH (%), baroPressure (torr), totalFlowSLPM, calibrationScalePpb`
  - resultados agregados: `meanSlope, meanIntercept, sdSlope, sdIntercept, maxVerifiedPointPpb, overallResult, failReasons[], validUntil`
- **Cycle**: `id, verificationId, index (1–3), slope, intercept, r2, result`.
- **Point**: `id, cycleId, order, setpointPpb, xPpb, yPpb, xRaw?, cellTempX/Y (°C), cellPressX/Y (torr), readingsCount, timestampStable?, diffValue, diffType (PERCENT | ABS_PPB), pass`.
- **AuditLog**: quién, qué y cuándo, con el valor anterior y el nuevo. Es obligatorio por ISO/IEC 17025.

Todos los valores de concentración se guardan internamente en **ppb** (float64). La UI acepta la entrada en ppm o ppb y convierte.

## 5. Motor de cálculo – ecuaciones exactas

Implementa cada ecuación como una función pura, documentada con su referencia normativa.

### 5.1 TAD 2023 – Apéndice A

Notación: `x` = patrón (mayor autoridad), `y` = candidato, `i` = ciclo, `j` = punto.

- **Ec. 1 – Diferencia porcentual** (puntos con x > 50 ppb): `%Diff = |y − x| / x × 100`
- **Ec. 2 – Diferencia absoluta** (puntos con x ≤ 50 ppb, incluido el cero): `AbsDiff = y − x` [ppb]
  - El umbral de 50 ppb debe ser **configurable**. Por defecto, x ≤ 50 usa AbsDiff, según el Apéndice A ("at or below 50 ppb").
  - Nunca dividir por x = 0.
- **Ec. 3–4 – Regresión por mínimos cuadrados de cada ciclo** (y en función de x), usando **todos** los puntos del ciclo, **incluido el cero** (configurable, por defecto incluido):
  - `m_i = Σ(x−x̄)(y−ȳ) / Σ(x−x̄)²`
  - `b_i = ȳ − m_i·x̄`
  - Reportar también r² como dato informativo.
- **Ec. 5 – Valor ajustado:** `ŷ = b_i + m_i·x`. Reportar también los residuos.
- **Ec. 6 y 7 – Promedios:** `m̄ = (1/3)Σm_i` y `b̄ = (1/3)Σb_i`.
- **Ec. 8 y 9 – Desviación estándar POBLACIONAL (dividir entre 3, no entre 2):** `SDm = √[(1/3)Σ(m_i − m̄)²]` y `SDb = √[(1/3)Σ(b_i − b̄)²]`. **Esto es crítico: no usar n−1.**
- **Ec. 10 – Concentración patrón** (Opción 2): `Std = (1/m)·(Indicated − b)`, con la m̄ y la b̄ vigentes del equipo patrón. Si la verificación del patrón usó la Opción 2, **convertir cada x con la Ec. 10 antes** de hacer la regresión del candidato. Esto debe ocurrir automáticamente cuando `referenceVerification.traceabilityOption = 2`.

### 5.2 40 CFR 50 Apéndice D (módulo "Fotometría")

- **Ec. 4 – Concentración fotométrica:** `[O3] (ppm) = (−1/(α·l))·ln(I/I0) · (T/273) · (760/P) · (10⁶/L)`
  - α = 308 atm⁻¹cm⁻¹ (254 nm, 0 °C, 760 torr); l en cm; T en K; P en torr.
  - `L = 1 − fracción de O₃ perdida`. **Validar que la pérdida sea ≤ 5 %** (L ≥ 0,95).
  - Usar 273 tal como aparece en la norma (no 273,15).
- **Ec. 6 – Dilución:** `[O3]' = [O3] · F0 / (F0 + FD)`.
- **Linealidad (§5.2.3):** `E(%) = (A1 − A2/R) / A1 × 100`, donde A1 es la concentración original, A2 la concentración diluida y `R = F0/(F0+FD)`. Criterio: |E| < 3 %.
- **Precisión del fotómetro (§3.1):** desviación estándar de lecturas repetidas ≤ máx(5 ppb, 3 % de la concentración).
- **Sensibilidad (informativa):** mostrar que un error de 3 °C o de 7,5 torr equivale a ≈ 1 % en O₃. Incluir una calculadora de corrección T/P. A 1.500 m s. n. m. (Medellín), P ≈ 640 torr.

## 6. Criterios de aceptación (TAD 2023, Tabla 4-1)

Implementa cada criterio como una **regla con identificador**, texto en español, valor calculado, límite y resultado. Guarda los límites en una **tabla de configuración versionada**, con los valores por defecto siguientes. Si un director cambia un límite, queda registrado en la auditoría.

| ID | Aplica a | Regla | Límite por defecto |
|---|---|---|---|
| V1 | Verificación y reverificación, cada punto | %Diff (x > 50 ppb) | < 3,1 % |
| V2 | Verificación y reverificación, cada punto | \|AbsDiff\| (x ≤ 50 ppb) | ≤ 1,5 ppb |
| V3 | Verificación, cada ciclo | Pendiente m_i | 1,00 ± 0,03 |
| V4 | Verificación, cada ciclo | Intercepto b_i | 0 ± 3 ppb |
| V5 | Verificación | SDm | < 0,0075 |
| V6 | Verificación | SDb | < 1,00 ppb |
| V7 | Verificación | Número de ciclos | = 3 (mínimo) |
| V8 | Todo ciclo | Puntos por ciclo | cero + ≥ 6 puntos |
| R1 | Reverificación | \|m − m̄(última verificación)\| | ≤ 0,015 |
| R2 | Reverificación | \|b − b̄(última verificación)\| | ≤ 1,5 ppb |
| R3 | Reverificación | Pendiente | 1,00 ± 0,03 |
| R4 | Reverificación | Intercepto | 0 ± 3 ppb |
| R5 | Reverificación | Factores internos idénticos a los de la última verificación | Sin cambios; si cambiaron, se exige verificación de 3 ciclos |
| Q1 | Calificación (informativo) | Repetibilidad frente a variables de influencia | ±4 % o ±4 ppb (el mayor) |
| D1 | App. D | Pérdida de O₃ | ≤ 5 % |
| D2 | App. D | Error de linealidad | < 3 % |
| C1 | Analizadores (módulo opcional) | Verificación de un punto (5–80 ppb) | ±7,1 % o ±1,5 ppb |

Reglas de resultado:

- **Resultado global:** CONFORME solo si se cumplen todas las reglas aplicables. Si no, NO CONFORME, con la lista de reglas fallidas y sus valores.
- **Reverificación fallida:** la app marca que el equipo requiere una verificación completa de 3 ciclos.

## 7. Reglas de trazabilidad y negocio (validaciones antes de calcular)

1. **Nivel del candidato = nivel del patrón + 1.**
   - Nivel 2: exige un patrón de Nivel 1 (SRP).
   - Nivel 3: exige un patrón de **Nivel 2 de banco** (`application = BENCH`).
   - Nivel 4: bloquear por defecto, con un aviso de "fuertemente desaconsejado (TAD §4.5)". Solo un director puede habilitarlo, y en ese caso la reverificación pasa a ser trimestral.
2. Un equipo `GENERATOR_ONLY` o sin fotómetro **no puede ser candidato ni patrón** (TAD 2023 §3.2).
3. El patrón debe tener una verificación **APPROVED y vigente** en la fecha de la prueba, y no debe haber cambiado sus factores internos desde esa verificación.
4. **Rango de uso:** el punto más alto del candidato debe ser ≤ al punto más alto verificado del patrón. El rango verificado del candidato queda como su límite de uso. Advertir si se registran usos por encima de ese límite.
5. **Distribución de puntos:** avisar si los puntos no están aproximadamente repartidos entre el cero y la escala (por ejemplo, si algún hueco supera el doble del espaciado ideal o si hay varios puntos agrupados).
6. **Asistente de escala:** escala = 1,5 × el máximo horario de 3 años. Si queda por debajo de la norma, usar 1,5 × la norma. Proponer 6 puntos equidistantes y un cero (ejemplo del TAD con escala de 200: 0, 15, 52, 89, 126, 163, 200).
7. **Condiciones ambientales:** avisar si la temperatura del laboratorio está fuera de 20–30 °C.
8. **Rutas de medición:** guardar la ruta del patrón y la del candidato. Avisar si la ruta del patrón difiere de la ruta con la que ese patrón fue verificado.
9. **Vigencias:**
   - Nivel 2: verificación anual contra el SRP. Si es de campo, además reverificación cada 182 días.
   - Nivel 3 de banco: 365 días.
   - Nivel 3 de campo: 182 días.
   - Mostrar un tablero de vencimientos con alertas a 30, 15 y 0 días.
10. **Impacto aguas abajo:** si un patrón resulta NO CONFORME, listar todos los equipos verificados con él desde su última verificación válida, para evaluar el impacto.

## 8. Pantallas / flujo

1. **Equipos:** listado, alta y detalle con el árbol de trazabilidad (SRP → Nivel 2 → Nivel 3), el estado de vigencia y el historial.
2. **Nueva verificación (asistente):**
   - Paso 1 – tipo (verificación o reverificación), patrón y candidato, rutas y opción de trazabilidad. Aquí se validan las reglas del §7.
   - Paso 2 – pruebas de aceptación (checklist: calentamiento ≥ 30 min, prueba de fugas, diagnósticos, contraste de T/P, AVERAGING y NOISE FILT) y condiciones ambientales.
   - Paso 3 – captura de puntos por ciclo, en una tabla editable o importando un CSV con la plantilla que la app entrega. **El cálculo se actualiza en vivo** a medida que se escriben los datos.
   - Paso 4 – resultados: tabla de puntos con semáforo, pendiente e intercepto por ciclo, promedios y desviaciones, tabla de reglas, gráfico de y contra x con las rectas de regresión y la línea 1:1, y gráfico de residuos.
   - Paso 5 – revisión y aprobación por el Director Técnico. Una vez APPROVED, el registro queda **bloqueado**; cualquier cambio exige una nueva versión con su motivo.
3. **Calculadoras independientes:** Ec. 4 del App. D, dilución, linealidad, pérdida de O₃, Ec. 10 y verificación de un punto de analizadores.
4. **Informes:**
   - PDF del informe de verificación, con el formato del Anexo A de los procedimientos.
   - **Etiqueta del patrón** con los campos del §11.1: fechas de verificación y de vencimiento, responsable, patrón usado, marca/modelo/serie y nivel, factores internos, pendientes e interceptos de cada ciclo, m̄ y b̄, rango verificado, rutas y la Ec. 10 vigente si aplica.
   - Exportación a CSV y XLSX.
5. **Configuración:** límites de los criterios (versionados), umbral de 50 ppb, si el cero entra en la regresión, y días de vigencia.

## 9. Casos de prueba obligatorios (Vitest)

Implementa **primero** estos tests. El motor debe pasarlos antes de construir la UI.

**T1 – Ejemplo del TAD, Apéndice A (promedios y desviaciones a partir de pendientes e interceptos dados)**

- Entradas: m = [1.0053, 1.0091, 1.0058] y b = [−0.1518, −0.2136, 0.0511].
- Resultados esperados:
  - m̄ = 1.006733
  - b̄ = −0.104767
  - SDm = 0.001686 (±0.00002; el TAD publica 0.00167 porque usa m̄ redondeada)
  - SDb = 0.113065 (±0.0001)
- Todos los criterios V5 y V6 deben dar CONFORME.

**T2 – Diferencias por punto (ejemplos del TAD)**

- x = 14.9, y = 14.8 → AbsDiff = −0.1 ppb → CONFORME.
- Un punto de x > 50 con %Diff = 0,45 % → CONFORME.

**T3 – Verificación sintética completa (3 ciclos, cero incluido en la regresión)**

- x = [0, 15, 52, 89, 126, 163, 200] en los tres ciclos.
- y ciclo 1 = [0.3, 15.2, 52.6, 89.9, 127.1, 164.4, 201.6]
- y ciclo 2 = [0.1, 15.0, 52.9, 90.2, 127.4, 164.3, 201.9]
- y ciclo 3 = [0.4, 15.4, 52.5, 89.7, 126.9, 164.6, 201.5]

Resultados esperados (tolerancia 1e-4):

| Resultado | Valor esperado |
|---|---|
| m₁ / b₁ | 1.00706 / 0.2210 |
| m₂ / b₂ | 1.00872 / 0.1678 |
| m₃ / b₃ | 1.00637 / 0.2704 |
| m̄ | 1.007383 |
| b̄ | 0.219735 |
| SDm | 0.000988 |
| SDb | 0.041873 |
| %Diff máximo | 1,731 % (ciclo 2, x = 52) |
| **Resultado global** | **CONFORME** |

**T4 – Ec. 10** con m̄ y b̄ de T3 e indicado = 100 ppb → patrón = 99.0490 ppb.

**T5 – Reverificación NO CONFORME solo por la regla R1**

- Referencia: m̄ y b̄ de T3.
- Ciclo: y = 1.024·x + 0.2 en los mismos x.
- Esperado:
  - R3, R4, V1 y V2 CONFORMES (el %Diff máximo es ≈ 2,78 % en x = 52).
  - **R1 NO CONFORME**, porque |1.024 − 1.007383| = 0.0166 > 0.015.
  - Resultado: NO CONFORME, con el mensaje "requiere verificación completa de 3 ciclos".

**T6 – App. D Ec. 4** con α = 308, l = 38.0 cm, I/I0 = 0.99, T = 298.15 K, P = 640 torr y L = 0.98 → 1.13639 ppm (±1e-4).

**T7 – Casos límite**

- x = 0 nunca produce una división por cero.
- Un ciclo con menos de 6 puntos más el cero → error V8.
- Dos ciclos en una verificación → error V7.
- Un candidato GENERATOR_ONLY → bloqueo.
- Un Nivel 3 contra un Nivel 2 de campo → bloqueo.
- Un punto por encima del rango del patrón → bloqueo.
- Una pérdida de O₃ del 6 % → D1 NO CONFORME.

## 10. Requisitos no funcionales

- Cálculo en doble precisión, sin redondeo intermedio. Redondear solo al mostrar: pendiente con 5 decimales, intercepto con 3, %Diff con 2 y ppb con 2. La UI usa coma decimal (es-CO).
- Trazabilidad ISO/IEC 17025: auditoría inmutable, versión del motor y de la tabla de límites guardadas en cada verificación, y reproducibilidad (recalcular una verificación antigua con sus límites originales da el mismo resultado).
- Toda regla muestra su referencia normativa (por ejemplo "TAD 2023 Tabla 4-1", "40 CFR 50 App. D §5.2.5").
- Accesible y usable en tableta dentro del laboratorio.
- Semillas (seed) con datos de ejemplo:
  - SRP de Calaire (Nivel 1).
  - 6103-S (Nivel 2, banco).
  - 6103-T (Nivel 3).
  - Sabio 2010D con fotómetro.
  - Sabio 2010D solo generador.

## 11. Forma de trabajo en Claude Code

1. Antes de escribir código, presenta un **plan por fases**: estructura de carpetas, esquema Prisma, API del motor y lista de pantallas. Espera mi aprobación.
2. Crea un `CLAUDE.md` con las convenciones, los comandos y las referencias normativas de este prompt.
3. **Fase 1:** motor de cálculo con los tests T1 a T7 en verde.
4. **Fase 2:** base de datos, API y reglas de trazabilidad.
5. **Fase 3:** UI del asistente de verificación y de las calculadoras.
6. **Fase 4:** informes PDF, etiqueta, exportaciones, tablero de vencimientos, autenticación y Docker Compose.
7. Al cerrar cada fase: ejecuta los tests, resume qué hiciste, qué supuestos tomaste y qué falta.
8. Si una interpretación normativa es ambigua (por ejemplo, si el cero entra en la regresión o el umbral de 50 ppb), **no la decidas en silencio**: déjala configurable, elige el valor por defecto indicado aquí y regístralo en `DECISIONS.md`.
9. No inventes límites ni ecuaciones que no estén en este prompt. Si necesitas uno nuevo, pregúntame.

**Empieza por el plan de la Fase 1.**
