// Ruta bajo la que el portal monta esta sub-app (ver, en apps/portal:
// src/lib/apps.ts, la <Route path="/salestracker/*"> de src/App.tsx, y AppGuard).
// La navegación interna usa rutas ABSOLUTAS a partir de esta base: la sub-app se
// monta bajo un splat con <Routes> descendiente, y en ese contexto los enlaces
// RELATIVOS de react-router se resuelven contra la ruta actual y se apilan
// (p. ej. "Clientes" desde /salestracker/articulos → /salestracker/articulos/clientes).
export const APP_BASE = '/salestracker';
