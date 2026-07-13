import { useMemo } from 'react';
import type { ClientProfile } from '../types';
import { getPopulationStats } from '../metrics/clientAggregator';

export function StatsCard({ clients, salesHistoryCount }: { clients: ClientProfile[]; salesHistoryCount?: number }) {
  const stats = useMemo(() => getPopulationStats(clients), [clients]);

  if (clients.length === 0 && !salesHistoryCount) return null;

  return (
    <div className="stats-card">
      <div className="stats-row">
        {salesHistoryCount !== undefined && salesHistoryCount > 0 && (
          <div className="stat-item">
            <div className="stat-value">{salesHistoryCount}</div>
            <div className="stat-label">Hist. Ventas</div>
          </div>
        )}
        <div className="stat-item">
          <div className="stat-value">{stats.totalClients}</div>
          <div className="stat-label">Clientes</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{stats.avgValueScore.toFixed(0)}</div>
          <div className="stat-label">Prom. V</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{stats.avgPaymentScore.toFixed(0)}</div>
          <div className="stat-label">Prom. P</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{stats.avgTotalScore.toFixed(0)}</div>
          <div className="stat-label">Prom. T</div>
        </div>
        <div className="stat-item stat-item--highlight">
          <div className="stat-value">{stats.bySegment['Premium'] || 0}</div>
          <div className="stat-label">Premium</div>
        </div>
        <div className="stat-item stat-item--warning">
          <div className="stat-value">{stats.clientsWithLocks}</div>
          <div className="stat-label">Con Candados</div>
        </div>
      </div>
    </div>
  );
}
