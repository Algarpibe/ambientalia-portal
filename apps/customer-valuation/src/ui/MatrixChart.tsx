/**
 * COMPONENTE MATRIZ VALOR VS PAGOS
 * 
 * Visualiza clientes en un scatter plot con:
 * - Eje X: Score de Valor (V) 0-100
 * - Eje Y: Score de Pagos (P) 0-100
 * - Cuadrantes: Premium, Valioso Condicionado, Estándar, Restringido
 */

import type { ClientProfile, ClientSegment } from '../types';

type Quadrant = 'Max Beneficios' | 'Condicionado' | 'Estandar' | 'Restringido';

interface MatrixChartProps {
  clients: ClientProfile[];
  onSelectQuadrant?: (quadrant: Quadrant) => void;
  onSelectClient?: (client: ClientProfile) => void;
}

// Mapeo de segmentos a colores
const SEGMENT_COLORS: Record<ClientSegment, string> = {
  'Premium': '#22c55e',
  'Valioso Condicionado': '#eab308',
  'Estándar': '#64748b',
  'Restringido': '#ef4444'
};

// Mapeo de segmento a quadrant legacy
const SEGMENT_TO_QUADRANT: Record<ClientSegment, Quadrant> = {
  'Premium': 'Max Beneficios',
  'Valioso Condicionado': 'Condicionado',
  'Estándar': 'Estandar',
  'Restringido': 'Restringido'
};

export function MatrixChart({ clients, onSelectQuadrant, onSelectClient }: MatrixChartProps) {
  // Contar clientes por segmento
  const segments: Record<ClientSegment, number> = {
    'Premium': 0,
    'Valioso Condicionado': 0,
    'Estándar': 0,
    'Restringido': 0
  };

  clients.forEach((c) => {
    if (c.scores) {
      segments[c.scores.segment] = (segments[c.scores.segment] || 0) + 1;
    }
  });

  // También contar por quadrant legacy para compatibilidad
  const quadrants: Record<Quadrant, number> = {
    'Max Beneficios': segments['Premium'],
    'Condicionado': segments['Valioso Condicionado'],
    'Estandar': segments['Estándar'],
    'Restringido': segments['Restringido']
  };
  void quadrants;

  const segmentButtons = (
    <div className="matrix__legend">
      {(Object.entries(segments) as [ClientSegment, number][]).map(([seg, count]) => (
        <button
          key={seg}
          className="pill"
          style={{
            backgroundColor: SEGMENT_COLORS[seg] + '20',
            borderColor: SEGMENT_COLORS[seg],
            color: SEGMENT_COLORS[seg]
          }}
          onClick={() => onSelectQuadrant?.(SEGMENT_TO_QUADRANT[seg])}
        >
          {seg}: {count}
        </button>
      ))}
    </div>
  );
  void segmentButtons;

  // Calcular estadísticas de la población
  const validClients = clients.filter(c => c.scores);
  const avgValue = validClients.length > 0
    ? validClients.reduce((sum, c) => sum + (c.scores?.valueScore || 0), 0) / validClients.length
    : 0;
  const avgPayment = validClients.length > 0
    ? validClients.reduce((sum, c) => sum + (c.scores?.paymentScore || 0), 0) / validClients.length
    : 0;

  return (
    <div className="card matrix">
      <div className="card__header">
        <div>
          <h3>Matriz Valor (V) vs Pagos (P)</h3>
          <p className="matrix__subtitle">
            {validClients.length} clientes | Prom. V: {avgValue.toFixed(0)} | Prom. P: {avgPayment.toFixed(0)}
          </p>
        </div>
      </div>

      <div className="matrix__plot">
        {/* Etiquetas de ejes */}
        <div className="matrix__axis matrix__axis--x">
          <span className="matrix__axis-label">Valor (V) →</span>
          <span className="matrix__axis-desc">Rentabilidad del cliente</span>
        </div>
        <div className="matrix__axis matrix__axis--y">
          <span className="matrix__axis-label">Pagos (P) →</span>
          <span className="matrix__axis-desc">Comportamiento de pago</span>
        </div>

        {/* Cuadrantes con etiquetas */}
        <div className="matrix__quadrant-labels">
          <div className="matrix__quadrant-label matrix__quadrant-label--tl" style={{ color: SEGMENT_COLORS['Valioso Condicionado'] }}>
            Valioso Condicionado
          </div>
          <div className="matrix__quadrant-label matrix__quadrant-label--tr" style={{ color: SEGMENT_COLORS['Premium'] }}>
            Premium
          </div>
          <div className="matrix__quadrant-label matrix__quadrant-label--bl" style={{ color: SEGMENT_COLORS['Restringido'] }}>
            Restringido
          </div>
          <div className="matrix__quadrant-label matrix__quadrant-label--br" style={{ color: SEGMENT_COLORS['Estándar'] }}>
            Estándar
          </div>
        </div>

        <div className="matrix__grid">
          {/* Puntos de clientes */}
          {clients.map((c) => c.scores && (
            <div
              key={c.clientKey}
              className={`matrix__dot matrix__dot--${c.scores.segment.replace(/\s+/g, '').toLowerCase()}`}
              style={{
                left: `${c.scores.valueScore}%`,
                bottom: `${c.scores.paymentScore}%`,
                backgroundColor: SEGMENT_COLORS[c.scores.segment],
                // Tamaño basado en ventas (opcional)
                transform: `translate(-50%, 50%) scale(${c.quickMetrics ? Math.max(0.8, Math.min(2, c.quickMetrics.salesTotal / 100000)) : 1})`
              }}
              title={`${c.displayName}\nV: ${c.scores.valueScore.toFixed(0)} | P: ${c.scores.paymentScore.toFixed(0)} | T: ${c.scores.totalScore.toFixed(0)}\nSegmento: ${c.scores.segment}${c.scores.gating.locks.length > 0 ? '\n⚠️ ' + c.scores.gating.locks.length + ' candado(s)' : ''}`}
              onClick={() => {
                onSelectClient?.(c);
                onSelectQuadrant?.(c.scores!.quadrant);
              }}
            />
          ))}

          {/* Líneas de umbral a 50 y 80 */}
          <div className="matrix__threshold matrix__threshold--x matrix__threshold--80" style={{ left: '80%' }}>
            <span className="matrix__threshold-label">80</span>
          </div>
          <div className="matrix__threshold matrix__threshold--x matrix__threshold--50" style={{ left: '50%' }}>
            <span className="matrix__threshold-label">50</span>
          </div>
          <div className="matrix__threshold matrix__threshold--y matrix__threshold--80" style={{ bottom: '80%' }}>
            <span className="matrix__threshold-label">80</span>
          </div>
          <div className="matrix__threshold matrix__threshold--y matrix__threshold--50" style={{ bottom: '50%' }}>
            <span className="matrix__threshold-label">50</span>
          </div>
        </div>

        {/* Escala de los ejes */}
        <div className="matrix__scale matrix__scale--x">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100</span>
        </div>
        <div className="matrix__scale matrix__scale--y">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100</span>
        </div>
      </div>


    </div>
  );
}
