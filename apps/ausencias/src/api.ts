// El cliente de hub-api de la app de ausencias: lo único que el resto de la app
// sabe del servidor.
//
// ARQ-612 — este fichero ya no tiene código: es el barril de api/, la ÚNICA
// puerta por la que los componentes llegan a los trozos, con el mismo patrón
// que repo.ts y service.ts en hub-api. Los componentes y sus tests (cuatro de
// ellos lo sustituyen por un doble con vi.mock) lo siguen importando como
// './api'. Lo vigila api/barril.test.ts.
//
// Cómo se habla con hub-api —la URL base, los verbos y la lectura de los
// errores— vive en api/http.ts, que es INTERNO: de ahí solo se reexportan los
// tipos de los detalles de error, y cada trozo importa los verbos que usa.

export { esAdmin } from '@suite/auth-client';

// Los tipos de las respuestas, en api/tipos.ts. Se reexportan todos.
export type * from './api/tipos';
export type { CompensatoriosDetalle, RetiroDetalle, SolapeDetalle } from './api/http';

// Los endpoints, por tema. Se reexporta todo de cada trozo.
export * from './api/solicitudes';
export * from './api/modificaciones';
export * from './api/saldos';
export * from './api/calendario';
export * from './api/adjuntos';
export * from './api/historico';
export * from './api/registro';
export * from './api/organigrama';
export * from './api/retiro';
export * from './api/kpis';
export * from './api/notas';
