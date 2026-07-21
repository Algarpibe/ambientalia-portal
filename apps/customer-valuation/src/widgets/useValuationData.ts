import { useCallback, useEffect, useState } from 'react';

// Hook autocontenido de datos de valoración de clientes para los widgets del
// Dashboard. Usa el mismo endpoint y patrón de auth que la app (App.tsx /
// hub/loadFromHub.ts): JWT del portal en localStorage → Bearer, base URL desde
// VITE_HUB_API_URL. Devuelve los arreglos crudos del hub (formato Zoho) tal cual;
// el mapeo y la agregación viven en analysis.ts.

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

import { authHeaders } from '@suite/auth-client';

export interface ValuationData {
  sales: any[];
  master: any[];
  invoices: any[];
  payments: any[];
  salesHistory: any[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useValuationData(): ValuationData {
  const [sales, setSales] = useState<any[]>([]);
  const [master, setMaster] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!API_BASE) throw new Error('Falta VITE_HUB_API_URL');
      const res = await fetch(`${API_BASE}/api/customer-valuation/data`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || typeof data !== 'object') throw new Error('Formato inesperado del hub');
      setSales(Array.isArray(data.sales) ? data.sales : []);
      setMaster(Array.isArray(data.master) ? data.master : []);
      setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
      setPayments(Array.isArray(data.payments) ? data.payments : []);
      setSalesHistory(Array.isArray(data.salesHistory) ? data.salesHistory : []);
    } catch (err) {
      setError('No se pudieron cargar los datos de valoración de clientes.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { sales, master, invoices, payments, salesHistory, loading, error, reload: load };
}
