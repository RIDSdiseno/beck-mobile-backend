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
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
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

import { getMisRegistros, getHistorialRegistros } from "../controllers/registros.controller";

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

  it.each(["sello_cortafuego", "junta_lineal_espuma", "tabiqueria"])("filtra %s en datos y conteos de todos los listados operativos", async (tipoRegistro) => {
    for (const [rol, vista] of [["terreno", undefined], ["jefeobra", undefined], ["administrador", "operario"], ["administrador", "supervisor"]]) {
      mockFindManyRegistros.mockClear();
      mockCountRegistros.mockClear();
      const res = buildResponse();
      await getMisRegistros({
        user: { id: "usuario-1", rol },
        query: { tipoRegistro, scope: "registro", paginated: "true", search: "piso", limit: "30", vista },
      } as unknown as Request, res);
      expect(res.status).not.toHaveBeenCalledWith(500);
      const query = mockFindManyRegistros.mock.calls[0][0];
      expect(query).toMatchObject({ where: { tipo_registro: tipoRegistro, carga_completa: true, other_registros_terreno: { none: {} } }, take: 31 });
      expect(mockCountRegistros).toHaveBeenCalledTimes(3);
      for (const [count] of mockCountRegistros.mock.calls) expect(count.where.tipo_registro).toBe(tipoRegistro);
      if (rol === "terreno" || vista === "operario") expect(query.where.usuario_id).toBe("usuario-1");
    }
  });

  it("combina fecha de ejecución, tipo, estado y obra antes de paginar y contar", async () => {
    const cursor = "11111111-1111-4111-8111-111111111111";
    const res = buildResponse();
    await getMisRegistros({
      user: { id: "supervisor-1", rol: "jefeobra" },
      query: { paginated: "true", scope: "registro", obraId: "obra-1", estado: "pendiente",
        tipoRegistro: "tabiqueria", fecha: "2026-08-21", search: "001", cursor },
    } as unknown as Request, res);
    const query = mockFindManyRegistros.mock.calls[0][0];
    expect(query).toMatchObject({
      where: { fecha: new Date("2026-08-21T00:00:00.000Z"), tipo_registro: "tabiqueria", obra_id: "obra-1" },
      cursor: { id: cursor }, skip: 1, take: 26,
    });
    expect(query.where.created_at).toBeUndefined();
    for (const [count] of mockCountRegistros.mock.calls) {
      expect(count.where.fecha.toISOString()).toBe("2026-08-21T00:00:00.000Z");
      expect(count.where.tipo_registro).toBe("tabiqueria");
      expect(count.where.obra_id).toBe("obra-1");
    }
  });

  it.each(["2026-02-30", "2026-02-29", "2026-13-01", "21/08/2026", "2026-08-21T03:00:00Z"])("rechaza fecha inválida %s sin consultar datos", async (fecha) => {
    const res = buildResponse();
    await getMisRegistros({ user: { id: "supervisor-1", rol: "jefeobra" },
      query: { scope: "registro", paginated: "true", fecha },
    } as unknown as Request, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFindManyRegistros).not.toHaveBeenCalled();
  });

  it.each([undefined, ""])("Todas las fechas no restringe la consulta (%s)", async (fecha) => {
    await getMisRegistros({ user: { id: "supervisor-1", rol: "jefeobra" },
      query: { scope: "registro", paginated: "true", fecha },
    } as unknown as Request, buildResponse());
    expect(mockFindManyRegistros.mock.calls[0][0].where.fecha).toBeUndefined();
  });

  it("el operario continúa con cursor y conserva las correcciones devueltas", async () => {
    const cursor = "11111111-1111-4111-8111-111111111111";
    await getMisRegistros({
      user: { id: "operario-1", rol: "terreno" },
      query: { paginated: "true", scope: "registro", estado: "rechazado", tipoRegistro: "tabiqueria", cursor },
    } as unknown as Request, buildResponse());
    expect(mockFindManyRegistros.mock.calls[0][0]).toMatchObject({
      cursor: { id: cursor }, skip: 1,
      where: { usuario_id: "operario-1", tipo_registro: "tabiqueria", OR: [
        { estado: "rechazado", devuelto_a_tecnico: true },
        { estado: "pendiente", es_correccion: true, devuelto_a_tecnico: true },
      ] },
    });
  });

  it.each(["terreno", "jefeobra", "ingenieria", "administrador"])("filtra el historial de %s y su total sin perder permisos", async (rol) => {
    const res = buildResponse();
    await getHistorialRegistros({
      user: { id: "usuario-1", rol },
      query: { tipoRegistro: "junta_lineal_espuma", obraId: "obra-1", fecha: "2026-09-30", search: "001", limit: "25" },
    } as unknown as Request, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const query = mockFindManyRegistros.mock.calls[0][0];
    expect(query).toMatchObject({ where: { tipo_registro: "junta_lineal_espuma", carga_completa: true }, take: 26 });
    const roleFilter = query.where.AND[0];
    if (rol === "terreno") expect(roleFilter).toEqual({ usuario_id: "usuario-1" });
    if (rol === "jefeobra") expect(roleFilter.enviado_ingenieria_por_id).toBe("usuario-1");
    if (rol === "ingenieria") expect(roleFilter.procesamiento_ingenieria.is.usuario_id).toBe("usuario-1");
    expect(mockCountRegistros).toHaveBeenCalledWith({ where: query.where });
  });

  it("rechaza tipos desconocidos antes de consultar registros", async () => {
    const res = buildResponse();
    await getMisRegistros({ user: { id: "1", rol: "terreno" }, query: { tipoRegistro: "inventado" } } as unknown as Request, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFindManyRegistros).not.toHaveBeenCalled();
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
