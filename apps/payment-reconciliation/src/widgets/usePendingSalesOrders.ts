import { useCallback, useEffect, useState } from 'react';

// Hook autocontenido para el widget de órdenes por facturar. Mismo endpoint y
// patrón de auth que la vista de la app: JWT del portal → Bearer, VITE_HUB_API_URL.

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('ambientalia_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export interface PendingOrder {
  salesorder_number: string;
  date: string;
  customer_name: string | null;
  status: string;
  currency_code: string | null;
  total: number;
  pending: number;
  shipment_date: string | null;
}

export interface PendingOrdersData {
  orders: PendingOrder[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function usePendingSalesOrders(): PendingOrdersData {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!API_BASE) throw new Error('Falta VITE_HUB_API_URL');
      const res = await fetch(`${API_BASE}/api/sales-orders/pending`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data?.orders)) throw new Error('Formato inesperado del hub');
      setOrders(data.orders);
    } catch (err) {
      setError('No se pudieron cargar las órdenes por facturar.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { orders, loading, error, reload: load };
}
