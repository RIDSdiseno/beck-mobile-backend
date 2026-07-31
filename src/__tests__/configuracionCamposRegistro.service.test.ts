const mockFindManyConfiguracion = jest.fn();

jest.mock("../config/prisma", () => ({
  prisma: {
    configuracion_campos_registro: {
      findMany: (...args: unknown[]) => mockFindManyConfiguracion(...args),
    },
  },
}));

import { obtenerConfiguracionRegistro } from "../services/configuracionCamposRegistro.service";

describe("configuración efectiva de campos de registro", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindManyConfiguracion.mockResolvedValue([]);
  });

  it("mantiene ocultos para jefe de obra los tres resultados derivados", async () => {
    const campos = await obtenerConfiguracionRegistro("obra-1", "jefeobra");
    const mapa = new Map(campos.map((campo) => [campo.campo, campo]));

    expect(mapa.get("cantidad_sellos_con_factores")).toMatchObject({
      color: "rojo",
      visible: false,
      configurable: false,
    });
    expect(mapa.get("cantidad_sellos_aislacion")?.visible).toBe(false);
    expect(mapa.get("cantidad_final")?.visible).toBe(false);
    expect(mapa.get("holgura")).toMatchObject({
      color: "azul",
      visible: true,
      configurable: true,
    });
  });

  it("respeta por obra un campo azul apagado para terreno", async () => {
    mockFindManyConfiguracion.mockResolvedValue([
      { campo: "holgura", visible: false },
    ]);

    const campos = await obtenerConfiguracionRegistro("obra-1", "trabajador");
    expect(campos.find((campo) => campo.campo === "holgura")?.visible).toBe(false);
    expect(campos.find((campo) => campo.campo === "numeroSello")?.visible).toBe(true);
  });

  it("deja ingeniería fija y número de sello siempre visible para cliente", async () => {
    const ingenieria = await obtenerConfiguracionRegistro("obra-1", "ingenieria");
    const cliente = await obtenerConfiguracionRegistro("obra-1", "cliente");

    expect(
      ingenieria.find(
        (campo) => campo.campo === "rendimientoSellosEsperadoDiario",
      ),
    ).toMatchObject({ color: "rojo", visible: false });
    expect(cliente.find((campo) => campo.campo === "numeroSello")).toMatchObject({
      color: "verde",
      visible: true,
      configurable: false,
    });
  });
});
