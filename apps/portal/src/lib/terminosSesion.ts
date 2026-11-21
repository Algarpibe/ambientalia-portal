// Estado de las condiciones de uso del usuario con sesión (spec
// 2026-11-20-terminos-del-servicio, §5): el campo `terms` de GET /api/users/me.
//
// No hace su propia petición: lo rellena hooks/useAuth.ts con la MISMA respuesta
// que trae las apps. hub-api limita /api/users/* a 20 peticiones por minuto por IP
// y el portal ya pide /users/me; otra petición solo para esto gastaría cupo en
// cada carga de página.
//
// Va en su propio módulo y no dentro de useAuth.ts porque varios tests simulan
// useAuth entero (RutaTableroTv, RutaMisEquipos): si la pantalla de aceptación
// leyera de allí, esos tests reventarían por una exportación que su simulación no
// tiene. Aquí, sin nadie que lo rellene, simplemente no hay dato y no se pide nada.
//
// Por cuenta, como la cache de apps: lo de una cuenta no vale para la siguiente
// que entre en la misma pestaña.

export interface TermsStatus {
  /** Versión vigente según hub-api. */
  current: string;
  /** Si este usuario la tiene aceptada. */
  accepted: boolean;
}

let cache: { userId: string; terms: TermsStatus } | null = null;

/**
 * Guarda el `terms` de un perfil. Lo que no tenga la forma esperada (un hub-api
 * que todavía no lo manda, un cuerpo raro) no se guarda: sin dato no se pide la
 * aceptación, y un fallo pasajero no deja a nadie fuera del portal.
 */
export function guardarTerminos(userId: string, valor: unknown): void {
  if (valor === null || typeof valor !== 'object') return;
  const { current, accepted } = valor as { current?: unknown; accepted?: unknown };
  if (typeof current !== 'string' || typeof accepted !== 'boolean') return;
  cache = { userId, terms: { current, accepted } };
}

/** El estado de `userId`, o null si no se sabe (cargando, fallo, hub-api anterior u otra cuenta). */
export function leerTerminos(userId: string | null): TermsStatus | null {
  return userId !== null && cache?.userId === userId ? cache.terms : null;
}

/**
 * Tras un POST /api/users/me/terms con éxito: la pantalla deja de pedirla sin otra petición.
 * No avisa a nadie: quien la llame debe volver a pintarse por su cuenta (la
 * pantalla de aceptación lo hace con su propio estado).
 */
export function marcarTerminosAceptados(userId: string): void {
  if (cache?.userId === userId) cache = { userId, terms: { ...cache.terms, accepted: true } };
}

/**
 * Vacía lo guardado. La usan los tests para empezar de cero; la app no la
 * necesita: cada cuenta lleva su id y lo de otra no se usa.
 */
export function olvidarTerminos(): void {
  cache = null;
}
