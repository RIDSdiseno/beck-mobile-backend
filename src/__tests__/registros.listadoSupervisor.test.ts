import type { Request, Response } from "express";

const mockFindManyRegistros = jest.fn();

jest.mock("../config/prisma", () => ({
  prisma: {
    registros_terreno: {
      findMany: (...args: unknown[]) => mockFindManyRegistros(...args),
    },
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

jest.mock("../services/configuracionCamposRegistro.service", () => ({
  crearMapaVisibilidad: jest.fn(),
  obtenerConfiguracionRegistro: jest.fn(),
}));

jest.mock("../services/registrosIncompletos.service", () => ({
  eliminarRegistroIncompleto: jest.fn(),
}));

jest.mock("../services/obras.service", () => ({
  canAccessObra: jest.fn(),
}));

import { getMisRegistros } from "../controllers/registros.controller";

function buildResponse() {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response;
}

describe("getMisRegistros para supervisor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindManyRegistros.mockResolvedValue([]);
  });

  it("filtra la obra y los estados operativos antes de limitar los resultados", async () => {
    const request = {
      user: { id: "supervisor-1", rol: "jefeobra" },
      query: { obraId: "obra-1", scope: "registro" },
    } as unknown as Request;
    const response = buildResponse();

    await getMisRegistros(request, response);

    expect(mockFindManyRegistros).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          carga_completa: true,
          obra_id: "obra-1",
          other_registros_terreno: { none: {} },
          OR: [
            {
              estado: "pendiente",
              es_correccion: false,
            },
            {
              estado: "pendiente",
              es_correccion: true,
              devuelto_a_tecnico: false,
            },
            {
              estado: "rechazado",
            },
          ],
        }),
        orderBy: { created_at: "desc" },
        take: 100,
      }),
    );
    expect(response.json).toHaveBeenCalledWith({ success: true, data: [] });
  });
});
