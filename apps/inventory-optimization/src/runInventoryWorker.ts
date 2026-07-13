// Helper que corre processInventoryData en un Web Worker (DATA-003) con fallback
// al hilo principal si el worker no está disponible/falla — así nunca hay
// regresión funcional, solo se pierde el no-bloqueo en ese caso.
import type { AnalysisResult } from './types';
import type { InventoryWorkerInput } from './workers/inventory.worker';

type WorkerReply = { ok: true; result: AnalysisResult[] } | { ok: false; error: string };

function runInWorker(input: InventoryWorkerInput): Promise<AnalysisResult[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/inventory.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const msg = e.data;
      worker.terminate();
      if (msg.ok) resolve(msg.result);
      else reject(new Error(msg.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'inventory worker error'));
    };
    worker.postMessage(input);
  });
}

export async function runInventoryAnalysis(input: InventoryWorkerInput): Promise<AnalysisResult[]> {
  try {
    return await runInWorker(input);
  } catch {
    // Fallback: sin Worker (o falló su carga) → cómputo en el hilo principal.
    // Import dinámico para no arrastrar calculations al bundle salvo que se use.
    const { processInventoryData } = await import('./utils/calculations');
    return processInventoryData(
      input.sales2026, input.sales2025, input.sales2024, input.sales2023,
      input.inventory, input.leadTime,
    );
  }
}
