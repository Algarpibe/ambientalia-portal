import { useState, useMemo } from 'react';
import type { ClientProfile, ExtendedClientProfile } from '../types';
import { rankClients } from '../metrics/clientListHelpers';
import { activable, ariaSort } from '@suite/a11y';

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

  // FE-419 — cabecera ordenable: el botón la hace alcanzable con Tab y la anuncia como
  // accionable. No lleva onClick propio: su clic (también el que generan Enter y Espacio)
  // sube al <th>, que sigue ordenando igual, incluido el clic en el relleno de la celda. La
  // flecha va aria-hidden porque el sentido ya lo declara aria-sort en el <th>. La clase
  // `sort-btn` (styles.css) le quita el aspecto de botón para que todo herede del <th>.
  const ordenable = (key: string, className: string) => (
    <th className={`${className} sortable`} onClick={() => requestSort(key)} aria-sort={ariaSort(sortConfig.key === key, sortConfig.direction === 'asc')}>
      <button type="button" className="sort-btn">
        {key}<span aria-hidden="true">{getSortIcon(key)}</span>
      </button>
    </th>
  );

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
              {ordenable('CLIENTE', 'col-name')}
              {showSalesScore && ordenable('S', 'col-score')}
              {ordenable('V', 'col-score')}
              {ordenable('P', 'col-score')}
              {ordenable('T', 'col-score')}
              {ordenable('SEGMENTO', 'col-segment')}
              {ordenable('VENTAS', 'col-metric text-right')}
              {ordenable('MARGEN%', 'col-metric text-right')}
              {ordenable('DPD P95', 'col-metric text-right')}
              {ordenable('% MORA', 'col-metric text-right')}
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
                  // FE-419 — la fila abre el detalle también con Enter o Espacio y se anuncia
                  // por lo que abre; el clic sigue igual.
                  {...activable(() => onSelect(c))}
                  aria-label={`Abrir el detalle de ${c.displayName}`}
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
