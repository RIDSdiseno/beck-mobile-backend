import type { Request, Response } from "express";
const mockAsignaciones = jest.fn();
const mockRegistros = jest.fn();
const mockDetalle = jest.fn();
const mockFactores = jest.fn();
jest.mock("../config/prisma", () => ({ prisma: {
  usuarios_obras: { findMany: (...args: unknown[]) => mockAsignaciones(...args) },
  registros_terreno: {
    findMany: (...args: unknown[]) => mockRegistros(...args),
    findFirst: (...args: unknown[]) => mockDetalle(...args),
  },
} }));
jest.mock("../services/calculosRegistroTerreno.service", () => ({
  getFactoresAislacionObra: jest.fn(async () => []),
  getFactoresAccesibilidadObra: (...args: unknown[]) => mockFactores(...args),
}));
jest.mock("../services/cloudinary.service", () => ({ withPrivateImageUrl: jest.fn((foto) => foto) }));
jest.mock("../controllers/ingenieria.controller", () => ({ findRegistroWithDetails: jest.fn() }));
jest.mock("../controllers/registroPdf.controller", () => ({ generateRegistroPdfBuffer: jest.fn() }));
import { getClienteRegistrosObra, getClienteRegistroDetalle } from "../controllers/cliente.controller";

function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}
beforeEach(() => {
  jest.clearAllMocks();
  mockAsignaciones.mockResolvedValue([{ obra_id: "odata" }, { obra_id: "otra" }]);
  mockFactores.mockImplementation(async (id) => [{ nivel: 2, factor: id === "odata" ? 1.25 : 3 }]);
});

test("el listado entrega nombre y factor de la obra una sola vez por lote", async () => {
  mockRegistros.mockResolvedValue([
    { id: "r1", obra_id: "odata", accesibilidad: 2, fotos: [] },
    { id: "r2", obra_id: "odata", accesibilidad: 2, fotos: [] },
  ]);
  const res = response();
  await getClienteRegistrosObra({ user: { id: "cliente", rol: "cliente" }, params: { obraId: "odata" } } as unknown as Request, res);
  expect(mockFactores).toHaveBeenCalledTimes(1);
  expect(mockFactores).toHaveBeenCalledWith("odata");
  expect(res.json).toHaveBeenCalledWith({ success: true, data: [
    expect.objectContaining({ accesibilidad: 2, accesibilidadTexto: "Cielos Americanos o estructurado - Factor 1.25" }),
    expect.objectContaining({ accesibilidad: 2, accesibilidadTexto: "Cielos Americanos o estructurado - Factor 1.25" }),
  ] });
});

test("el detalle del historial usa la configuración de su propia obra", async () => {
  mockDetalle.mockResolvedValue({ id: "r3", obra_id: "otra", accesibilidad: 2, fotos: [] });
  const res = response();
  await getClienteRegistroDetalle({ user: { id: "cliente", rol: "cliente" }, params: { id: "r3" } } as unknown as Request, res);
  expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({
    accesibilidad: 2, accesibilidadTexto: "Cielos Americanos o estructurado - Factor 3.0",
  }) });
});

test("no consulta los factores de obras ajenas al cliente", async () => {
  const res = response();
  await getClienteRegistrosObra({ user: { id: "cliente", rol: "cliente" }, params: { obraId: "ajena" } } as unknown as Request, res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(mockFactores).not.toHaveBeenCalled();
});
