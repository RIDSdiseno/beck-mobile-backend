type RecepcionDetalleParams = {
  recepcionId: string;
  productoId: number;
  codigo: string;
  cantidadEscaneos: number;
  unidadesPorEscaneo: number;
  unidadesIngresadas?: number;
  stockAnterior: number;
  stockNuevo: number;
};

export function buildRecepcionDetalleParams({
  recepcionId,
  productoId,
  codigo,
  cantidadEscaneos,
  unidadesPorEscaneo,
  unidadesIngresadas,
  stockAnterior,
  stockNuevo,
}: RecepcionDetalleParams): Array<string | number> {
  return [
    recepcionId,
    productoId,
    codigo,
    cantidadEscaneos,
    unidadesPorEscaneo,
    unidadesIngresadas ?? cantidadEscaneos * unidadesPorEscaneo,
    stockAnterior,
    stockNuevo,
  ];
}
