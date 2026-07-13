import { useEffect, useState } from 'react';
import { subscribe, dismiss, type Notice } from '../lib/notify';

// Renderiza los toasts activos (esquina superior derecha). Se monta una vez en
// App para que las notificaciones emitidas con notify() sean visibles aunque se
// dispare una navegación al mismo tiempo.
export default function NotificationHost() {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => subscribe(setNotices), []);

  if (notices.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2" role="status" aria-live="polite">
      {notices.map((n) => (
        <div
          key={n.id}
          className={
            'flex items-start gap-3 rounded-lg px-4 py-3 shadow-lg text-sm font-medium max-w-sm ' +
            (n.kind === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white')
          }
        >
          <span className="flex-1">{n.message}</span>
          <button
            onClick={() => dismiss(n.id)}
            className="shrink-0 opacity-80 hover:opacity-100"
            aria-label="Cerrar notificación"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
