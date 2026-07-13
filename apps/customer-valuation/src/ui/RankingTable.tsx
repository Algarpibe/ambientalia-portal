import { useState, useMemo } from 'react';
import type { ClientProfile, ExtendedClientProfile } from '../types';
import { rankClients } from '../metrics/clientListHelpers';

export function RankingTable({
  clients,
  onSelect,
  selectedClientKey,
  hasSalesHistory
}: {
  clients: (ClientProfile | ExtendedClientProfile)[];
  onSelect: (client: ClientProfile | ExtendedClientProfile) => void;
  selectedClientKey?: string;
  hasSalesHistory?: boolean;
}) {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'T',
    direction: 'desc'
  });

  const validClients = useMemo(() => rankClients(clients, sortConfig), [clients, sortConfig]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: string) => {
    if (sortConfig.key !== key) return null;
    return sortConfig.direction === 'desc' ? ' ↓' : ' ↑';
  };

  // Check if any client has salesScore (extended data)
  const showSalesScore = hasSalesHistory || validClients.some(c =>
    'salesScore' in (c.scores ?? {}) && (c.scores as any)?.salesScore !== null
  );

  return (
    <div className="card ranking-table">
      <div className="card__header">
        <h3>Ranking de Clientes</h3>
        <span className="badge">{validClients.length} clientes</span>
      </div>
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th className="col-rank">#</th>
              <th className="col-name sortable" onClick={() => requestSort('CLIENTE')}>
                CLIENTE{getSortIcon('CLIENTE')}
              </th>
              {showSalesScore && (
                <th className="col-score sortable" onClick={() => requestSort('S')}>
                  S{getSortIcon('S')}
                </th>
              )}
              <th className="col-score sortable" onClick={() => requestSort('V')}>
                V{getSortIcon('V')}
              </th>
              <th className="col-score sortable" onClick={() => requestSort('P')}>
                P{getSortIcon('P')}
              </th>
              <th className="col-score sortable" onClick={() => requestSort('T')}>
                T{getSortIcon('T')}
              </th>
              <th className="col-segment sortable" onClick={() => requestSort('SEGMENTO')}>
                SEGMENTO{getSortIcon('SEGMENTO')}
              </th>
              <th className="col-metric text-right sortable" onClick={() => requestSort('VENTAS')}>
                VENTAS{getSortIcon('VENTAS')}
              </th>
              <th className="col-metric text-right sortable" onClick={() => requestSort('MARGEN%')}>
                MARGEN%{getSortIcon('MARGEN%')}
              </th>
              <th className="col-metric text-right sortable" onClick={() => requestSort('DPD P95')}>
                DPD P95{getSortIcon('DPD P95')}
              </th>
              <th className="col-metric text-right sortable" onClick={() => requestSort('% MORA')}>
                % MORA{getSortIcon('% MORA')}
              </th>
            </tr>
          </thead>
          <tbody>
            {validClients.map((c, idx) => {
              const extScores = c.scores as any;
              const salesScore = extScores?.salesScore;

              return (
                <tr
                  key={c.clientKey}
                  className={selectedClientKey === c.clientKey ? 'selected' : ''}
                  onClick={() => onSelect(c)}
                >
                  <td className="text-center text-muted">{idx + 1}</td>
                  <td className="text-accent">{c.displayName}</td>
                  {showSalesScore && (
                    <td className="text-center">
                      {salesScore !== null && salesScore !== undefined ? (
                        <span className={`score-badge score-badge--${salesScore >= 80 ? 'high' : salesScore >= 50 ? 'medium' : 'low'}`}>
                          {salesScore.toFixed(0)}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  )}
                  <td className="text-center">
                    <span className={`score-badge score-badge--${c.scores!.valueScore >= 80 ? 'high' : c.scores!.valueScore >= 50 ? 'medium' : 'low'}`}>
                      {c.scores!.valueScore.toFixed(0)}
                    </span>
                  </td>
                  <td className="text-center">
                    <span className={`score-badge score-badge--${c.scores!.paymentScore >= 80 ? 'high' : c.scores!.paymentScore >= 50 ? 'medium' : 'low'}`}>
                      {c.scores!.paymentScore.toFixed(0)}
                    </span>
                  </td>
                  <td className="text-center">
                    <span className={`score-badge score-badge--${c.scores!.totalScore >= 80 ? 'high' : c.scores!.totalScore >= 50 ? 'medium' : 'low'}`}>
                      {c.scores!.totalScore.toFixed(0)}
                    </span>
                  </td>
                  <td className="text-center">
                    <span className={`segment-badge segment-badge--${c.scores!.segment.toLowerCase().replace(/\s+/g, '-')}`}>
                      {c.scores!.segment}
                    </span>
                  </td>
                  <td className="text-right">
                    ${(c.quickMetrics?.salesTotal ?? 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </td>
                  <td className="text-right">
                    {(c.quickMetrics?.gmPct ?? 0).toFixed(1)}%
                  </td>
                  <td className="text-right">
                    {(c.payments?.raw6m.maxDpd ?? 0).toFixed(0)}
                  </td>
                  <td className="text-right">
                    {((c.quickMetrics?.lateValueRate ?? 0) * 100).toFixed(0)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
