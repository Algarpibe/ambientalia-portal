/**
 * COMPONENTE DE DETALLE DE CLIENTE
 * 
 * Muestra información completa del cliente incluyendo:
 * - Scores S, V, P, T (0-100)
 * - Segmento y políticas
 * - Candados activos
 * - Drivers del score
 * - Métricas detalladas
 */

import type { ScoringConfig, ExtendedScoringConfig, ClientProfile, ExtendedClientProfile, MetricDocumentation, ExtendedScoreResult, SalesHistoryMetrics } from '../types';
import { useState, useMemo } from 'react';

interface CustomerDetailProps {
  client?: ClientProfile | ExtendedClientProfile;
  config: ScoringConfig;
  extendedConfig: ExtendedScoringConfig;
  onBack?: () => void;
}

// Documentación de métricas para modales
const METRIC_DOCS: Record<string, MetricDocumentation> = {
  gmPct: {
    name: 'Margen Bruto %',
    formula: 'GM% = (VentasNetas - COGS) / VentasNetas × 100',
    interpretation: 'Porcentaje de ganancia sobre las ventas. Mayor es mejor.',
    scoreDirection: 'higher_is_better',
    score0Means: 'El cliente está en el percentil más bajo de margen',
    score100Means: 'El cliente está en el percentil más alto de margen',
    example: 'Si GM% = 35%, significa que por cada $100 vendidos, $35 son ganancia bruta.'
  },
  gmAbs: {
    name: 'Margen Bruto $',
    formula: 'GM$ = SUM(VentasNetas - COGS)',
    interpretation: 'Ganancia bruta absoluta en dólares. Mayor es mejor.',
    scoreDirection: 'higher_is_better',
    score0Means: 'El cliente genera el menor margen absoluto',
    score100Means: 'El cliente genera el mayor margen absoluto',
    example: 'Si GM$ = $50,000, el cliente generó $50,000 de margen bruto.'
  },

  lateValueRate: {
    name: 'Tasa de Mora por Valor',
    formula: 'LateValueRate = SUM(Facturas con DPD>0) / SUM(Facturas)',
    interpretation: 'Porcentaje del valor facturado que se pagó tarde. Menor es mejor.',
    scoreDirection: 'lower_is_better',
    score0Means: 'El cliente paga casi todo con retraso',
    score100Means: 'El cliente paga todo a tiempo',
    example: 'Si LateValueRate = 20%, el 20% del valor facturado se pagó tarde.'
  },
  severity: {
    name: 'Severidad de Mora',
    formula: 'Sev = SUM(DPD × ValorFactura) / SUM(ValorFactura) para facturas con DPD>0',
    interpretation: 'Promedio ponderado de días de mora. Menor es mejor.',
    scoreDirection: 'lower_is_better',
    score0Means: 'El cliente tiene moras muy largas',
    score100Means: 'El cliente tiene moras mínimas o nulas',
    example: 'Si Sev = 25, las facturas en mora se pagan en promedio 25 días tarde.'
  },
  avgDpd: {
    name: 'Promedio de Días de Mora',
    formula: 'AvgDPD = AVG(max(0, FechaPago - FechaVencimiento))',
    interpretation: 'Promedio de días de mora de todas las facturas. Menor es mejor.',
    scoreDirection: 'lower_is_better',
    score0Means: 'El cliente tiene un alto promedio de días de mora',
    score100Means: 'El cliente paga a tiempo consistentemente',
    example: 'Si AvgDPD = 10, en promedio las facturas se pagan 10 días después del vencimiento.'
  },
  volatility: {
    name: 'Volatilidad de Pagos',
    formula: 'σ = sqrt(SUM((DPD - μ)²) / (n-1))',
    interpretation: 'Desviación estándar de los días de mora. Menor es mejor (más predecible).',
    scoreDirection: 'lower_is_better',
    score0Means: 'El cliente es muy impredecible en sus pagos',
    score100Means: 'El cliente es muy consistente en sus pagos',
    example: 'Si σ = 5, los pagos varían aproximadamente ±5 días del promedio.'
  }
};


function ScoreGauge({ label, score, subtitle, onInfo }: { label: string; score: number; subtitle?: string; onInfo?: () => void }) {
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#eab308' : score >= 40 ? '#f97316' : '#ef4444';
  const percentage = Math.min(100, Math.max(0, score));

  return (
    <div className="score-gauge" onClick={onInfo} style={{ cursor: onInfo ? 'pointer' : 'default' }} title={onInfo ? 'Click para más información' : ''}>
      <div className="score-gauge__label">{label}</div>
      <div className="score-gauge__value" style={{ color }}>
        {score.toFixed(0)}
      </div>
      <div className="score-gauge__bar">
        <div
          className="score-gauge__fill"
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>
      {subtitle && <div className="score-gauge__subtitle">{subtitle}</div>}
    </div>
  );
}

function SegmentBadge({ segment, policy }: { segment: string; policy?: { creditPolicy: string; discountPolicy: string; servicePriority: string } }) {
  void policy;
  const colors: Record<string, { bg: string; text: string }> = {
    'Premium': { bg: '#22c55e', text: '#fff' },
    'Valioso Condicionado': { bg: '#eab308', text: '#000' },
    'Estándar': { bg: '#64748b', text: '#fff' },
    'Restringido': { bg: '#ef4444', text: '#fff' }
  };
  const color = colors[segment] || colors['Estándar'];

  return (
    <div className="segment-badge" style={{ backgroundColor: color.bg, color: color.text }}>
      <div className="segment-badge__name">{segment}</div>
    </div>
  );
}

function LockCard({ lock }: { lock: { type: string; severity: string; description: string; recommendation: string } }) {
  const icon = lock.severity === 'high' ? '🔒' : '⚠️';
  const bgColor = lock.severity === 'high' ? '#fef2f2' : '#fffbeb';
  const borderColor = lock.severity === 'high' ? '#fecaca' : '#fde68a';

  return (
    <div className="lock-card" style={{ backgroundColor: bgColor, borderColor }}>
      <div className="lock-card__header">
        <span className="lock-card__icon">{icon}</span>
        <span className="lock-card__severity">{lock.severity === 'high' ? 'BLOQUEO' : 'ALERTA'}</span>
      </div>
      <div className="lock-card__description">{lock.description}</div>
      <div className="lock-card__recommendation">💡 {lock.recommendation}</div>
    </div>
  );
}

function DriversList({ drivers, type }: { drivers: Array<{ metric: string; explanation: string; impact: string }>; type: 'positive' | 'negative' }) {
  const icon = type === 'positive' ? '↑' : '↓';
  const color = type === 'positive' ? '#22c55e' : '#ef4444';

  return (
    <div className="drivers-list">
      {drivers.map((d, idx) => (
        <div key={idx} className="driver-item" style={{ borderLeftColor: color }}>
          <span className="driver-icon" style={{ color }}>{icon}</span>
          <div>
            <div className="driver-metric">{d.metric}</div>
            <div className="driver-explanation">{d.explanation}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PolicyCard({ policy }: { policy: { creditPolicy: string; creditDescription: string; discountPolicy: string; discountDescription: string; servicePriority: string; priorityDescription: string } }) {
  const policyIcons: Record<string, string> = {
    full: '✅',
    limited: '⚠️',
    prepay: '💵',
    '50-50': '↔️',
    high: '⭐⭐⭐',
    medium: '⭐⭐',
    low: '⭐',
    none: '❌'
  };

  return (
    <div className="policy-grid">
      <div className="policy-item">
        <div className="policy-item__label">Crédito</div>
        <div className="policy-item__value">
          <span className="policy-icon">{policyIcons[policy.creditPolicy]}</span>
          {policy.creditDescription}
        </div>
      </div>
      <div className="policy-item">
        <div className="policy-item__label">Descuento</div>
        <div className="policy-item__value">
          <span className="policy-icon">{policyIcons[policy.discountPolicy]}</span>
          {policy.discountDescription}
        </div>
      </div>
      <div className="policy-item">
        <div className="policy-item__label">Prioridad Servicio</div>
        <div className="policy-item__value">
          <span className="policy-icon">{policyIcons[policy.servicePriority]}</span>
          {policy.priorityDescription}
        </div>
      </div>
    </div>
  );
}

function MetricModal({ metric, onClose }: { metric: MetricDocumentation; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h3>{metric.name}</h3>
        <div className="modal-section">
          <label>Fórmula:</label>
          <code>{metric.formula}</code>
        </div>
        <div className="modal-section">
          <label>Interpretación:</label>
          <p>{metric.interpretation}</p>
        </div>
        <div className="modal-section">
          <label>En el scoring:</label>
          <p><strong>Score 0:</strong> {metric.score0Means}</p>
          <p><strong>Score 100:</strong> {metric.score100Means}</p>
        </div>
        <div className="modal-section">
          <label>Ejemplo:</label>
          <p>{metric.example}</p>
        </div>
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  format,
  score,
  percentile,
  metricKey
}: {
  label: string;
  value: number | null;
  format: 'percent' | 'currency' | 'days' | 'number';
  score?: number;
  percentile?: number;
  metricKey?: string;
}) {
  const [showModal, setShowModal] = useState(false);

  let displayValue = '-';
  if (value !== null && Number.isFinite(value)) {
    switch (format) {
      case 'percent':
        displayValue = `${(value * 100).toFixed(1)}%`;
        break;
      case 'currency':
        displayValue = `$${Math.round(value).toLocaleString('es-CO')}`;
        break;
      case 'days':
        displayValue = `${value.toFixed(1)} días`;
        break;
      case 'number':
        displayValue = value.toFixed(1);
        break;
    }
  }

  const doc = metricKey ? METRIC_DOCS[metricKey] : null;

  return (
    <>
      <div className="metric-row">
        <div className="metric-row__label">
          {label}
          {doc && (
            <button className="metric-info-btn" onClick={() => setShowModal(true)}>ℹ️</button>
          )}
        </div>
        <div className="metric-row__value">{displayValue}</div>
        {score !== undefined && (
          <div className="metric-row__score">
            <span className={`score-badge score-badge--${score >= 60 ? 'good' : score >= 40 ? 'medium' : 'poor'}`}>
              {score}
            </span>
          </div>
        )}
        {percentile !== undefined && (
          <div className="metric-row__percentile">P{(percentile * 100).toFixed(0)}</div>
        )}
      </div>
      {showModal && doc && <MetricModal metric={doc} onClose={() => setShowModal(false)} />}
    </>
  );
}

// =========================================================================
// SALES HISTORY TAB (Score S)
// =========================================================================

interface SalesHistoryTabProps {
  salesHistory: SalesHistoryMetrics;
  salesComponents?: {
    revScore: number;
    revPercentile: number;
    growthScore: number;
    growthPercentile: number;
    stabilityScore: number;
    stabilityPercentile: number;
    loyaltyScore: number;
    loyaltyPercentile: number;
  } | null;
}

function SalesHistoryTab({ salesHistory, salesComponents }: SalesHistoryTabProps) {
  const { salesByYear, revLast3, revLast5, yoy2025: yoy, cagr3y: cagr, cv5y: cv, activeYears5y: activeYears, isDormant, isNew, isOneShot } = salesHistory;

  // Sort years for display
  const sortedYears = Object.keys(salesByYear)
    .map(Number)
    .sort((a, b) => a - b);

  // Calculate max revenue for bar chart scaling
  const maxRevenue = Math.max(...Object.values(salesByYear), 1);

  return (
    <>
      {/* Flags de estado */}
      {(isDormant || isNew || isOneShot) && (
        <div className="detail__section">
          <h4>Estado del Cliente</h4>
          <div className="flags-row">
            {isDormant && (
              <span className="flag-badge flag-badge--warning">🔴 Dormant</span>
            )}
            {isNew && (
              <span className="flag-badge flag-badge--info">🆕 Nuevo</span>
            )}
            {isOneShot && (
              <span className="flag-badge flag-badge--caution">⚡ One-Shot</span>
            )}
          </div>
        </div>
      )}

      {/* Métricas de Score S */}
      <div className="detail__section">
        <h4>Componentes del Score S (Tracción)</h4>
        <MetricRow
          label="Ingresos Últimos 3 Años"
          value={revLast3}
          format="currency"
          score={salesComponents?.revScore}
          percentile={salesComponents?.revPercentile}
        />
        <MetricRow
          label="Ingresos Últimos 5 Años"
          value={revLast5}
          format="currency"
        />
        {yoy !== null && (
          <MetricRow
            label="Crecimiento YoY"
            value={yoy}
            format="percent"
            score={salesComponents?.growthScore}
            percentile={salesComponents?.growthPercentile}
          />
        )}
        {cagr !== null && (
          <MetricRow
            label="CAGR"
            value={cagr}
            format="percent"
          />
        )}
        <MetricRow
          label="Volatilidad (CV)"
          value={cv}
          format="number"
          score={salesComponents?.stabilityScore}
          percentile={salesComponents?.stabilityPercentile}
        />
        <MetricRow
          label="Años Activos"
          value={activeYears}
          format="number"
          score={salesComponents?.loyaltyScore}
          percentile={salesComponents?.loyaltyPercentile}
        />
      </div>

      {/* Gráfico de barras de ventas por año */}
      <div className="detail__section">
        <h4>Ventas por Año</h4>
        <div className="sales-chart">
          {sortedYears.map(year => {
            const revenue = salesByYear[year] || 0;
            const barWidth = (revenue / maxRevenue) * 100;
            return (
              <div key={year} className="sales-chart__row">
                <div className="sales-chart__year">{year}</div>
                <div className="sales-chart__bar-container">
                  <div
                    className="sales-chart__bar"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                <div className="sales-chart__value">
                  ${revenue.toLocaleString('es-CO', { maximumFractionDigits: 0 })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function CustomerDetail({ client, config, extendedConfig, onBack }: CustomerDetailProps) {
  const [activeTab, setActiveTab] = useState<'resumen' | 'ventas' | 'valor' | 'pagos' | 'politicas'>('resumen');
  const [showScoreInfo, setShowScoreInfo] = useState<string | null>(null);

  // Generar info de scores dinámica basada en la configuración
  const scoreInfoMap = useMemo(() => {
    const v = config.valueWeights;
    const p = config.paymentWeights;
    const s = extendedConfig.salesWeights;
    const isExtended = config.scoringMode === 'extended';

    const t_v = isExtended ? extendedConfig.totalScoreWeightsExtended.value : config.totalScoreValueWeight;
    const t_p = isExtended ? extendedConfig.totalScoreWeightsExtended.payment : config.totalScorePaymentWeight;
    const t_s = isExtended ? extendedConfig.totalScoreWeightsExtended.sales : 0;

    return {
      'V': {
        name: 'Score de Valor (V)',
        meaning: 'Mide la rentabilidad y el potencial de generación de ganancias del cliente. Se basa en rentabilidad ponderada.',
        formula: `V = ${v.gmPct.toFixed(2)}*Score(GM%) + ${v.gmAbs.toFixed(2)}*Score(GM$) + ${v.mixMarginIndex.toFixed(2)}*Score(MixMarginIndex)`
      },
      'P': {
        name: 'Score de Pagos (P)',
        meaning: 'Evalúa la calidad de pago y la capacidad del cliente para honrar sus obligaciones.',
        formula: `P = ${p.lateValueRate.toFixed(2)}*Score(1 - Tasa Mora) + ${p.severity.toFixed(2)}*Score(1 - Severidad) + ${p.avgDpd.toFixed(2)}*Score(1 - AvgDPD) + ${p.volatility.toFixed(2)}*Score(1 - Volatilidad)`
      },
      'S': {
        name: 'Score de Tracción (S)',
        meaning: 'Mide el desempeño histórico y el momentum del cliente. Evalúa crecimiento, estabilidad y lealtad.',
        formula: `S = ${s.rev.toFixed(2)}*Score(Volumen) + ${s.growth.toFixed(2)}*Score(Crecimiento) + ${s.stability.toFixed(2)}*Score(Estabilidad) + ${s.loyalty.toFixed(2)}*Score(Lealtad)`
      },
      'T': {
        name: 'Score Total (T)',
        meaning: 'Puntuación integral que equilibra rentabilidad, pagos y tracción histórica.',
        formula: isExtended
          ? `T = ${t_v.toFixed(2)}*V + ${t_p.toFixed(2)}*P + ${t_s.toFixed(2)}*S`
          : `T = ${t_v.toFixed(2)}*V + ${t_p.toFixed(2)}*P (o ${config.totalScoreValueWeight.toFixed(2)}*V + ${config.totalScorePaymentWeight.toFixed(2)}*P si no hay Historial)`
      }
    };
  }, [config, extendedConfig]);

  if (!client || !client.scores) {
    return (
      <div className="card detail detail--empty">
        <div className="detail__placeholder">
          <span className="detail__placeholder-icon">👤</span>
          <p>Selecciona un cliente para ver el detalle de valoración</p>
        </div>
      </div>
    );
  }

  const { scores, profitability, payments, displayName, quickMetrics } = client;
  void quickMetrics;

  // Check if client has extended data
  const extClient = client as ExtendedClientProfile;
  const extScores = scores as ExtendedScoreResult;
  const hasSalesHistory = extClient.salesHistory !== null && extClient.salesHistory !== undefined;
  const salesHistory = extClient.salesHistory;
  const salesScore = extScores?.salesScore;

  return (
    <div className={`card customer-detail ${onBack ? 'customer-detail--full' : ''}`}>
      {onBack && (
        <div className="detail__nav">
          <button className="pill" onClick={onBack}>
            ← Volver al Dashboard
          </button>
        </div>
      )}
      {/* Header con nombre y scores principales */}
      <div className="customer-detail__header">
        <div className="detail__client-info">
          <h2>{displayName}</h2>
          <SegmentBadge segment={scores.segment} policy={scores.policy} />
        </div>

        <div className="score-gauges">
          {hasSalesHistory ? (
            <ScoreGauge
              label="S"
              score={salesScore ?? 0}
              subtitle="Tracción"
              onInfo={() => setShowScoreInfo('S')}
            />
          ) : (
            <div className="score-gauge score-gauge--empty" title="Sin historial de ventas de años anteriores">
              <div className="score-gauge__label">S</div>
              <div className="score-gauge__value">—</div>
              <div className="score-gauge__subtitle">Tracción</div>
            </div>
          )}
          <ScoreGauge
            label="V"
            score={scores.valueScore}
            subtitle="Valor"
            onInfo={() => setShowScoreInfo('V')}
          />
          <ScoreGauge
            label="P"
            score={scores.paymentScore}
            subtitle="Pagos"
            onInfo={() => setShowScoreInfo('P')}
          />
          <ScoreGauge
            label="T"
            score={scores.totalScore}
            subtitle="Total"
            onInfo={() => setShowScoreInfo('T')}
          />
        </div>
      </div>

      {/* Alertas de calidad de datos */}
      {scores.warnings.length > 0 && (
        <div className="detail__warnings">
          {scores.warnings.map((w, i) => (
            <div key={i} className="warning-badge">⚠️ {w}</div>
          ))}
        </div>
      )}

      {/* Candados activos */}
      {scores.gating.locks.length > 0 && (
        <div className="detail__locks">
          <h4>Candados Activos ({scores.gating.locks.length})</h4>
          <div className="locks-grid">
            {scores.gating.locks.map((lock, idx) => (
              <LockCard key={idx} lock={lock} />
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="detail-tabs">
        <button
          className={`detail-tab ${activeTab === 'resumen' ? 'detail-tab--active' : ''}`}
          onClick={() => setActiveTab('resumen')}
        >
          Resumen
        </button>
        {hasSalesHistory && (
          <button
            className={`detail-tab ${activeTab === 'ventas' ? 'detail-tab--active' : ''}`}
            onClick={() => setActiveTab('ventas')}
          >
            Ventas Hist.
          </button>
        )}
        <button
          className={`detail-tab ${activeTab === 'valor' ? 'detail-tab--active' : ''}`}
          onClick={() => setActiveTab('valor')}
        >
          Rentabilidad
        </button>
        <button
          className={`detail-tab ${activeTab === 'pagos' ? 'detail-tab--active' : ''}`}
          onClick={() => setActiveTab('pagos')}
        >
          Pagos
        </button>
        <button
          className={`detail-tab ${activeTab === 'politicas' ? 'detail-tab--active' : ''}`}
          onClick={() => setActiveTab('politicas')}
        >
          Políticas
        </button>
      </div>

      {/* Contenido de tabs */}
      <div className="detail__content">
        {activeTab === 'resumen' && (
          <>
            {/* Drivers */}
            <div className="detail__section">
              <h4>Factores que Suben el Score</h4>
              <DriversList drivers={scores.topPositiveDrivers} type="positive" />
            </div>

            <div className="detail__section">
              <h4>Factores que Bajan el Score</h4>
              <DriversList drivers={scores.topNegativeDrivers} type="negative" />
            </div>

            {/* Acciones recomendadas */}
            <div className="detail__section">
              <h4>Acciones Recomendadas</h4>
              <ul className="actions-list">
                {scores.actions.map((action, idx) => (
                  <li key={idx}>{action}</li>
                ))}
              </ul>
            </div>
            {/* Explicación del segmento */}
            <div className="detail__section">
              <h4>Explicación del Segmento</h4>
              <p className="segment-explanation">{scores.segmentExplanation}</p>
            </div>
          </>
        )}

        {activeTab === 'ventas' && hasSalesHistory && salesHistory && (
          <>
            <SalesHistoryTab salesHistory={salesHistory} salesComponents={extScores?.salesComponents} />
          </>
        )}

        {activeTab === 'valor' && profitability && (
          <>
            <div className="detail__section">
              <h4>Métricas de Rentabilidad (12m)</h4>
              <MetricRow
                label="Margen Bruto %"
                value={profitability.combined.gmPct / 100}
                format="percent"
                score={scores.valueComponents.gmPctScore}
                percentile={scores.valueComponents.gmPctPercentile}
                metricKey="gmPct"
              />
              <MetricRow
                label="Margen Bruto $"
                value={profitability.combined.gmAbs}
                format="currency"
                score={scores.valueComponents.gmAbsScore}
                percentile={scores.valueComponents.gmAbsPercentile}
                metricKey="gmAbs"
              />
              <MetricRow
                label="Mix de Alto Margen"
                value={profitability.combined.mixMarginIndex}
                format="percent"
                score={scores.valueComponents.mixMarginScore}
                percentile={scores.valueComponents.mixMarginPercentile}
              />
            </div>

            <div className="detail__section">
              <h4>Detalle por Período</h4>
              <div className="period-comparison">
                <div className="period-col">
                  <h5>Últimos 12 meses</h5>
                  <MetricRow label="Órdenes" value={profitability.period12m.orderCount} format="number" />
                  <MetricRow label="Ventas" value={profitability.period12m.salesTotal} format="currency" />
                  <MetricRow label="GM%" value={profitability.period12m.grossMarginPct / 100} format="percent" />
                </div>
                <div className="period-col">
                  <h5>Últimos 6 meses</h5>
                  <MetricRow label="Órdenes" value={profitability.period6m.orderCount} format="number" />
                  <MetricRow label="Ventas" value={profitability.period6m.salesTotal} format="currency" />
                  <MetricRow label="GM%" value={profitability.period6m.grossMarginPct / 100} format="percent" />
                </div>
              </div>
            </div>

            {profitability.period12m.topSkus.length > 0 && (
              <div className="detail__section">
                <h4>Top SKUs por Ventas</h4>
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Ventas</th>
                      <th>Margen %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitability.period12m.topSkus.slice(0, 5).map((sku, idx) => (
                      <tr key={idx}>
                        <td>{sku.sku}</td>
                        <td>${sku.sales.toLocaleString()}</td>
                        <td>{sku.marginPct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {activeTab === 'pagos' && payments && (
          <>
            <div className="detail__section">
              <h4>Métricas de Pagos (Combinadas)</h4>
              <MetricRow
                label="Tasa de Mora por Valor"
                value={payments.combined.lateValueRate}
                format="percent"
                score={scores.paymentComponents.lateValueRateScore}
                percentile={scores.paymentComponents.lateValueRatePercentile}
                metricKey="lateValueRate"
              />
              <MetricRow
                label="Severidad (días)"
                value={payments.combined.severity}
                format="days"
                score={scores.paymentComponents.severityScore}
                percentile={scores.paymentComponents.severityPercentile}
                metricKey="severity"
              />
              <MetricRow
                label="Promedio DPD"
                value={payments.combined.avgDpd}
                format="days"
                score={scores.paymentComponents.avgDpdScore}
                percentile={scores.paymentComponents.avgDpdPercentile}
                metricKey="avgDpd"
              />
              <MetricRow
                label="Volatilidad"
                value={payments.combined.volatility}
                format="days"
                score={scores.paymentComponents.volatilityScore}
                percentile={scores.paymentComponents.volatilityPercentile}
                metricKey="volatility"
              />
            </div>

            <div className="detail__section">
              <h4>Alertas de Pagos (6m)</h4>
              <div className="alerts-grid">
                <div className={`alert-box ${payments.raw6m.lateValueRate > 0.30 ? 'alert-box--danger' : 'alert-box--ok'}`}>
                  <div className="alert-box__label">Mora Valor 6m</div>
                  <div className="alert-box__value">{(payments.raw6m.lateValueRate * 100).toFixed(1)}%</div>
                  <div className="alert-box__threshold">Límite: 30%</div>
                </div>
                <div className={`alert-box ${payments.raw6m.severity > 45 ? 'alert-box--danger' : 'alert-box--ok'}`}>
                  <div className="alert-box__label">Severidad 6m</div>
                  <div className="alert-box__value">{payments.raw6m.severity.toFixed(0)} días</div>
                  <div className="alert-box__threshold">Límite: 45 días</div>
                </div>
                <div className={`alert-box ${payments.raw6m.maxDpd > 90 ? 'alert-box--danger' : 'alert-box--ok'}`}>
                  <div className="alert-box__label">Max DPD 6m</div>
                  <div className="alert-box__value">{payments.raw6m.maxDpd.toFixed(0)} días</div>
                  <div className="alert-box__threshold">Límite: 90 días</div>
                </div>
              </div>
            </div>

            <div className="detail__section">
              <h4>Detalle por Período</h4>
              <div className="period-comparison">
                <div className="period-col">
                  <h5>Últimos 12 meses</h5>
                  <MetricRow label="Facturas" value={payments.period12m.invoiceCount} format="number" />
                  <MetricRow label="Valor Total" value={payments.period12m.totalValue} format="currency" />
                  <MetricRow label="Tasa Mora" value={payments.period12m.lateRate} format="percent" />
                  <MetricRow label="Saldo Vencido" value={payments.period12m.overdueBalance} format="currency" />
                </div>
                <div className="period-col">
                  <h5>Últimos 6 meses</h5>
                  <MetricRow label="Facturas" value={payments.period6m.invoiceCount} format="number" />
                  <MetricRow label="Valor Total" value={payments.period6m.totalValue} format="currency" />
                  <MetricRow label="Tasa Mora" value={payments.period6m.lateRate} format="percent" />
                  <MetricRow label="Saldo Vencido" value={payments.period6m.overdueBalance} format="currency" />
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'politicas' && (
          <>
            <div className="detail__section">
              <h4>Políticas Recomendadas</h4>
              <PolicyCard policy={scores.policy} />
            </div>

            <div className="detail__section">
              <h4>Nivel Máximo de Beneficios</h4>
              <div className={`tier-badge tier-badge--${scores.gating.maxBenefitTier.toLowerCase()}`}>
                {scores.gating.maxBenefitTier}
              </div>
              {scores.gating.maxBenefitTier !== 'Max' && (
                <p className="tier-explanation">
                  Los beneficios están limitados debido a candados activos. Regularice la situación para acceder a mejores condiciones.
                </p>
              )}
            </div>

            <div className="detail__section">
              <h4>Resumen de Restricciones</h4>
              <div className="restrictions-list">
                <div className={`restriction-item ${scores.gating.creditBlocked ? 'restriction-item--blocked' : ''}`}>
                  <span className="restriction-icon">{scores.gating.creditBlocked ? '❌' : '✅'}</span>
                  <span>Ampliación de Crédito</span>
                </div>
                <div className={`restriction-item ${scores.gating.discountBlocked ? 'restriction-item--blocked' : ''}`}>
                  <span className="restriction-icon">{scores.gating.discountBlocked ? '❌' : '✅'}</span>
                  <span>Descuentos Adicionales</span>
                </div>
                <div className={`restriction-item ${scores.gating.priorityReduced ? 'restriction-item--blocked' : ''}`}>
                  <span className="restriction-icon">{scores.gating.priorityReduced ? '⚠️' : '✅'}</span>
                  <span>Prioridad de Servicio</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modal de información de scores */}
      {showScoreInfo && scoreInfoMap[showScoreInfo as keyof typeof scoreInfoMap] && (
        <div className="score-info-modal" onClick={() => setShowScoreInfo(null)}>
          <div className="score-info-modal__content" onClick={(e) => e.stopPropagation()}>
            <button
              className="score-info-modal__close"
              onClick={() => setShowScoreInfo(null)}
            >
              ✕
            </button>
            <div className="score-info-modal__header">
              <h3>{scoreInfoMap[showScoreInfo as keyof typeof scoreInfoMap].name}</h3>
              <div className="score-info-modal__label">Score {showScoreInfo}</div>
            </div>
            <div className="score-info-modal__section">
              <h4>¿Qué significa?</h4>
              <p>{scoreInfoMap[showScoreInfo as keyof typeof scoreInfoMap].meaning}</p>
            </div>
            <div className="score-info-modal__section">
              <h4>¿Cómo se calcula?</h4>
              <p className="score-info-modal__formula">{scoreInfoMap[showScoreInfo as keyof typeof scoreInfoMap].formula}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
