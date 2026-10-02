import type { Request, Response } from "express";

const mockFindManyOpciones = jest.fn();
const mockFindManyConfigs = jest.fn();

jest.mock("../config/prisma", () => ({
  prisma: {
    itemizado_opciones: { findMany: (...args: unknown[]) => mockFindManyOpciones(...args) },
    configuracion_itemizado_opcion_obra: { findMany: (...args: unknown[]) => mockFindManyConfigs(...args) },
  },
}));

jest.mock("../services/obras.service", () => ({ canAccessObra: jest.fn().mockResolvedValue(true) }));

import { getItemizadoOpciones } from "../controllers/itemizadoOpciones.controller";

const OBRA = "11111111-1111-4111-8111-111111111111";

// Catálogo vigente, en el orden que devuelve la base (codigo_beck asc).
const catalogo = [
  { id: "op-1-140", codigo_beck: "1-140", tipo: "Metálica", elemento_pasante: "Tubería metálica de Ø ≤ 110 mm", elemento_penetra: "Losa", materialidad: "Hormigón", visible: false },
  { id: "op-1-141", codigo_beck: "1-141", tipo: "Metálica", elemento_pasante: "Tubería metálica de Ø ≤ 160 mm", elemento_penetra: "Losa", materialidad: "Hormigón", visible: false },
  { id: "op-1-144", codigo_beck: "1-144", tipo: "Metálica", elemento_pasante: "Tubería metálica de Ø ≤ 50 mm", elemento_penetra: "Losa", materialidad: "Hormigón", visible: false },
];

function buildResponse() {
  const response = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & { status: jest.Mock; json: jest.Mock };
}

async function consultar(query: Record<string, string>) {
  const res = buildResponse();
  await getItemizadoOpciones({ query, user: { id: "u-1", rol: "terreno" } } as unknown as Request, res);
  return res.json.mock.calls[0][0] as { success: boolean; data: Array<Record<string, unknown>> };
}

describe("itemizado por obra con códigos propios (itemizado antiguo)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindManyOpciones.mockResolvedValue(catalogo);
  });

  it("en Sótero devuelve el código antiguo como codigo_beck, que es lo que la app muestra y guarda", async () => {
    // Sótero usa 1-140 (Ø ≤ 110) con su código antiguo 1-141, y 1-144 (Ø ≤ 50) con su antiguo 1-140.
    mockFindManyConfigs.mockResolvedValue([
      { itemizado_opcion_id: "op-1-140", visible: true, nombre_personalizado: null, codigo_personalizado: "1-141" },
      { itemizado_opcion_id: "op-1-144", visible: true, nombre_personalizado: null, codigo_personalizado: "1-140" },
    ]);

    const { data } = await consultar({ obraId: OBRA });

    expect(data.map((op) => [op.codigo_beck, op.elemento_pasante])).toEqual([
      ["1-140", "Tubería metálica de Ø ≤ 50 mm"],
      ["1-141", "Tubería metálica de Ø ≤ 110 mm"],
    ]);
    expect(data.find((op) => op.codigo_beck === "1-141")?.codigo_beck_catalogo).toBe("1-140");
    // El 1-141 vigente (Ø ≤ 160) no está habilitado en la obra: no aparece.
    expect(data.some((op) => op.elemento_pasante === "Tubería metálica de Ø ≤ 160 mm")).toBe(false);
  });

  it("en una obra sin códigos propios no cambia nada: mismo código y mismo orden de la base", async () => {
    mockFindManyConfigs.mockResolvedValue([
      { itemizado_opcion_id: "op-1-144", visible: true, nombre_personalizado: null, codigo_personalizado: null },
      { itemizado_opcion_id: "op-1-140", visible: true, nombre_personalizado: null, codigo_personalizado: null },
    ]);

    const { data } = await consultar({ obraId: OBRA });

    expect(data.map((op) => op.codigo_beck)).toEqual(["1-140", "1-144"]);
    data.forEach((op) => expect(op.codigo_beck).toBe(op.codigo_beck_catalogo));
  });

  it("la búsqueda encuentra el ítem por el código antiguo de la obra", async () => {
    mockFindManyConfigs
      .mockResolvedValueOnce([{ itemizado_opcion_id: "op-1-140" }]) // búsqueda por código propio
      .mockResolvedValueOnce([
        { itemizado_opcion_id: "op-1-140", visible: true, nombre_personalizado: null, codigo_personalizado: "1-141" },
      ]);

    await consultar({ obraId: OBRA, search: "1-141" });

    const [busquedaCodigoObra] = mockFindManyConfigs.mock.calls[0];
    expect(busquedaCodigoObra.where).toEqual({
      obra_id: OBRA,
      codigo_personalizado: { contains: "1-141", mode: "insensitive" },
    });
    const [{ where }] = mockFindManyOpciones.mock.calls[0];
    expect(where.OR).toContainEqual({ id: { in: ["op-1-140"] } });
  });

  it("sin obra no consulta códigos propios y responde como antes", async () => {
    mockFindManyOpciones.mockResolvedValue(catalogo.map((op) => ({ ...op, visible: true })));

    const { data } = await consultar({ search: "1-14" });

    expect(mockFindManyConfigs).not.toHaveBeenCalled();
    expect(data.map((op) => op.codigo_beck)).toEqual(["1-140", "1-141", "1-144"]);
    expect(data[0]).not.toHaveProperty("codigo_beck_catalogo");
  });
});
