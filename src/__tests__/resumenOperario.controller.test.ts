import type { Request, Response } from "express";
const mockCount = jest.fn();
const mockRecent = jest.fn();
const mockGroup = jest.fn();
const mockObras = jest.fn();
jest.mock("../config/prisma", () => ({ prisma: {
  registros_terreno: {
    count: (...args: unknown[]) => mockCount(...args),
    findMany: (...args: unknown[]) => mockRecent(...args),
    groupBy: (...args: unknown[]) => mockGroup(...args),
  },
  obras: { findMany: (...args: unknown[]) => mockObras(...args) },
  $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
} }));
import { getResumenOperario } from "../controllers/resumenOperario.controller";

const obraId = "11111111-1111-4111-8111-111111111111";
const req = (query = {}, user: unknown = { id: "operario-1", rol: "terreno" }) => ({ query, user }) as Request;
const res = () => {
  const response = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
};
beforeEach(() => {
  jest.clearAllMocks();
  mockCount.mockResolvedValue(0);
  mockRecent.mockResolvedValue([]);
  mockGroup.mockResolvedValue([]);
  mockObras.mockResolvedValue([]);
});

test.each(["sello_cortafuego", "junta_lineal_espuma", "tabiqueria"])("filtra %s por obra y por dueño en todos los indicadores y movimientos", async (tipoRegistro) => {
  const response = res();
  await getResumenOperario(req({ tipoRegistro, obraId }), response);
  expect(response.status).not.toHaveBeenCalled();
  expect(mockCount).toHaveBeenCalledTimes(6);
  for (const [query] of [...mockCount.mock.calls, ...mockRecent.mock.calls, ...mockGroup.mock.calls]) {
    expect(query.where).toMatchObject({ usuario_id: "operario-1", carga_completa: true, obra_id: obraId, tipo_registro: tipoRegistro });
    expect(query.where.OR).toEqual([
      { es_correccion: false }, { es_correccion: true, devuelto_a_tecnico: true },
      { es_correccion: true, corregido_at: { not: null } }, { estado: { not: "pendiente" } },
    ]);
  }
  expect(mockCount.mock.calls[1][0].where).toMatchObject({ es_correccion: false, registro_origen_id: null });
  expect(mockCount.mock.calls[2][0].where).toMatchObject({ estado: "pendiente", NOT: { es_correccion: true, devuelto_a_tecnico: true } });
  expect(mockCount.mock.calls[5][0].where).toMatchObject({ estado: "pendiente", es_correccion: true, devuelto_a_tecnico: true });
  const optionsScope = mockObras.mock.calls[0][0].where.registros_terreno.some;
  expect(optionsScope.usuario_id).toBe("operario-1");
  expect(optionsScope.obra_id).toBeUndefined();
  expect(optionsScope.tipo_registro).toBeUndefined();
});

test("calcula el avance con más de 100 registros y limita solamente los últimos movimientos", async () => {
  [250, 220, 60, 40, 125, 5].forEach((value) => mockCount.mockResolvedValueOnce(value));
  mockGroup.mockResolvedValue([{ obra_id: obraId, _count: { _all: 250 } }]);
  mockObras.mockResolvedValue([{ id: obraId, nombre: "ODATA II", codigo: "31" }]);
  const response = res();
  await getResumenOperario(req({ tipoRegistro: "todos", obraId: "todas" }), response);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metrics: {
    total: 250, registrosRealizados: 220, pendientes: 60, enRevision: 40, validados: 125,
    correccionesRecibidas: 5, avance: 50, obraPrincipal: "ODATA II",
  } }) }));
  for (const [query] of mockCount.mock.calls) {
    expect(query.take).toBeUndefined();
    expect(query.where.obra_id).toBeUndefined();
    expect(query.where.tipo_registro).toBeUndefined();
  }
  expect(mockRecent.mock.calls[0][0].take).toBe(4);
});

test("sin coincidencias devuelve cero sin división por cero", async () => {
  const response = res();
  await getResumenOperario(req(), response);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    metrics: expect.objectContaining({ total: 0, avance: 0, obraPrincipal: "Sin actividad" }), recientes: [], obras: [],
  }) }));
});

test.each([{ tipoRegistro: "desconocido" }, { obraId: "invalida" }, { obraId: [obraId] }])("rechaza filtros inválidos: %p", async (query) => {
  const response = res();
  await getResumenOperario(req(query), response);
  expect(response.status).toHaveBeenCalledWith(400);
  expect(mockCount).not.toHaveBeenCalled();
});

test.each([[undefined, 401], [{ id: "otro", rol: "cliente" }, 403], [{ id: "otro", rol: "jefeobra" }, 403]])("protege el resumen de otros roles", async (user, status) => {
  const response = res();
  await getResumenOperario({ query: {}, user } as Request, response);
  expect(response.status).toHaveBeenCalledWith(status);
  expect(mockCount).not.toHaveBeenCalled();
});
