/**
 * Single entry point to the pure O3 engine, imported by relative path from
 * hub-api (the same code the server runs authoritatively). Every UI module
 * imports the engine from here, so a future move of the engine to a shared
 * package touches one line.
 */
export * from '../../hub-api/src/calibraciones/o3-engine';
