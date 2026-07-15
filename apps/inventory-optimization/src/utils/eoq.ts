// EOQ (fórmula de Wilson). Vive en su propio módulo porque lo usan las dos capas:
// el motor de cálculo (calculations, que solo se carga en el worker) y la tabla
// (resultTableLogic). Si lo tuviera calculations, importarlo desde la tabla
// arrastraría todo el motor al bundle principal.

// EOQ = √(2·D·S / H), con H = tasa mantenimiento anual × costo unitario.
// D = demanda anual (uds), S = costo por pedido. 0 si no hay demanda o costo.
export function computeEoq(annualUnits: number, unitCost: number, orderCost: number, holdingRatePct: number): number {
  const H = (holdingRatePct / 100) * unitCost;
  if (annualUnits <= 0 || H <= 0 || orderCost <= 0) return 0;
  return Math.max(1, Math.round(Math.sqrt((2 * annualUnits * orderCost) / H)));
}
