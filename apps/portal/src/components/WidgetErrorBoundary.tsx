import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { captureWidgetError } from '../sentry';

// Aísla el fallo de un widget: si su render (o su carga lazy) lanza, muestra un
// estado de error local sin desmontar el resto del grid. Ver design.md, Prop. 11.

interface Props {
  widgetId: string;
  appId: string;
  widgetName?: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown): void {
    captureWidgetError(error, { widgetId: this.props.widgetId, appId: this.props.appId });
  }

  render() {
    if (this.state.hasError) {
      const { widgetName } = this.props;
      const message = this.state.error?.message ?? 'Error desconocido';
      return (
        <div className="h-full w-full bg-red-50 border border-red-200 rounded-2xl p-4 flex flex-col gap-2 overflow-hidden">
          <div className="flex items-center gap-2 text-red-600 font-semibold text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="truncate">{widgetName ?? 'Widget'}</span>
          </div>
          <p className="text-xs text-red-500 leading-snug">Error al renderizar: {message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default WidgetErrorBoundary;
