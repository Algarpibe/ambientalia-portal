/** Concentration unit conversions. The engine works internally in ppb. */

const PPB_PER_PPM = 1000;

/** ppm -> ppb (1 ppm = 1000 ppb). */
export function ppmToPpb(ppm: number): number {
  return ppm * PPB_PER_PPM;
}

/** ppb -> ppm (1 ppb = 0.001 ppm). */
export function ppbToPpm(ppb: number): number {
  return ppb / PPB_PER_PPM;
}
