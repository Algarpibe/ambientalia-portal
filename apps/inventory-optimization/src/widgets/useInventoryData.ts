import { useCallback, useEffect, useState } from 'react';
import type { RawSalesData, RawInventoryData, RawLeadTimeData } from '../types';

// Hook autocontenido de datos de inventario para los widgets del Dashboard.
// Usa el mismo endpoint y patrón de auth que la app (App.tsx): JWT del portal en
// localStorage → Bearer, base URL desde VITE_HUB_API_URL. NO necesita las
// preferencias del usuario (/api/users/me/preferences): el widget solo consume
// los datos crudos del hub.

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

import { authHeaders } from '@suite/auth-client';

export interface InventoryData {
  sales2026: RawSalesData[];
  sales2025: RawSalesData[];
  sales2024: RawSalesData[];
  sales2023: RawSalesData[];
  inventory: RawInventoryData[];
  leadTime: RawLeadTimeData[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const EMPTY = {
  sales2026: [] as RawSalesData[],
  sales2025: [] as RawSalesData[],
  sales2024: [] as RawSalesData[],
  sales2023: [] as RawSalesData[],
  inventory: [] as RawInventoryData[],
  leadTime: [] as RawLeadTimeData[],
};

export function useInventoryData(): InventoryData {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!API_BASE) throw new Error('Falta VITE_HUB_API_URL');
      const res = await fetch(`${API_BASE}/api/inventory/data`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const keys = ['sales2026', 'sales2025', 'sales2024', 'sales2023', 'inventory', 'leadTime'];
      if (!keys.every((k) => Array.isArray(d?.[k]))) {
        throw new Error('Formato inesperado del hub');
      }
      setData({
        sales2026: d.sales2026 as RawSalesData[],
        sales2025: d.sales2025 as RawSalesData[],
        sales2024: d.sales2024 as RawSalesData[],
        sales2023: d.sales2023 as RawSalesData[],
        inventory: d.inventory as RawInventoryData[],
        leadTime: d.leadTime as RawLeadTimeData[],
      });
    } catch (err) {
      setError('No se pudieron cargar los datos de inventario.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...data, loading, error, reload: load };
}
