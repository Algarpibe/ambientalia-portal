// ARQ-612 — el error de dominio de ausencias, en su propio fichero. Vivía en
// service.ts, y eso obligaba a historico.ts a importar el servicio entero mientras
// el servicio importaba historico.ts: un ciclo. service.ts lo reexporta, así que
// quien lo importaba de allí no cambia. Tiene que haber UNA sola clase: router.ts
// traduce a HTTP con `instanceof AusenciaError`.

/** Error de dominio con su código HTTP, como `UserError` en users.service.ts. */
export class AusenciaError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly field?: string,
    /**
     * Datos del conflicto, para los errores que sin ellos no se pueden accionar.
     * «Te solapas» sin decir CON QUÉ deja a la persona sin saber qué corregir.
     * Opcional: la inmensa mayoría de los errores se explican solos con `code`.
     */
    public readonly detalle?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'AusenciaError';
  }
}
