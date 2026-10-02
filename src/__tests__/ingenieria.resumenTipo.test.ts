import type { Request, Response } from "express";

const mockCountRegistros = jest.fn();

jest.mock("../config/prisma", () => ({
  prisma: {
    registros_terreno: {
      count: (...args: unknown[]) => mockCountRegistros(...args),
    },
    $transaction: (operaciones: Promise<unknown>[]) => Promise.all(operaciones),
  },
}));

jest.mock("../services/cloudinary.service", () => ({
  deleteImageFromCloudinary: jest.fn(),
  uploadBufferToCloudinary: jest.fn(),
  withPrivateImageUrl: jest.fn((foto) => foto),
}));

jest.mock("../services/calculosRegistroTerreno.service", () => ({
  calcularCamposConConfiguracion: jest.fn(),
  getFactoresAislacionObra: jest.fn(),
}));

jest.mock("../controllers/registros.controller", () => ({
  buildCloudinaryFolder: jest.fn(),
}));

import { getIngenieriaResumen } from "../controllers/ingenieria.controller";

function buildResponse() {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & { status: jest.Mock; json: jest.Mock };
}

function buildRequest(query: Record<string, unknown> = {}) {
  return { user: { id: "user-1", rol: "ingenieria" }, query } as unknown as Request;
}

const wheres = () => mockCountRegistros.mock.calls.map(([args]) => (args as { where: Record<string, unknown> }).where);

describe("resumen de Ingeniería por tipo de registro", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCountRegistros
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(1);
  });

  it("sin tipo conserva el contrato anterior y no filtra ningún conteo", async () => {
    const res = buildResponse();
    await getIngenieriaResumen(buildRequest(), res);

    expect(mockCountRegistros).toHaveBeenCalledTimes(5);
    wheres().forEach((where) => expect(where).not.toHaveProperty("tipo_registro"));
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        pendientesRevision: 12,
        enRevisionMios: 4,
        correccionesRecibidas: 2,
        validadosMes: 7,
        rechazadosMes: 1,
        revisionesResueltasMes: 8,
      },
    });
  });

  it.each(["sello_cortafuego", "junta_lineal_espuma", "tabiqueria"])(
    "con tipoRegistro=%s filtra los cinco conteos por ese tipo",
    async (tipo) => {
      const res = buildResponse();
      await getIngenieriaResumen(buildRequest({ tipoRegistro: tipo }), res);

      expect(mockCountRegistros).toHaveBeenCalledTimes(5);
      wheres().forEach((where) => expect(where).toMatchObject({ tipo_registro: tipo, carga_completa: true }));
    },
  );

  it("'todos' se trata como sin filtro", async () => {
    await getIngenieriaResumen(buildRequest({ tipoRegistro: "todos" }), buildResponse());
    wheres().forEach((where) => expect(where).not.toHaveProperty("tipo_registro"));
  });

  it("rechaza un tipo inválido sin consultar la base", async () => {
    const res = buildResponse();
    await getIngenieriaResumen(buildRequest({ tipoRegistro: "inventado" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCountRegistros).not.toHaveBeenCalled();
  });
});
