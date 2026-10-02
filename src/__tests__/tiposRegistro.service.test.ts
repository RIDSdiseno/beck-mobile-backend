const mockFind = jest.fn();
jest.mock("../config/prisma", () => ({ prisma: {
  obra_tipos_registro: { findMany: (...args: unknown[]) => mockFind(...args) },
} }));
import { getTiposRegistroPermitidos, TIPOS_REGISTRO_MOVIL } from "../services/tiposRegistro.service";

test("sin configuración mantiene los tipos soportados, igual que CRM", async () => {
  mockFind.mockResolvedValue([]);
  expect(await getTiposRegistroPermitidos("obra-a")).toEqual(TIPOS_REGISTRO_MOVIL);
  expect(mockFind).toHaveBeenCalledWith({ where: { obra_id: "obra-a", activo: true }, select: { tipo_registro: true } });
});
test("solo ofrece los tipos activos configurados para la obra", async () => {
  mockFind.mockResolvedValue([{ tipo_registro: "tabiqueria" }]);
  expect(await getTiposRegistroPermitidos("obra-b")).toEqual(["tabiqueria"]);
});
test("no habilita Sellos si solo hay un tipo no soportado configurado", async () => {
  mockFind.mockResolvedValue([{ tipo_registro: "otros" }]);
  expect(await getTiposRegistroPermitidos("obra-c")).toEqual([]);
});
