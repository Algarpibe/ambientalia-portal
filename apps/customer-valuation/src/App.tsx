
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
import { StatsCard } from './ui/StatsCard';
import { ExportButton } from './ui/ExportButton';
import { RankingTable } from './ui/RankingTable';

type WatchSlot = 'salesHistory' | 'invoices' | 'payments' | 'sales' | 'master';
type WatchHandles = Partial<Record<WatchSlot, FileSystemFileHandle>>;

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

      if (data.scoringConfig) {
        newScoring = mergeScoringConfig(data.scoringConfig);
        setConfig(newScoring);
        localStorage.setItem('scoringConfig', JSON.stringify(newScoring));
      }
      if (data.extendedScoringConfig) {
        newExtended = mergeExtendedConfig(data.extendedScoringConfig);
        setExtendedConfig(newExtended);
        localStorage.setItem('extendedScoringConfig', JSON.stringify(newExtended));
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

