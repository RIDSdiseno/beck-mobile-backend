const mockDeleteMany = jest.fn();

jest.mock("../config/prisma", () => ({
  prisma: {
    registros_terreno: {
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    },
  },
}));

import {
  eliminarRegistroIncompleto,
  limpiarRegistrosIncompletosAbandonados,
} from "../services/registrosIncompletos.service";

describe("limpieza de registros incompletos", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("solo elimina por id cuando la carga sigue incompleta", async () => {
    mockDeleteMany.mockResolvedValue({ count: 1 });

    await expect(
      eliminarRegistroIncompleto("registro-1", "usuario-1"),
    ).resolves.toBe(true);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: {
        id: "registro-1",
        usuario_id: "usuario-1",
        carga_completa: false,
      },
    });
  });

  it("elimina borradores incompletos con más de una hora", async () => {
    mockDeleteMany.mockResolvedValue({ count: 0 });
    const ahora = new Date("2026-07-30T20:00:00.000Z");

    await expect(
      limpiarRegistrosIncompletosAbandonados(ahora),
    ).resolves.toBe(0);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: {
        carga_completa: false,
        created_at: {
          lt: new Date("2026-07-30T19:00:00.000Z"),
        },
      },
    });
  });
});
