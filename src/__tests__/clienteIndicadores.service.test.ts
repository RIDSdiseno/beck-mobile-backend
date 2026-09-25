const mockGroupBy = jest.fn();
jest.mock("../config/prisma", () => ({
  prisma: { registros_terreno: { groupBy: (...args: unknown[]) => mockGroupBy(...args) } },
}));
import { obtenerSellosClientePorObra } from "../services/clienteIndicadores.service";

beforeEach(() => jest.resetAllMocks());

test("suma cantidad_sellos solo de obras autorizadas y versiones finales aprobadas", async () => {
  mockGroupBy.mockResolvedValue([
    { obra_id: "obra-1", _sum: { cantidad_sellos: 18 } },
    { obra_id: "obra-2", _sum: { cantidad_sellos: null } },
  ]);
  const result = await obtenerSellosClientePorObra(["obra-1", "obra-2"]);
  expect(mockGroupBy).toHaveBeenCalledWith({
    by: ["obra_id"],
    where: {
      obra_id: { in: ["obra-1", "obra-2"] },
      estado: "validado", tipo_registro: "sello_cortafuego", carga_completa: true,
      other_registros_terreno: { none: {} },
    },
    _sum: { cantidad_sellos: true },
  });
  // No filtra por firma del cliente, ni suma cantidades con factores o metros.
  expect(result.get("obra-1")).toBe(18);
  expect(result.get("obra-2")).toBe(0);
});

test("sin obras asignadas no consulta registros", async () => {
  expect(await obtenerSellosClientePorObra([])).toEqual(new Map());
  expect(mockGroupBy).not.toHaveBeenCalled();
});

test("no convierte una falla de consulta en un total cero", async () => {
  mockGroupBy.mockRejectedValue(new Error("Sin conexión"));
  await expect(obtenerSellosClientePorObra(["obra-1"])).rejects.toThrow("Sin conexión");
});
