import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import {
  getAdminAvance,
  getAdminAvanceObras,
} from "../controllers/adminAvance.controller";

jest.mock("../config/prisma", () => ({
  prisma: {
    obras: { findMany: jest.fn(), findUnique: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));
const obra = {
  id: "00000000-0000-0000-0000-000000000001",
  nombre: "Obra prueba",
  codigo: "P1",
  estado: "activa",
};
const usuario = { id: "admin", rol: "administrador", empresa: "beck" };
const response = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response;
};
beforeEach(() => {
  jest.clearAllMocks();
  (prisma.obras.findUnique as jest.Mock).mockResolvedValue(obra);
  (prisma.obras.findMany as jest.Mock).mockResolvedValue([obra]);
  (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ data: { sellos: 15 } }]);
});
test.each([
  undefined,
  { ...usuario, rol: "terreno" },
  { ...usuario, rol: "jefeobra" },
  { ...usuario, rol: "ingenieria" },
  { ...usuario, rol: "cliente" },
  { ...usuario, empresa: "firemat" },
])("restringe métricas y opciones al administrador BECK: %j", async (user) => {
  for (const handler of [getAdminAvance, getAdminAvanceObras]) {
    const res = response();
    await handler(
      { user, query: { obraId: obra.id } } as unknown as Request,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(user ? 403 : 401);
  }
  expect(prisma.$queryRaw).not.toHaveBeenCalled();
  expect(prisma.obras.findMany).not.toHaveBeenCalled();
});
test.each([
  {},
  { obraId: "invalido" },
  { obraId: obra.id, periodo: "otro" },
  { obraId: [obra.id] },
  { obraId: obra.id, periodo: ["mes"] },
])("valida parámetros antes de consultar: %j", async (query) => {
  const res = response();
  await getAdminAvance({ user: usuario, query } as unknown as Request, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(prisma.$queryRaw).not.toHaveBeenCalled();
});
test("obra inexistente no muestra ceros como si fuera válida", async () => {
  (prisma.obras.findUnique as jest.Mock).mockResolvedValue(null);
  const res = response();
  await getAdminAvance(
    { user: usuario, query: { obraId: obra.id } } as unknown as Request,
    res,
  );
  expect(res.status).toHaveBeenCalledWith(404);
  expect(prisma.$queryRaw).not.toHaveBeenCalled();
});
test("devuelve resumen y obra, manteniendo consultas parametrizadas", async () => {
  const res = response();
  await getAdminAvance(
    {
      user: usuario,
      query: { obraId: obra.id, periodo: "mes" },
    } as unknown as Request,
    res,
  );
  expect(res.json).toHaveBeenCalledWith({
    success: true,
    data: { sellos: 15, obra },
  });
  const query = (prisma.$queryRaw as jest.Mock).mock.calls[0][0];
  expect(query.values).toContain(obra.id);
  expect(query.text).not.toContain(obra.id);
});
test("lista obras históricas y activas solo con datos necesarios para el filtro", async () => {
  const res = response();
  await getAdminAvanceObras({ user: usuario } as Request, res);
  expect(prisma.obras.findMany).toHaveBeenCalledWith({
    select: { id: true, nombre: true, codigo: true, estado: true },
    orderBy: [{ nombre: "asc" }, { id: "asc" }],
  });
  expect(res.json).toHaveBeenCalledWith({ success: true, data: [obra] });
});
