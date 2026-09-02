import type { Request, Response } from "express";

const mockFindManyRegistros = jest.fn();
const mockCountRegistros = jest.fn();
const mockQueryRaw = jest.fn();

jest.mock("../config/prisma", () => ({
  prisma: {
    registros_terreno: {
      findMany: (...args: unknown[]) => mockFindManyRegistros(...args),
      count: (...args: unknown[]) => mockCountRegistros(...args),
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
    mockCountRegistros.mockResolvedValue(0);
    mockQueryRaw.mockResolvedValue([]);
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
              corregido_at: { not: null },
            },
            {
              estado: "rechazado",
            },
            {
              estado: "pendiente",
              es_correccion: true,
              devuelto_a_tecnico: false,
              corregido_at: null,
            },
          ],
        }),
        orderBy: { created_at: "desc" },
        take: 100,
      }),
    );
    expect(response.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it("devuelve páginas con cursor y conteos calculados en toda la obra", async () => {
    const registros = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        obra_id: "obra-1",
        aislacion: null,
        foto_url: null,
        fotos_urls: [],
        fotos: [],
        registros_terreno: null,
        usuarios_registros_terreno_rechazado_por_idTousuarios: null,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        obra_id: "obra-1",
        aislacion: null,
        foto_url: null,
        fotos_urls: [],
        fotos: [],
        registros_terreno: null,
        usuarios_registros_terreno_rechazado_por_idTousuarios: null,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        obra_id: "obra-1",
        aislacion: null,
        foto_url: null,
        fotos_urls: [],
        fotos: [],
        registros_terreno: null,
        usuarios_registros_terreno_rechazado_por_idTousuarios: null,
      },
    ];
    mockFindManyRegistros.mockResolvedValue(registros);
    mockCountRegistros
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2);
    const request = {
      user: { id: "supervisor-1", rol: "jefeobra" },
      query: {
        obraId: "obra-1",
        scope: "registro",
        paginated: "true",
        limit: "2",
      },
    } as unknown as Request;
    const response = buildResponse();

    await getMisRegistros(request, response);

    expect(mockFindManyRegistros).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
      }),
    );
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ id: registros[0].id }),
          expect.objectContaining({ id: registros[1].id }),
        ]),
        total: 7,
        nextCursor: registros[1].id,
        counts: { todos: 7, pendiente: 5, rechazado: 2 },
      }),
    });
  });

  it("busca por número de registro y continúa desde el cursor solicitado", async () => {
    const registroId = "ddbe9a2c-9c9c-4987-b1ec-5f4cd112708f";
    const cursor = "11111111-1111-4111-8111-111111111111";
    mockQueryRaw.mockResolvedValue([{ id: registroId }]);
    const request = {
      user: { id: "supervisor-1", rol: "jefeobra" },
      query: {
        obraId: "obra-1",
        scope: "registro",
        paginated: "true",
        search: "REG-DDBE9A",
        cursor,
      },
    } as unknown as Request;
    const response = buildResponse();

    await getMisRegistros(request, response);

    expect(mockQueryRaw).toHaveBeenCalled();
    expect(mockFindManyRegistros).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: cursor },
        skip: 1,
        where: expect.objectContaining({
          AND: [
            {
              OR: expect.arrayContaining([{ id: { in: [registroId] } }]),
            },
          ],
        }),
      }),
    );
  });

  it("aplica la búsqueda por número de sello en PostgreSQL", async () => {
    const request = {
      user: { id: "supervisor-1", rol: "jefeobra" },
      query: {
        obraId: "obra-1",
        scope: "registro",
        paginated: "true",
        search: "00048",
      },
    } as unknown as Request;
    const response = buildResponse();

    await getMisRegistros(request, response);

    expect(mockFindManyRegistros).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: expect.arrayContaining([
                {
                  numero_sello: {
                    contains: "00048",
                    mode: "insensitive",
                  },
                },
              ]),
            },
          ],
        }),
      }),
    );
  });
});
