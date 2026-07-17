import { useCallback, useEffect, useState } from 'react';

// Hook autocontenido de datos de conciliación para los widgets del Dashboard.
// Usa el mismo endpoint y patrón de auth que la app (App.tsx): JWT del portal en
// localStorage → Bearer, base URL desde VITE_HUB_API_URL.

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('ambientalia_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export interface ReconciliationData {
  invoices: any[];
  payments: any[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useReconciliationData(): ReconciliationData {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!API_BASE) throw new Error('Falta VITE_HUB_API_URL');
      const res = await fetch(`${API_BASE}/api/reconciliation/data`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data?.invoices) || !Array.isArray(data?.payments)) {
        throw new Error('Formato inesperado del hub');
      }
      setInvoices(data.invoices);
      setPayments(data.payments);
    } catch (err) {
      setError('No se pudieron cargar los datos de conciliación.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { invoices, payments, loading, error, reload: load };
}
