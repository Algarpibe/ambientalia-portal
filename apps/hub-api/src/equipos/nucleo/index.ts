// Núcleo puro de «Equipos en taller»: dominio, proceso de actualización y lógica de pantalla.
// Sin E/S: lo usan el servidor (hub-api) y la pantalla (apps/equipos-taller).
export * from "./tipos.js";
export * as Reglas from "./reglas.js";
export { ADENTRO } from "./reglas.js";
export { actualizar, buscarIlegibles, CV, hoyBogota } from "./actualizar.js";
export * from "./pantalla.js";
