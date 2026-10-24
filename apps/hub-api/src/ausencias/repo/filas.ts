// ARQ-612 — traducciones de filas que comparten varios trozos de repo/. Es
// INTERNO: repo.ts no lo reexporta (lo vigila barril.test.ts), porque sus
// funciones no son parte de la API del repositorio y el doble de router.test.ts
// no las conoce. Lo que sí es público, como el tipo `EmpleadoConSaldo`, lo
// reexporta el trozo dueño (saldos.ts).

/** Un empleado con sus dos configuraciones de saldo, tal como salen de la BD. */
export interface EmpleadoConSaldo {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  /** Null mientras nadie lo haya configurado. Va siempre en pareja con la fecha. */
  saldoCorte: number | null;
  fechaCorte: string | null;
  /** La bolsa de compensatorios, independiente de la de vacaciones. */
  compensatoriosSaldoCorte: number | null;
  compensatoriosFechaCorte: string | null;
  /** Para congelar el devengo de quien ya se fue. Ver `hoyCongelado`. */
  fechaRetiro: string | null;
  /**
   * Quién registró la baja. Viaja con el saldo y no con la ficha porque la vista
   * de retirados enseña las dos cosas juntas, y el número de ahí es el que se
   * paga: sin la constancia al lado, nadie sabe a quién preguntarle por él.
   */
  retiradoPor: string | null;
}

export interface FilaEmpleadoSaldoDb {
  id: string;
  nombre_completo: string;
  correo: string;
  saldo_corte: number | null;
  fecha_corte: string | null;
  compensatorios_saldo_corte: number | null;
  compensatorios_fecha_corte: string | null;
  fecha_retiro: string | null;
  retirado_por: string | null;
}

export function aEmpleadoConSaldo(r: FilaEmpleadoSaldoDb): EmpleadoConSaldo {
  return {
    empleadoId: r.id,
    nombreCompleto: r.nombre_completo,
    correo: r.correo,
    saldoCorte: r.saldo_corte,
    fechaCorte: r.fecha_corte,
    compensatoriosSaldoCorte: r.compensatorios_saldo_corte,
    compensatoriosFechaCorte: r.compensatorios_fecha_corte,
    fechaRetiro: r.fecha_retiro,
    retiradoPor: r.retirado_por,
  };
}
