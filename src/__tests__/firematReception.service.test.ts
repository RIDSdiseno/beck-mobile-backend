import { buildRecepcionDetalleParams } from "../services/firematReception.service";

describe("buildRecepcionDetalleParams", () => {
  it("entrega los ocho parámetros esperados por la inserción del detalle", () => {
    const params = buildRecepcionDetalleParams({
      recepcionId: "scan-123",
      productoId: 22,
      codigo: "10021449663837",
      cantidadEscaneos: 2,
      unidadesPorEscaneo: 12,
      stockAnterior: 0,
      stockNuevo: 24,
    });

    expect(params).toEqual([
      "scan-123",
      22,
      "10021449663837",
      2,
      12,
      24,
      0,
      24,
    ]);
  });

  it("conserva las unidades configuradas de la caja y registra el ajuste de esta recepción", () => {
    const params = buildRecepcionDetalleParams({
      recepcionId: "scan-456",
      productoId: 22,
      codigo: "10021449663837",
      cantidadEscaneos: 1,
      unidadesPorEscaneo: 12,
      unidadesIngresadas: 7,
      stockAnterior: 24,
      stockNuevo: 31,
    });

    expect(params).toEqual([
      "scan-456",
      22,
      "10021449663837",
      1,
      12,
      7,
      24,
      31,
    ]);
  });
});
