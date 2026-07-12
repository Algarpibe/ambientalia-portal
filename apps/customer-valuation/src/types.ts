export type ClientKey = string;

// =========================================================================
// CONFIGURACIÓN DE PESOS Y THRESHOLDS (PARAMETRIZABLES)
// =========================================================================

/** Configuración de pesos para Score de VALOR (V) */
export interface ValueScoreWeights {
  gmPct: number;        // Peso para GM% (default 0.40)
  gmAbs: number;        // Peso para GM$ (default 0.25)
  mixMarginIndex: number; // Peso para MixMarginIndex (default 0.15)
}

/** Configuración de pesos para Score de PAGOS (P) */
export interface PaymentScoreWeights {
  lateValueRate: number;  // Peso para (1 - LateValueRate) (default 0.35)
  severity: number;       // Peso para (1 - Severidad) (default 0.35)
  avgDpd: number;         // Peso para (1 - AvgDPD) (default 0.20)
  volatility: number;     // Peso para (1 - Volatilidad) (default 0.10)
}

/** Configuración de recencia para combinar métricas 12m y 6m */
export interface RecencyWeights {
  // Para rentabilidad: V_metric = weight12m * metric_12m + weight6m * metric_6m
  profitability12m: number;  // default 0.70
  profitability6m: number;   // default 0.30
  // Para pagos: P_metric = weight6m * metric_6m + weight12m * metric_12m
  payments12m: number;       // default 0.40
  payments6m: number;        // default 0.60
}

/** Thresholds para candados (gating) */
export interface GatingThresholds {
  lateValueRate6m: number;   // default 0.30 - bloquea crédito
  severity6m: number;        // default 45 - días, restringe a prepago
  maxDpd6m: number;          // default 90 - días, congela beneficios
}

/** Umbrales para segmentación de clientes */
export interface SegmentThresholds {
  premiumMinValue: number;      // Min V score for Premium (default 80)
  premiumMinPayment: number;    // Min P score for Premium (default 80)
  condicionadoMinValue: number; // Min V score for Condicionado (default 80)
  condicionadoMinPayment: number; // Min P score for Condicionado (default 50)
  estandarMinValue: number;     // Min V score for Estándar (default 50)
  estandarMinPayment: number;   // Min P score for Estándar (default 50)
}

/** Configuración completa del sistema de scoring */
export interface ScoringConfig {
  valueWeights: ValueScoreWeights;
  paymentWeights: PaymentScoreWeights;
  recencyWeights: RecencyWeights;
  gatingThresholds: GatingThresholds;
  segmentThresholds: SegmentThresholds;
  useGatingForSegmentation: boolean; // Si aplica candados en asignación de segmento
  includeCurrentYearInHistory: boolean; // Si incluye año actual (2026) en cálculos de ventas históricas (default false)
  scoringMode: 'standard' | 'extended'; // Modo de scoring: estándar (V+P) o extendido (V+P+S) (default 'standard')
  totalScoreValueWeight: number;   // Peso de V en T (default 0.55)
  totalScorePaymentWeight: number; // Peso de P en T (default 0.45)
  minInvoices12m: number;          // Mínimo facturas para score confiable (default 5)
  minOrders12m: number;            // Mínimo órdenes para score confiable (default 3)
  highMarginThresholdPct: number;  // Percentil para definir "alto margen" (default 75)
  winsorizeP1: number;             // Percentil inferior para winsorización (default 1)
  winsorizeP99: number;            // Percentil superior para winsorización (default 99)
}

/** Configuración por defecto */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  valueWeights: { gmPct: 0.45, gmAbs: 0.35, mixMarginIndex: 0.20 },
  paymentWeights: { lateValueRate: 0.35, severity: 0.35, avgDpd: 0.20, volatility: 0.10 },
  recencyWeights: { profitability12m: 0.70, profitability6m: 0.30, payments12m: 0.40, payments6m: 0.60 },
  gatingThresholds: { lateValueRate6m: 0.30, severity6m: 45, maxDpd6m: 90 },
  segmentThresholds: {
    premiumMinValue: 80,
    premiumMinPayment: 80,
    condicionadoMinValue: 80,
    condicionadoMinPayment: 50,
    estandarMinValue: 50,
    estandarMinPayment: 50
  },
  useGatingForSegmentation: true,
  includeCurrentYearInHistory: false,
  scoringMode: 'standard',
  totalScoreValueWeight: 0.55,
  totalScorePaymentWeight: 0.45,
  minInvoices12m: 5,
  minOrders12m: 3,
  highMarginThresholdPct: 75,
  winsorizeP1: 1,
  winsorizeP99: 99
};

// =========================================================================
// RECORDS DE ENTRADA (DATOS CRUDOS)
// =========================================================================

/** Registro de venta/orden con datos de rentabilidad */
export interface SalesRecord {
  cliente: string;
  clientKey: ClientKey;
  ordenId: string;
  fechaOrden: Date;
  año: number;
  linea: 'equipos' | 'consumibles' | 'servicio' | string;
  sku: string;
  familia?: string;
  descripcion?: string;
  cantidad: number;
  ventasNetas: number; // USD - antes era 'importe'
  cogs: number;        // USD - Cost of Goods Sold
}

/** Registro de la base maestra de productos */
export interface MasterCostRecord {
  sku: string;
  costoUnitario: number;
  fabricante?: string;
  categoria?: string;
  familia?: string;
  margenObjetivo?: number;
}

/** Registro de factura */
export interface InvoiceRecord {
  factura: string;
  cliente: string;
  clientKey: ClientKey;
  fechaFactura: Date;
  fechaVencimiento: Date;
  fechaPago?: Date;      // Fecha de pago (si está pagada)
  estado: string;
  total: number;         // Valor de la factura en USD
  saldo: number;         // Saldo pendiente
}

/** Registro de pago individual */
export interface PaymentRecord {
  pagoId: string;
  cliente: string;
  clientKey: ClientKey;
  factura: string;
  fechaPago: Date;
  monto: number;
}

// =========================================================================
// MÉTRICAS CALCULADAS POR PERÍODO (12m y 6m)
// =========================================================================

/** Métricas de rentabilidad para un período */
export interface ProfitabilityPeriodMetrics {
  period: '12m' | '6m';
  orderCount: number;           // Número de órdenes
  salesTotal: number;           // Ventas netas totales (USD)
  cogsTotal: number;            // COGS total (USD)
  grossProfit: number;          // GM$ = SUM(VentasNetas - COGS)
  grossMarginPct: number;       // GM% = grossProfit / salesTotal * 100

  // Calidad por orden
  negativeOrderCount: number;   // COUNT(gm_i < 0)
  negRate: number;              // NegRate = negativeOrderCount / orderCount
  negativeOrdersValue: number;  // Valor de órdenes con margen negativo

  // Mix de margen por producto/familia
  mixMarginIndex: number;       // % del valor en productos de alto margen
  highMarginSales: number;      // Ventas en productos de alto margen
  lowMarginSales: number;       // Ventas en productos de bajo margen

  // Detalles
  unknownCostCount: number;
  topSkus: Array<{ sku: string; sales: number; margin: number; marginPct: number }>;
  topFamilias: Array<{ familia: string; sales: number; marginPct: number }>;
  topLineas: Array<{ linea: string; sales: number; marginPct: number }>;
}

/** Métricas de pagos para un período */
export interface PaymentPeriodMetrics {
  period: '12m' | '6m';
  invoiceCount: number;         // Número de facturas
  totalValue: number;           // Valor total facturado

  // Tasas de mora
  lateCount: number;            // COUNT(DPD_i > 0)
  lateRate: number;             // LateRate = lateCount / invoiceCount
  lateValue: number;            // SUM(ValorFactura WHERE DPD > 0)
  lateValueRate: number;        // LateValueRate = lateValue / totalValue

  // Días de mora
  avgDpd: number;               // AvgDPD = AVG(DPD_i) - promedio global
  avgDpdMora: number;           // AvgDPD_mora = AVG(DPD_i WHERE DPD > 0)
  maxDpd: number;               // Máximo DPD en el período

  // Severidad financiera
  severity: number;             // Sev = SUM(DPD_i * ValorFactura WHERE DPD>0) / SUM(ValorFactura WHERE DPD>0)

  // Volatilidad
  volatility: number;           // sigma = desviación estándar muestral de DPD
  volatilityMora: number;       // sigma_mora con DPD > 0

  // DSO aproximado
  dso: number;                  // Days Sales Outstanding (o AvgDPD como proxy)

  // Facturas críticas
  invoicesOver90Days: number;   // COUNT(DPD > 90)
  overdueBalance: number;       // Saldo vencido actual
}

/** Métricas combinadas con recencia (pesadas 12m + 6m) */
export interface ProfitabilityMetrics {
  period12m: ProfitabilityPeriodMetrics;
  period6m: ProfitabilityPeriodMetrics;

  // Métricas combinadas (con recencia)
  combined: {
    gmPct: number;            // Weighted GM%
    gmAbs: number;            // Weighted GM$
    mixMarginIndex: number;   // Weighted MixMarginIndex
  };

  // Validación
  hasMinimumData: boolean;      // >= minOrders12m
  evidenceLevel: 'sufficient' | 'insufficient' | 'none';
}

export interface PaymentBehaviorMetrics {
  period12m: PaymentPeriodMetrics;
  period6m: PaymentPeriodMetrics;

  // Métricas combinadas (con recencia)
  combined: {
    lateValueRate: number;    // Weighted LateValueRate
    severity: number;         // Weighted Severity
    avgDpd: number;           // Weighted AvgDPD
    volatility: number;       // Weighted Volatility
    dso: number;              // Weighted DSO
  };

  // Para gating (valores crudos sin combinar)
  raw6m: {
    lateValueRate: number;
    severity: number;
    maxDpd: number;
  };

  // Validación
  hasMinimumData: boolean;
  evidenceLevel: 'sufficient' | 'insufficient' | 'none';
}

// =========================================================================
// JOIN FACTURA-PAGO (INTERNO)
// =========================================================================

export interface InvoicePaymentJoin {
  invoice: InvoiceRecord;
  payments: PaymentRecord[];
  paidAmount: number;
  remainingBalance: number;
  isFullyPaid: boolean;
  dpd: number;              // DPD = max(0, fechaPago - fechaVencimiento)
  dpdFromInvoice: number;   // Días desde factura (puede ser negativo)
  ageMonths: number;        // Antigüedad en meses
}

// =========================================================================
// COMPONENTES DE SCORE
// =========================================================================

/** Componentes individuales del Score de VALOR */
export interface ValueScoreComponents {
  gmPctScore: number;           // Score del margen % (0-100)
  gmPctPercentile: number;      // Percentil del cliente
  gmAbsScore: number;           // Score del margen absoluto (0-100)
  gmAbsPercentile: number;
  mixMarginScore: number;       // Score del mix de margen (0-100)
  mixMarginPercentile: number;
}

/** Componentes individuales del Score de PAGOS */
export interface PaymentScoreComponents {
  lateValueRateScore: number;   // Score de tasa de mora (100 - rate) (0-100)
  lateValueRatePercentile: number;
  severityScore: number;        // Score de severidad (100 - sev normalizada) (0-100)
  severityPercentile: number;
  avgDpdScore: number;          // Score de promedio DPD (0-100)
  avgDpdPercentile: number;
  volatilityScore: number;      // Score de volatilidad (0-100)
  volatilityPercentile: number;
}

// =========================================================================
// CANDADOS (GATING) Y SEGMENTACIÓN
// =========================================================================

/** Tipos de candados */
export type GateLock =
  | 'LOCK_HIGH_LATE_VALUE_RATE'     // Gate 1: LateValueRate_6m > 30%
  | 'LOCK_HIGH_SEVERITY'            // Gate 2: Sev_6m > 45 días
  | 'LOCK_CRITICAL_DPD'             // Gate 3: DPD > 90 días en 6m
  | 'LOCK_NEGATIVE_MARGIN'          // Gate 4: NegValueRate_12m > 20%
  | 'LOCK_DORMANT'                  // Gate 5: isDormant (cliente inactivo)
  | 'LOCK_ONE_SHOT'                 // Gate 5b: Cliente de transacción única
  | 'LOCK_NEW_CUSTOMER'             // Gate 5c: Cliente nuevo
  | 'LOCK_INSUFFICIENT_DATA';       // Datos insuficientes

/** Información de un candado activo */
export interface ActiveLock {
  type: GateLock;
  severity: 'high' | 'medium' | 'low';  // Alto = bloqueo fuerte, Medio = restricción, Bajo = advertencia
  description: string;
  value: number;                // Valor que disparó el candado
  threshold: number;            // Threshold configurado
  recommendation: string;
}

/** Resultado del gating */
export interface GatingResult {
  locks: ActiveLock[];
  hasHighSeverityLock: boolean;
  hasMediumSeverityLock: boolean;
  maxBenefitTier: 'Max' | 'Condicionado' | 'Restringido';
  creditBlocked: boolean;
  discountBlocked: boolean;
  priorityReduced: boolean;
}

/** Segmentos de cliente */
export type ClientSegment =
  | 'Premium'               // V>=80 AND P>=80 AND sin candados fuertes
  | 'Valioso Condicionado'  // V>=80 AND P 50-79 OR candados leves
  | 'Estándar'              // V 50-79 AND P>=80
  | 'Restringido';          // P<50 OR candado fuerte

/** Políticas por segmento */
export interface SegmentPolicy {
  segment: ClientSegment;
  creditPolicy: 'full' | 'limited' | 'prepay' | '50-50';
  creditDescription: string;
  discountPolicy: 'high' | 'medium' | 'low' | 'none';
  discountDescription: string;
  servicePriority: 'high' | 'medium' | 'low';
  priorityDescription: string;
}

// =========================================================================
// RESULTADO FINAL DEL SCORING
// =========================================================================

/** Drivers que explican el score */
export interface ScoreDriver {
  metric: string;           // Nombre de la métrica
  value: number;            // Valor actual
  impact: 'positive' | 'negative' | 'neutral';
  contribution: number;     // Contribución al score (puntos)
  explanation: string;      // Explicación en texto
}

/** Resultado completo del scoring para un cliente */
export interface ScoreResult {
  // Scores principales (0-100)
  valueScore: number;         // V - Score de Valor
  paymentScore: number;       // P - Score de Pagos  
  totalScore: number;         // T - Score Total

  // Componentes detallados
  valueComponents: ValueScoreComponents;
  paymentComponents: PaymentScoreComponents;

  // Segmentación
  segment: ClientSegment;
  segmentExplanation: string;

  // Políticas
  policy: SegmentPolicy;

  // Gating (candados)
  gating: GatingResult;

  // Drivers (top 3 positivos y negativos)
  topPositiveDrivers: ScoreDriver[];
  topNegativeDrivers: ScoreDriver[];

  // Acciones recomendadas
  actions: string[];

  // Validación
  dataQuality: 'high' | 'medium' | 'low' | 'insufficient';
  warnings: string[];

  // Legacy (compatibilidad)
  value: number;              // Alias de valueScore
  risk: number;               // Alias inverso de paymentScore (100 - P)
  total: number;              // Alias de totalScore
  quadrant: 'Max Beneficios' | 'Condicionado' | 'Estandar' | 'Restringido';
  maxBenefitTier: 'Max' | 'Condicionado' | 'Restringido';
  flags: string[];
  drivers: string[];
  riskBand: 'Alto Riesgo' | 'Bajo Riesgo';
  components: ScoreComponents;
}

/** Componentes legacy para compatibilidad */
export interface ScoreComponents {
  revenueScore: number;
  marginScore: number;
  recencyWeightedDpdScore: number;
  recencyOverdueRateScore: number;
  dpdP95Score: number;
  overdueBalanceScore: number;
}

// =========================================================================
// PERFIL COMPLETO DEL CLIENTE
// =========================================================================

export interface ClientProfile {
  clientKey: ClientKey;
  displayName: string;
  profitability: ProfitabilityMetrics | null;
  payments: PaymentBehaviorMetrics | null;
  scores: ScoreResult | null;

  // Métricas rápidas para tabla
  quickMetrics: {
    salesTotal: number;
    gmPct: number;
    gmAbs: number;
    lateValueRate: number;
    severity: number;
    avgDpd: number;
  } | null;
}

// =========================================================================
// COLUMN MAPPING (PARSERS)
// =========================================================================

export interface ColumnMapping {
  required: Record<string, string[]>;
  optional?: Record<string, string[]>;
}

// =========================================================================
// DOCUMENTACIÓN DE MÉTRICAS (PARA UI)
// =========================================================================

export interface MetricDocumentation {
  name: string;
  formula: string;
  interpretation: string;
  scoreDirection: 'higher_is_better' | 'lower_is_better';
  score0Means: string;
  score100Means: string;
  example: string;
}

// =========================================================================
// VENTAS HISTÓRICAS (BLOQUE S) - NUEVA FUENTE
// =========================================================================

/** Registro de ventas por año (formato canónico después de unpivot) */
export interface CustomerSalesYearRecord {
  customerNameRaw: string;
  customerNameNorm: string;
  customerId?: string;          // Cuando se resuelva el matching
  year: number;
  salesUsd: number;
}

/** Métricas de ventas históricas calculadas */
export interface SalesHistoryMetrics {
  // Datos base
  customerKey: string;
  salesByYear: Record<number, number>;  // {2021: 100000, 2022: 150000, ...}

  // Métricas de volumen
  revLast3: number;             // sales_2023 + sales_2024 + sales_2025
  revLast5: number;             // sum(sales_2021..2025)
  revLast12m: number;           // Ventas últimos 12 meses (si hay datos mensuales)

  // Métricas de crecimiento
  yoy2025: number | null;       // (sales_2025 - sales_2024) / sales_2024
  cagr3y: number | null;        // (sales_2025 / sales_2023)^(1/2) - 1
  cagr5y: number | null;        // (sales_2025 / sales_2021)^(1/4) - 1

  // Métricas de estabilidad
  cv5y: number | null;          // coeficiente de variación últimos 5 años
  activeYears5y: number;        // count(año con ventas > 0) en 2021-2025
  lastActiveYear: number;       // último año con ventas > 0

  // Flags de comportamiento
  isDormant: boolean;           // lastActiveYear <= 2023
  isNew: boolean;               // primera venta >= 2024
  isOneShot: boolean;           // activeYears5y == 1 AND rev alto
  isGrowing: boolean;           // yoy2025 > 0.10 (creciendo >10%)
  isDeclining: boolean;         // yoy2025 < -0.10 (cayendo >10%)

  // Validación
  hasData: boolean;
  evidenceLevel: 'sufficient' | 'insufficient' | 'none';
}

/** Componentes del Score S */
export interface SalesScoreComponents {
  revScore: number;             // Score de volumen (rev_last3)
  revPercentile: number;
  growthScore: number;          // Score de crecimiento (yoy o cagr)
  growthPercentile: number;
  stabilityScore: number;       // Score de estabilidad (1 - cv)
  stabilityPercentile: number;
  loyaltyScore: number;         // Score de lealtad (active_years)
  loyaltyPercentile: number;
}

/** Pesos para Score S */
export interface SalesScoreWeights {
  rev: number;                  // Peso para volumen (default 0.45)
  growth: number;               // Peso para crecimiento (default 0.25)
  stability: number;            // Peso para estabilidad (default 0.20)
  loyalty: number;              // Peso para lealtad (default 0.10)
}

// =========================================================================
// MATCHING DE CLIENTES
// =========================================================================

/** Tipo de match encontrado */
export type MatchType = 'exact' | 'fuzzy' | 'manual' | 'unmatched';

/** Registro de mapeo de cliente */
export interface CustomerMapRecord {
  customerNameRaw: string;
  customerNameNorm: string;
  customerId: string | null;
  matchType: MatchType;
  matchScore: number;           // 0..1
  matchedTo?: string;           // Nombre del cliente con el que se hizo match
  updatedAt: Date;
  verified: boolean;            // Si fue verificado manualmente
}

/** Resultado del proceso de matching */
export interface MatchingResult {
  totalRecords: number;
  exactMatches: number;
  fuzzyMatches: number;
  manualMatches: number;
  unmatched: number;
  matchRate: number;            // % mapeados
  unmatchedNames: string[];
}

// =========================================================================
// COST-TO-SERVE (BLOQUE C) - PREPARADO PARA FUTURO
// =========================================================================

/** Registro de evento de servicio */
export interface ServiceEventRecord {
  customerId: string;
  ticketId: string;
  eventDate: Date;
  serviceType: 'mantenimiento' | 'diagnostico' | 'instalacion' | 'calibracion' | 'asesoria' | string;
  hoursSpent: number;
  travelHours?: number;
  partsCostUsd?: number;
  causeCategory?: 'error_operacion' | 'falla_equipo' | 'administrativo' | string;
  resolvedFlag: boolean;
}

/** Métricas de Cost-to-Serve (futuro) */
export interface CostToServeMetrics {
  hoursPer10k: number | null;   // (hours_spent_12m / net_sales_12m) * 10000
  ticketsPer1M: number | null;  // (tickets_12m / net_sales_12m) * 1,000,000
  opErrorRate: number | null;   // % eventos con error_operacion
  travelBurden: number | null;  // travel_hours / hours_spent
  hasData: boolean;
}

// =========================================================================
// CONFIGURACIÓN EXTENDIDA CON SCORE S
// =========================================================================

/** Configuración completa extendida */
export interface ExtendedScoringConfig extends ScoringConfig {
  salesWeights: SalesScoreWeights;
  totalScoreSalesWeight: number;   // Peso de S en T (default 0.20)
  // Nuevos pesos para T = V*w1 + P*w2 + S*w3
  totalScoreWeightsExtended: {
    value: number;    // default 0.40
    payment: number;  // default 0.40
    sales: number;    // default 0.20
  };
  // Gates adicionales
  extendedGates: {
    dormantBlockCredit: boolean;   // Si dormant bloquea crédito ampliado
  };
}

/** Configuración extendida por defecto */
export const DEFAULT_EXTENDED_CONFIG: ExtendedScoringConfig = {
  ...DEFAULT_SCORING_CONFIG,
  salesWeights: { rev: 0.45, growth: 0.25, stability: 0.20, loyalty: 0.10 },
  valueWeights: { gmPct: 0.45, gmAbs: 0.35, mixMarginIndex: 0.20 },
  totalScoreSalesWeight: 0.20,
  totalScoreWeightsExtended: { value: 0.40, payment: 0.40, sales: 0.20 },
  extendedGates: { dormantBlockCredit: true }
};

// =========================================================================
// RESULTADO EXTENDIDO DEL SCORING (CON SCORE S)
// =========================================================================

/** Resultado completo con Score S */
export interface ExtendedScoreResult extends ScoreResult {
  salesScore: number | null;      // S - Score de Ventas Históricas (null si no hay datos)
  salesComponents: SalesScoreComponents | null;
  salesMetrics: SalesHistoryMetrics | null;
}

/** Perfil extendido del cliente */
export interface ExtendedClientProfile extends ClientProfile {
  salesHistory: SalesHistoryMetrics | null;
  costToServe: CostToServeMetrics | null;
  customerMap: CustomerMapRecord | null;
  scores: ExtendedScoreResult | null;
}
