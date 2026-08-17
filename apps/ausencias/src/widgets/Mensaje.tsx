// El estado «cargando / error / vacío» de los widgets del Dashboard. Compartido
// entre WidgetSaldo y WidgetPendientes: los dos lo pintaban idéntico, así que
// vive aquí una sola vez.

export default function Mensaje({ children, tono }: { children: React.ReactNode; tono?: 'error' }) {
  return (
    <div
      className={`flex h-full items-center justify-center px-3 text-center text-sm ${
        tono === 'error' ? 'text-red-600' : 'text-gray-500'
      }`}
    >
      {children}
    </div>
  );
}
