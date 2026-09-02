import type { Request, Response } from "express";

const mockFindManyRegistros = jest.fn();
const mockCountRegistros = jest.fn();
const mockFindUniqueRegistro = jest.fn();
const mockFindManyObras = jest.fn();
const mockQueryRaw = jest.fn();

jest.mock("../config/prisma", () => ({
  prisma: {
    registros_terreno: {
      findMany: (...args: unknown[]) => mockFindManyRegistros(...args),
      count: (...args: unknown[]) => mockCountRegistros(...args),
      findUnique: (...args: unknown[]) => mockFindUniqueRegistro(...args),
    },
    obras: {
      findMany: (...args: unknown[]) => mockFindManyObras(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
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

import {
  getIngenieriaRegistros,
  iniciarRevisionIngenieria,
} from "../controllers/ingenieria.controller";

function buildResponse() {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response;
}

describe("listado paginado de Ingeniería", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindManyRegistros.mockResolvedValue([]);
    mockCountRegistros
      .mockResolvedValueOnce(279)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(239)
      .mockResolvedValueOnce(37);
    mockFindManyObras.mockResolvedValue([
      { id: "obra-1", nombre: "ODATA ETAPA II", codigo: "31" },
    ]);
    mockQueryRaw.mockResolvedValue([]);
  });

  it("filtra en PostgreSQL antes de paginar y entrega conteos completos", async () => {
    const cursor = "11111111-1111-4111-8111-111111111111";
    const request = {
      user: { id: "ingeniero-1", rol: "ingenieria" },
      query: {
        paginated: "true",
        limit: "30",
        cursor,
        estado: "rechazado",
        obraId: "obra-1",
        fecha: "2026-08-21",
        search: "00297",
      },
    } as unknown as Request;
    const response = buildResponse();

    await getIngenieriaRegistros(request, response);

    expect(mockFindManyRegistros).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          estado: "rechazado",
          obra_id: "obra-1",
          fecha: new Date("2026-08-21T00:00:00.000Z"),
          AND: [
            {
              OR: expect.arrayContaining([
                {
                  numero_sello: {
                    contains: "00297",
                    mode: "insensitive",
                  },
                },
              ]),
            },
          ],
        }),
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        take: 31,
        cursor: { id: cursor },
        skip: 1,
      }),
    );
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: {
        items: [],
        total: 37,
        nextCursor: null,
        counts: {
          todos: 279,
          en_revision: 3,
          validado: 239,
          rechazado: 37,
        },
        obras: [{ id: "obra-1", nombre: "ODATA ETAPA II", codigo: "31" }],
      },
    });
  });

  it("no permite solicitar pendientes que todavía pertenecen al supervisor", async () => {
    const request = {
      user: { id: "ingeniero-1", rol: "ingenieria" },
      query: { estado: "pendiente", paginated: "true" },
    } as unknown as Request;
    const response = buildResponse();

    await getIngenieriaRegistros(request, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(mockFindManyRegistros).not.toHaveBeenCalled();
  });

  it("impide iniciar la revisión de un registro pendiente del supervisor", async () => {
    mockFindUniqueRegistro.mockResolvedValue({
      id: "registro-1",
      estado: "pendiente",
      carga_completa: true,
      procesamiento_ingenieria: null,
    });
    const request = {
      user: { id: "ingeniero-1", rol: "ingenieria" },
      params: { id: "registro-1" },
    } as unknown as Request;
    const response = buildResponse();

    await iniciarRevisionIngenieria(request, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: "Solo se puede tomar un registro enviado a revisión por el supervisor",
    });
  });
});
