/**
 * A dónde se vuelve tras iniciar sesión (spec 2026-11-20, §5.2).
 *
 * `state.from` lo dejan RequireAuth y RequireAdmin al mandar a /auth a quien
 * llega sin sesión, por ejemplo desde el enlace a una app de un correo de
 * acceso. Solo vale una ruta INTERNA del portal: empieza por «/», no sigue otra
 * «/» ni «\» (el navegador lee «//otra.web» y «/\otra.web» como otra web) y no
 * lleva espacios en blanco (el navegador quita tabuladores y saltos de línea de
 * las URL, y «/<tab>/otra.web» acabaría siendo «//otra.web»). Cualquier otra
 * cosa lleva al inicio: sin redirecciones abiertas.
 */
export function destinoTrasLogin(state: unknown): string {
  const from = (state as { from?: unknown } | null | undefined)?.from;
  if (typeof from !== 'string') return '/';
  if (!/^\/(?![/\\])/.test(from) || /[\\\s]/.test(from)) return '/';
  return from;
}
