import { useCallback, useEffect, useState } from 'react';

// Hook autocontenido de datos de rentabilidad para los widgets del Dashboard.
// Usa el mismo endpoint y patrón de auth que la app (App.tsx): JWT del portal en
// localStorage → Bearer, base URL desde VITE_HUB_API_URL.

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('ambientalia_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export interface ProfitabilityData {
  sales: any[];
  products: any[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useProfitabilityData(): ProfitabilityData {
  const [sales, setSales] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!API_BASE) throw new Error('Falta VITE_HUB_API_URL');
      const res = await fetch(`${API_BASE}/api/profitability/data`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data?.sales) || !Array.isArray(data?.products)) {
        throw new Error('Formato inesperado del hub');
      }
      setSales(data.sales);
      setProducts(data.products);
    } catch (err) {
      setError('No se pudieron cargar los datos de rentabilidad.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { sales, products, loading, error, reload: load };
}
