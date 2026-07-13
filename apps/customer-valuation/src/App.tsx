
import { useEffect, useMemo, useRef, useState } from 'react';
import './styles.css';
import { aggregateClients, aggregateClientsExtended, getPopulationStats } from './metrics/clientAggregator';
import { filterClients, uniqueClientNames } from './metrics/clientListHelpers';
import { loadFromHub } from './hub/loadFromHub';
import { ClientProfile, CustomerSalesYearRecord, InvoiceRecord, MasterCostRecord, PaymentRecord, SalesRecord, ScoringConfig, DEFAULT_SCORING_CONFIG, ExtendedClientProfile, ExtendedScoringConfig, DEFAULT_EXTENDED_CONFIG } from './types';
import { MatrixChart } from './ui/MatrixChart';
import { CustomerDetail } from './ui/CustomerDetail';
import { Sidebar } from './ui/Sidebar';
import { Settings } from './ui/Settings';

function StatsCard({ clients, salesHistoryCount }: { clients: ClientProfile[]; salesHistoryCount?: number }) {
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

function ExportButton({ clients }: { clients: ClientProfile[] }) {
  const handleExport = async () => {
    // Import dinámico: xlsx (429 KB) solo se carga al exportar (FE-001).
    const XLSX = await import('xlsx');
    const validClients = clients.filter(c => c.scores !== null);

    // Hoja 1: Ranking con scores principales
    const ranking = validClients.map((c) => ({
      Cliente: c.displayName,
      'Score Valor (V)': c.scores!.valueScore,
      'Score Pagos (P)': c.scores!.paymentScore,
      'Score Total (T)': c.scores!.totalScore,
      Segmento: c.scores!.segment,
      'Tier Beneficios': c.scores!.gating.maxBenefitTier,
      'Calidad Datos': c.scores!.dataQuality,
      Candados: c.scores!.gating.locks.length,
      'Ventas 12m': c.profitability?.period12m.salesTotal ?? 0,
      'GM% 12m': c.profitability?.period12m.grossMarginPct ?? 0,
      'GM$ 12m': c.profitability?.period12m.grossProfit ?? 0,
      'Mora Valor': c.payments ? c.payments.combined.lateValueRate * 100 : 0,
      'Severidad': c.payments?.combined.severity ?? 0,
      'Avg DPD': c.payments?.combined.avgDpd ?? 0,
      Flags: c.scores!.flags.join('; '),
      Acciones: c.scores!.actions.join('; ')
    }));

    // Hoja 2: Detalle de rentabilidad
    const rentabilidad = validClients.map((c) => ({
      Cliente: c.displayName,
      'Órdenes 12m': c.profitability?.period12m.orderCount ?? 0,
      'Ventas 12m': c.profitability?.period12m.salesTotal ?? 0,
      'COGS 12m': c.profitability?.period12m.cogsTotal ?? 0,
      'GM$ 12m': c.profitability?.period12m.grossProfit ?? 0,
      'GM% 12m': c.profitability?.period12m.grossMarginPct ?? 0,
      'MixMargin 12m': c.profitability?.period12m.mixMarginIndex ?? 0,
      'Órdenes 6m': c.profitability?.period6m.orderCount ?? 0,
      'Ventas 6m': c.profitability?.period6m.salesTotal ?? 0,
      'GM% 6m': c.profitability?.period6m.grossMarginPct ?? 0,
      'Score GM%': c.scores!.valueComponents.gmPctScore,
      'Score GM$': c.scores!.valueComponents.gmAbsScore,
      'Score MixMargin': c.scores!.valueComponents.mixMarginScore
    }));

    // Hoja 3: Detalle de pagos
    const pagos = validClients.map((c) => ({
      Cliente: c.displayName,
      'Facturas 12m': c.payments?.period12m.invoiceCount ?? 0,
      'Valor Total 12m': c.payments?.period12m.totalValue ?? 0,
      'LateRate 12m': c.payments?.period12m.lateRate ?? 0,
      'LateValueRate 12m': c.payments?.period12m.lateValueRate ?? 0,
      'Severidad 12m': c.payments?.period12m.severity ?? 0,
      'AvgDPD 12m': c.payments?.period12m.avgDpd ?? 0,
      'MaxDPD 12m': c.payments?.period12m.maxDpd ?? 0,
      'Volatilidad 12m': c.payments?.period12m.volatility ?? 0,
      'Facturas 6m': c.payments?.period6m.invoiceCount ?? 0,
      'LateValueRate 6m': c.payments?.raw6m.lateValueRate ?? 0,
      'Severidad 6m': c.payments?.raw6m.severity ?? 0,
      'MaxDPD 6m': c.payments?.raw6m.maxDpd ?? 0,
      'Score LateValue': c.scores!.paymentComponents.lateValueRateScore,
      'Score Severidad': c.scores!.paymentComponents.severityScore,
      'Score AvgDPD': c.scores!.paymentComponents.avgDpdScore,
      'Score Volatilidad': c.scores!.paymentComponents.volatilityScore
    }));

    // Hoja 4: Políticas y candados
    const politicas = validClients.map((c) => ({
      Cliente: c.displayName,
      Segmento: c.scores!.segment,
      'Política Crédito': c.scores!.policy.creditDescription,
      'Política Descuento': c.scores!.policy.discountDescription,
      'Prioridad Servicio': c.scores!.policy.priorityDescription,
      'Crédito Bloqueado': c.scores!.gating.creditBlocked ? 'Sí' : 'No',
      'Descuento Bloqueado': c.scores!.gating.discountBlocked ? 'Sí' : 'No',
      'Prioridad Reducida': c.scores!.gating.priorityReduced ? 'Sí' : 'No',
      'Candados Activos': c.scores!.gating.locks.map(l => l.description).join(' | '),
      'Recomendaciones': c.scores!.gating.locks.map(l => l.recommendation).join(' | ')
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ranking), 'Ranking');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rentabilidad), 'Rentabilidad');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pagos), 'Pagos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(politicas), 'Políticas');
    XLSX.writeFile(wb, 'valoracion_clientes.xlsx');
  };

  return (
    <button className="btn btn--primary" onClick={handleExport} disabled={!clients.length}>
      📊 Exportar Excel
    </button>
  );
}

type WatchSlot = 'salesHistory' | 'invoices' | 'payments' | 'sales' | 'master';
type WatchHandles = Partial<Record<WatchSlot, FileSystemFileHandle>>;

function RankingTable({
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

  const validClients = useMemo(() => {
    const list = clients.filter(c => c.scores !== null);

    return [...list].sort((a, b) => {
      let valA: any;
      let valB: any;

      switch (sortConfig.key) {
        case 'CLIENTE':
          valA = a.displayName;
          valB = b.displayName;
          break;
        case 'S':
          valA = (a.scores as any)?.salesScore ?? -1;
          valB = (b.scores as any)?.salesScore ?? -1;
          break;
        case 'V':
          valA = a.scores!.valueScore;
          valB = b.scores!.valueScore;
          break;
        case 'P':
          valA = a.scores!.paymentScore;
          valB = b.scores!.paymentScore;
          break;
        case 'T':
          valA = a.scores!.totalScore;
          valB = b.scores!.totalScore;
          break;
        case 'SEGMENTO':
          valA = a.scores!.segment;
          valB = b.scores!.segment;
          break;
        case 'VENTAS':
          valA = a.quickMetrics?.salesTotal ?? 0;
          valB = b.quickMetrics?.salesTotal ?? 0;
          break;
        case 'MARGEN%':
          valA = a.quickMetrics?.gmPct ?? 0;
          valB = b.quickMetrics?.gmPct ?? 0;
          break;
        case 'DPD P95':
          valA = a.payments?.raw6m.maxDpd ?? 0;
          valB = b.payments?.raw6m.maxDpd ?? 0;
          break;
        case '% MORA':
          valA = a.quickMetrics?.lateValueRate ?? 0;
          valB = b.quickMetrics?.lateValueRate ?? 0;
          break;
        default:
          return 0;
      }

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [clients, sortConfig]);

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

export default function App() {
  // State for tabs within Main App View
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings'>('dashboard');
  const [detailClient, setDetailClient] = useState<ClientProfile | ExtendedClientProfile | null>(null);

  const [sales, setSales] = useState<SalesRecord[]>([]);
  const [master, setMaster] = useState<MasterCostRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [salesHistory, setSalesHistory] = useState<CustomerSalesYearRecord[]>([]);
  const [hubLoading, setHubLoading] = useState(true);
  const [watchEnabled, setWatchEnabled] = useState(false);
  const [watchStatus, setWatchStatus] = useState<string | null>(null);
  const [watchHandles, setWatchHandles] = useState<WatchHandles>({});
  const watchHandlesRef = useRef<WatchHandles>({});
  const watchLastModifiedRef = useRef<Record<WatchSlot, number>>({
    salesHistory: 0,
    invoices: 0,
    payments: 0,
    sales: 0,
    master: 0
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [selectedQuadrant, setSelectedQuadrant] = useState<'Max Beneficios' | 'Condicionado' | 'Estandar' | 'Restringido' | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const DB_NAME = 'valoracion-clientes';
  const DB_STORE = 'fs-handles';
  const SYNC_FOLDER_KEY = 'sync-folder';

  const openHandlesDb = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  const saveDirectoryHandle = async (handle: FileSystemDirectoryHandle) => {
    try {
      const db = await openHandlesDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(handle, SYNC_FOLDER_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('No se pudo guardar la carpeta sincronizada', err);
    }
  };

  const loadDirectoryHandle = async (): Promise<FileSystemDirectoryHandle | null> => {
    try {
      const db = await openHandlesDb();
      return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const request = tx.objectStore(DB_STORE).get(SYNC_FOLDER_KEY);
        request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle) ?? null);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('No se pudo cargar la carpeta sincronizada', err);
      return null;
    }
  };
  // Load configs from localStorage or use defaults (with backward-compatible merge)
  const mergeScoringConfig = (saved?: Partial<ScoringConfig>): ScoringConfig => {
    const base = DEFAULT_SCORING_CONFIG;
    return {
      ...base,
      ...saved,
      valueWeights: { ...base.valueWeights, ...(saved?.valueWeights ?? {}) },
      paymentWeights: { ...base.paymentWeights, ...(saved?.paymentWeights ?? {}) },
      recencyWeights: { ...base.recencyWeights, ...(saved?.recencyWeights ?? {}) },
      gatingThresholds: { ...base.gatingThresholds, ...(saved?.gatingThresholds ?? {}) },
      segmentThresholds: { ...base.segmentThresholds, ...(saved?.segmentThresholds ?? {}) }
    };
  };

  const mergeExtendedConfig = (saved?: Partial<ExtendedScoringConfig>): ExtendedScoringConfig => {
    const base = DEFAULT_EXTENDED_CONFIG;
    const mergedBase = {
      ...base,
      ...mergeScoringConfig(saved as Partial<ScoringConfig>)
    };
    return {
      ...mergedBase,
      salesWeights: { ...base.salesWeights, ...(saved?.salesWeights ?? {}) },
      totalScoreWeightsExtended: { ...base.totalScoreWeightsExtended, ...(saved?.totalScoreWeightsExtended ?? {}) },
      extendedGates: { ...base.extendedGates, ...(saved?.extendedGates ?? {}) }
    };
  };

  const loadConfig = (): ScoringConfig => {
    try {
      const saved = localStorage.getItem('scoringConfig');
      return saved ? mergeScoringConfig(JSON.parse(saved)) : DEFAULT_SCORING_CONFIG;
    } catch (e) {
      console.warn('Error loading config from localStorage, using defaults', e);
      return DEFAULT_SCORING_CONFIG;
    }
  };

  const loadExtendedConfig = (): ExtendedScoringConfig => {
    try {
      const saved = localStorage.getItem('extendedScoringConfig');
      return saved ? mergeExtendedConfig(JSON.parse(saved)) : DEFAULT_EXTENDED_CONFIG;
    } catch (e) {
      console.warn('Error loading extended config from localStorage, using defaults', e);
      return DEFAULT_EXTENDED_CONFIG;
    }
  };

  const [config, setConfig] = useState<ScoringConfig>(loadConfig);
  const [extendedConfig, setExtendedConfig] = useState<ExtendedScoringConfig>(loadExtendedConfig);
  const [syncDirHandle, setSyncDirHandle] = useState<FileSystemDirectoryHandle | null>(null);

  const saveSettingsToDisk = async (dirHandle: FileSystemDirectoryHandle | null, conf: ScoringConfig, extConf: ExtendedScoringConfig) => {
    if (!dirHandle) return;
    try {
      const fileHandle = await dirHandle.getFileHandle('settings.dat', { create: true });
      // @ts-ignore - createWritable exists in FileSystemFileHandle
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify({ scoringConfig: conf, extendedScoringConfig: extConf }, null, 2));
      await writable.close();
    } catch (e) {
      console.warn('Error saving settings.dat', e);
    }
  };

  const loadSettingsFromDisk = async (dirHandle: FileSystemDirectoryHandle) => {
    try {
      const fileHandle = await dirHandle.getFileHandle('settings.dat');
      const file = await fileHandle.getFile();
      const text = await file.text();
      const data = JSON.parse(text);

      let newScoring = config;
      let newExtended = extendedConfig;
      let changed = false;

      if (data.scoringConfig) {
        newScoring = mergeScoringConfig(data.scoringConfig);
        setConfig(newScoring);
        localStorage.setItem('scoringConfig', JSON.stringify(newScoring));
        changed = true;
      }
      if (data.extendedScoringConfig) {
        newExtended = mergeExtendedConfig(data.extendedScoringConfig);
        setExtendedConfig(newExtended);
        localStorage.setItem('extendedScoringConfig', JSON.stringify(newExtended));
        changed = true;
      }

      if (changed) {
        console.log('Configuración restaurada desde settings.dat');
      }
    } catch (e) {
      // Ignore error if file doesn't exist
    }
  };


  // Manual save handler for configs
  const handleSaveConfig = (newConfig: ScoringConfig, newExtendedConfig: ExtendedScoringConfig) => {
    try {
      // Sincronizar propiedades compartidas para evitar inconsistencias
      const synchronizedExtendedConfig: ExtendedScoringConfig = {
        ...newExtendedConfig,
        scoringMode: newConfig.scoringMode,
        totalScoreValueWeight: newConfig.totalScoreValueWeight,
        totalScorePaymentWeight: newConfig.totalScorePaymentWeight,
        segmentThresholds: newConfig.segmentThresholds,
        useGatingForSegmentation: newConfig.useGatingForSegmentation,
        includeCurrentYearInHistory: newConfig.includeCurrentYearInHistory,
        minInvoices12m: newConfig.minInvoices12m,
        minOrders12m: newConfig.minOrders12m,
        highMarginThresholdPct: newConfig.highMarginThresholdPct,
        winsorizeP1: newConfig.winsorizeP1,
        winsorizeP99: newConfig.winsorizeP99
      };

      localStorage.setItem('scoringConfig', JSON.stringify(newConfig));
      localStorage.setItem('extendedScoringConfig', JSON.stringify(synchronizedExtendedConfig));

      setConfig(newConfig);
      setExtendedConfig(synchronizedExtendedConfig);

      if (syncDirHandle) {
        saveSettingsToDisk(syncDirHandle, newConfig, synchronizedExtendedConfig);
      }

      console.log(`Configuración guardada. Modo de Scoring: ${newConfig.scoringMode}`);
      return true;
    } catch (e) {
      console.error('Error saving config', e);
      return false;
    }
  };

  const hasData = sales.length > 0 || invoices.length > 0 || salesHistory.length > 0;

  // Helper to auto-switch to extended mode when sales history is loaded
  const updateSalesHistoryAndConfig = (data: CustomerSalesYearRecord[]) => {
    setSalesHistory(data);

    // Auto-switch to extended mode if we have data and are currently in standard mode
    if (data.length > 0 && config.scoringMode === 'standard') {
      const newConfig: ScoringConfig = { ...config, scoringMode: 'extended' };
      const newExtendedConfig: ExtendedScoringConfig = {
        ...extendedConfig,
        scoringMode: 'extended',
        segmentThresholds: newConfig.segmentThresholds,
        useGatingForSegmentation: newConfig.useGatingForSegmentation
      };
      handleSaveConfig(newConfig, newExtendedConfig);

      // Notify user via console or potentially a toast (not implemented yet)
      console.log('Auto-switched to Extended Scoring Mode due to Sales History upload');
    }
  };

  // Carga automática desde el hub de Zoho al entrar (reemplaza la subida de Excel).
  // Si falla, se queda en la pantalla de carga como respaldo manual.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadFromHub();
        if (cancelled) return;
        setSales(d.sales);
        setMaster(d.master);
        setInvoices(d.invoices);
        setPayments(d.payments);
        updateSalesHistoryAndConfig(d.salesHistory);
      } catch (e) {
        if (!cancelled) {
          setErrors([`No se pudieron cargar los datos del hub de Zoho: ${e instanceof Error ? e.message : 'error'}. Puedes subir los archivos manualmente.`]);
        }
      } finally {
        if (!cancelled) setHubLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clients = useMemo(() => {
    if (!sales.length && !invoices.length && !salesHistory.length) return [];

    // Use extended aggregation if sales history is available
    if (salesHistory.length > 0) {
      return aggregateClientsExtended(sales, master, invoices, payments, salesHistory, new Map(), new Date(), extendedConfig);
    }

    // Fallback to original aggregation
    return aggregateClients(sales, master, invoices, payments, new Date(), config);
  }, [sales, master, invoices, payments, salesHistory, config, extendedConfig]);

  const stats = useMemo(() => getPopulationStats(clients), [clients]);

  const filtered = filterClients(clients, { selectedQuadrant, selectedSegment, search });

  const handleSelectClient = (client: ClientProfile) => {
    setDetailClient(client);
  };

  // Clientes únicos para el dropdown
  const uniqueClients = useMemo(() => uniqueClientNames(clients), [clients]);

  // Pantalla de carga mientras el hub responde (auto-carga desde Zoho).
  if (hubLoading) {
    return (
      <div className="page" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 16px', width: 48, height: 48, border: '4px solid #e5e7eb', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <p style={{ color: 'var(--muted)', fontWeight: 600 }}>Cargando datos de Zoho…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // Si el hub no devolvió datos, pantalla de error con reintentar.
  if (!hasData) {
    return (
      <div className="page" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 460, padding: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ margin: '0 0 8px' }}>No se pudieron cargar los datos</h2>
          <p style={{ color: 'var(--muted)', marginBottom: 16 }}>
            {errors[0] || 'El hub de Zoho no devolvió datos. Reintenta en unos segundos.'}
          </p>
          <button className="btn btn--primary" onClick={() => window.location.reload()} style={{ padding: '12px 32px' }}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  // Vista Principal con Sidebar
  return (
    <div style={{ display: 'flex', width: '100%', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setDetailClient(null); // Reset detail view when switching main tabs
        }}
        onLogout={() => window.location.reload()}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', position: 'relative' }}>
        {activeTab === 'dashboard' && (
          <>
            {detailClient ? (
              <CustomerDetail
                client={detailClient}
                config={config}
                extendedConfig={extendedConfig}
                onBack={() => setDetailClient(null)}
              />
            ) : (
              <>
                <header className="analysis-header card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h2 style={{ margin: '0' }}>Dashboard de Análisis</h2>
                    </div>
                    <StatsCard
                      clients={clients}
                      salesHistoryCount={salesHistory.length > 0 ? new Set(salesHistory.map(r => r.customerNameNorm)).size : undefined}
                    />
                    <div className="hero__actions">
                      <ExportButton clients={clients} />
                    </div>
                  </div>
                </header>

                <section className="filters card" style={{ marginTop: '16px' }}>
                  <div className="filters__row">
                    <input
                      className="filters__search"
                      placeholder="🔍 Buscar..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <select
                      className="filters__select"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      style={{ maxWidth: '200px' }}
                    >
                      <option value="">👤 Cliente: Todos</option>
                      {uniqueClients.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>

                    <div className="filters__divider" />

                    {/* Filtros de Segmento */}
                    <button
                      className={`pill ${!selectedQuadrant && !selectedSegment ? 'pill--active' : ''}`}
                      onClick={() => { setSelectedQuadrant(null); setSelectedSegment(null); }}
                    >
                      Todos: {clients.length}
                    </button>
                    <button
                      className={`pill pill--premium ${selectedSegment === 'Premium' ? 'pill--active' : ''}`}
                      onClick={() => setSelectedSegment(selectedSegment === 'Premium' ? null : 'Premium')}
                    >
                      Premium: {stats.bySegment['Premium'] || 0}
                    </button>
                    <button
                      className={`pill pill--condicionado ${selectedSegment === 'Valioso Condicionado' ? 'pill--active' : ''}`}
                      onClick={() => setSelectedSegment(selectedSegment === 'Valioso Condicionado' ? null : 'Valioso Condicionado')}
                    >
                      Valioso Condicionado: {stats.bySegment['Valioso Condicionado'] || 0}
                    </button>
                    <button
                      className={`pill pill--estandar ${selectedSegment === 'Estándar' ? 'pill--active' : ''}`}
                      onClick={() => setSelectedSegment(selectedSegment === 'Estándar' ? null : 'Estándar')}
                    >
                      Estándar: {stats.bySegment['Estándar'] || 0}
                    </button>
                    <button
                      className={`pill pill--restringido ${selectedSegment === 'Restringido' ? 'pill--active' : ''}`}
                      onClick={() => setSelectedSegment(selectedSegment === 'Restringido' ? null : 'Restringido')}
                    >
                      Restringido: {stats.bySegment['Restringido'] || 0}
                    </button>
                  </div>
                </section>

                <main className="layout">
                  <div className="layout__col layout__col--main">
                    <MatrixChart
                      clients={clients}
                      onSelectQuadrant={(q) => setSelectedQuadrant(q)}
                      onSelectClient={handleSelectClient}
                    />
                    <RankingTable
                      clients={filtered}
                      onSelect={handleSelectClient}
                      selectedClientKey={undefined}
                      hasSalesHistory={salesHistory.length > 0}
                    />
                  </div>
                </main>
              </>
            )}
          </>
        )}

        {activeTab === 'settings' && (
          <Settings
            config={config}
            extendedConfig={extendedConfig}
            onSave={handleSaveConfig}
          />
        )}
      </div>
    </div>
  );
}

