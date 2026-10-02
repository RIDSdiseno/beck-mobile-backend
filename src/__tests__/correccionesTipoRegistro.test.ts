import type { Request, Response } from "express";

const mockFindMany = jest.fn();
jest.mock("../config/prisma", () => ({ prisma: {
  controles_inspeccion: { findMany: (...args: unknown[]) => mockFindMany(...args) },
} }));
jest.mock("../services/cloudinary.service", () => ({ withPrivateImageUrl: jest.fn((foto) => foto) }));
jest.mock("../controllers/registros.controller", () => ({ buildCloudinaryFolder: jest.fn() }));
import { getControlesPendientesCorreccion } from "../controllers/jefeobra.controller";

function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}
beforeEach(() => { jest.clearAllMocks(); mockFindMany.mockResolvedValue([]); });

test.each(["jefeobra", "administrador"])("%s puede filtrar controles por el tipo del registro asociado", async (rol) => {
  const res = response();
  await getControlesPendientesCorreccion({
    user: { id: "usuario", rol }, query: { tipoRegistro: "tabiqueria" },
  } as unknown as Request, res);
  expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
    conformidad: "no_conforme", correccion_enviada_at: null,
    registros_terreno: { tipo_registro: "tabiqueria", obras: { estado: { in: ["activa", "pausada"] } } },
  } }));
});

test("el filtro no habilita acceso del operario a los controles", async () => {
  const res = response();
  await getControlesPendientesCorreccion({ user: { id: "1", rol: "terreno" }, query: { tipoRegistro: "tabiqueria" } } as unknown as Request, res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(mockFindMany).not.toHaveBeenCalled();
});
