import request from "supertest";
import express from "express";

const mockTx = {
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  obras: { findFirst: jest.fn() },
  usuarios: { findFirst: jest.fn() },
  usuarios_obras: { upsert: jest.fn() },
  asignaciones_inventario_beck: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  trazabilidad_inventario_beck: { create: jest.fn(), findMany: jest.fn() },
  inventario_beck_herramientas: { update: jest.fn() },
  inventario_beck_epp: { update: jest.fn(), findUniqueOrThrow: jest.fn() },
};
const mockTransaction = jest.fn((fn: (tx: typeof mockTx) => unknown) =>
  fn(mockTx),
);
let mockUser = {
  id: "10000000-0000-4000-8000-000000000001",
  nombre: "Bodega",
  email: "bodega@firemat.cl",
  rol: "bodeguero",
  empresa: "firemat",
};
jest.mock("../config/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockTx.$queryRaw(...args),
    $transaction: (...args: unknown[]) =>
      mockTransaction(...(args as [(tx: typeof mockTx) => unknown])),
  },
}));
jest.mock("../middlewares/auth.middleware", () => ({
  verifyAppToken: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.user = mockUser as typeof req.user;
    next();
  },
}));
import router from "../routes/bodegaBeck.routes";
import {
  ajustarStock,
  asignarDesdeBodega,
  enteroBodega,
  etiquetasBodega,
  guardarArticulo,
  recibirBodega,
  tipoBodega,
  uuidBodega,
} from "../services/bodegaBeck.service";
import { devolverInventarioABodega } from "../services/inventarioBeck.service";

const app = express();
app.use(express.json());
app.use(router);
const id = "20000000-0000-4000-8000-000000000002";
const operation = "30000000-0000-4000-8000-000000000003";
const asignacion = {
  id,
  obra_id: id,
  jefe_obra_id: id,
  asignado_por_id: id,
  tipo_item: "epp",
  epp_id: id,
  implemento_id: null,
  herramienta_id: null,
  cantidad: 2,
  sub_skus: ["900001-1", "900001-2"],
  estado: "asignado",
  trabajador_id: null,
  devolucion_solicitada_at: new Date(),
  devolucion_recibida_at: null,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = {
    id,
    nombre: "Bodega",
    email: "bodega@firemat.cl",
    rol: "bodeguero",
    empresa: "firemat",
  };
  mockTx.$queryRaw.mockImplementation(
    (q: { strings?: string[]; sql?: string } | TemplateStringsArray) => {
      const sql = Array.isArray(q)
        ? q.join("")
        : (q as { sql?: string }).sql || "";
      if (sql.includes("SELECT *,"))
        return [
          {
            id,
            nombre: "Casco",
            sku: "900001",
            activo: true,
            saldo: 10,
            unidades_generadas: 2,
          },
        ];
      return [];
    },
  );
  mockTx.$executeRaw.mockResolvedValue(1);
  mockTx.obras.findFirst.mockResolvedValue({ id });
  mockTx.usuarios.findFirst.mockResolvedValue({ id, nombre: "Supervisor" });
  mockTx.asignaciones_inventario_beck.findFirst.mockResolvedValue(null);
  mockTx.asignaciones_inventario_beck.findUnique.mockResolvedValue(asignacion);
  mockTx.asignaciones_inventario_beck.findMany.mockResolvedValue([asignacion]);
  mockTx.asignaciones_inventario_beck.create.mockResolvedValue({ id });
  mockTx.asignaciones_inventario_beck.updateMany.mockResolvedValue({
    count: 1,
  });
  mockTx.trazabilidad_inventario_beck.findMany.mockResolvedValue([]);
});

describe("acceso exclusivo a bodega BECK", () => {
  test("permite al bodeguero Firemat sin cambiar de identidad", async () => {
    expect((await request(app).get("/acceso")).status).toBe(200);
  });
  test.each([
    "vendedor_firemat",
    "visualizador_firemat",
    "jefeobra",
    "terreno",
    "administrador",
    "ingenieria",
  ])("deniega %s", async (rol) => {
    mockUser.rol = rol;
    expect((await request(app).post("/asignaciones").send({})).status).toBe(
      403,
    );
    expect(mockTransaction).not.toHaveBeenCalled();
  });
  test("no acepta otro dominio ni empresa", async () => {
    mockUser.email = "bodega@becksoluciones.cl";
    expect((await request(app).get("/acceso")).status).toBe(403);
    mockUser.email = "bodega@firemat.cl";
    mockUser.empresa = "beck";
    expect((await request(app).get("/acceso")).status).toBe(403);
  });
});

describe("stock, entregas y devoluciones", () => {
  test("valida tipos, UUID y cantidades sin aceptar booleanos o fracciones", () => {
    for (const n of [null, "", " ", [], {}, true, 1.5, -1, Infinity])
      expect(() => enteroBodega(n)).toThrow();
    expect(enteroBodega("12")).toBe(12);
    expect(() => tipoBodega("usuarios")).toThrow();
    expect(() => uuidBodega("no-id")).toThrow();
  });
  test("una entrada suma al stock, no lo reemplaza", async () => {
    expect(
      await ajustarStock(id, "epp", id, {
        cantidad: 3,
        motivo: "Recepción",
        requestId: operation,
      }),
    ).toEqual({ id, stockAnterior: 10, stockActual: 13 });
    expect(mockTx.$executeRaw.mock.calls[0][0].sql).toContain("saldo=saldo+");
  });
  test("rechaza salidas superiores al stock", async () => {
    await expect(
      ajustarStock(id, "epp", id, {
        cantidad: -11,
        motivo: "Baja",
        requestId: operation,
      }),
    ).rejects.toThrow("Stock insuficiente");
    expect(mockTx.$executeRaw).not.toHaveBeenCalled();
  });
  test("reintentar la misma operación devuelve su resultado sin otra escritura", async () => {
    const payload = { tipo: "epp", id, delta: 3, motivo: "Recepción" };
    mockTx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          usuario_id: id,
          datos: {
            accion: "STOCK_AJUSTADO",
            payload,
            resultado: { stockActual: 13 },
          },
        },
      ]);
    expect(
      await ajustarStock(id, "epp", id, {
        cantidad: 3,
        motivo: "Recepción",
        requestId: operation,
      }),
    ).toEqual({ stockActual: 13 });
    expect(mockTx.$executeRaw).not.toHaveBeenCalled();
  });
  test("rechaza reutilizar una clave con diferente cantidad", async () => {
    mockTx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          usuario_id: id,
          datos: { accion: "STOCK_AJUSTADO", payload: {}, resultado: {} },
        },
      ]);
    await expect(
      ajustarStock(id, "epp", id, {
        cantidad: 3,
        motivo: "Recepción",
        requestId: operation,
      }),
    ).rejects.toThrow("otros datos");
  });
  test("no duplica una herramienta ya asignada", async () => {
    mockTx.asignaciones_inventario_beck.findFirst.mockResolvedValue({ id });
    await expect(
      asignarDesdeBodega(id, {
        obraId: id,
        supervisorId: id,
        requestId: operation,
        lineas: [{ tipoItem: "herramienta", itemId: id, cantidad: 1 }],
      }),
    ).rejects.toThrow("ya está asignada");
    expect(mockTx.asignaciones_inventario_beck.create).not.toHaveBeenCalled();
  });
  test("la entrega registra bodeguero, supervisor y códigos unitarios", async () => {
    await asignarDesdeBodega(id, {
      obraId: id,
      supervisorId: id,
      requestId: operation,
      lineas: [{ tipoItem: "epp", itemId: id, cantidad: 2 }],
    });
    expect(mockTx.asignaciones_inventario_beck.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        asignado_por_id: id,
        jefe_obra_id: id,
        sub_skus: ["900001-3", "900001-4"],
      }),
    });
    expect(mockTx.trazabilidad_inventario_beck.create).toHaveBeenCalled();
  });
  test("solicitar devolución no repone stock ni marca devuelto", async () => {
    await devolverInventarioABodega({
      supervisorId: id,
      obraId: id,
      tipoItem: "epp",
      itemId: id,
      cantidad: 2,
    });
    const data =
      mockTx.asignaciones_inventario_beck.updateMany.mock.calls[0][0].data;
    expect(data.devolucion_solicitada_por_id).toBe(id);
    expect(data.estado).toBeUndefined();
    expect(mockTx.inventario_beck_epp.update).not.toHaveBeenCalled();
    expect(
      mockTx.trazabilidad_inventario_beck.create.mock.calls[0][0].data.accion,
    ).toBe("DEVOLUCION_SOLICITADA_BODEGA");
  });
  test("solo recibir físicamente reintegra el stock", async () => {
    await recibirBodega(id, id, operation);
    expect(
      mockTx.asignaciones_inventario_beck.update.mock.calls[0][0].data.estado,
    ).toBe("devuelto");
    expect(mockTx.$executeRaw.mock.calls[0][0].sql).toContain("saldo=saldo+");
  });
  test("el supervisor no puede reenviar como disponible lo que espera recepción de bodega", async () => {
    await devolverInventarioABodega({
      supervisorId: id,
      obraId: id,
      tipoItem: "epp",
      itemId: id,
      cantidad: 2,
    });
    expect(mockTx.asignaciones_inventario_beck.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { devolucion_solicitada_at: null },
            { devolucion_recibida_at: { not: null } },
          ],
        }),
      }),
    );
  });
  test("una devolución parcial reserva solo sus unidades y conserva el resto", async () => {
    await devolverInventarioABodega({
      supervisorId: id,
      obraId: id,
      tipoItem: "epp",
      itemId: id,
      cantidad: 1,
      requestId: operation,
    });
    expect(mockTx.asignaciones_inventario_beck.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { cantidad: { decrement: 1 }, sub_skus: ["900001-2"] },
      }),
    );
    expect(mockTx.asignaciones_inventario_beck.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cantidad: 1,
        estado: "asignado",
        sub_skus: ["900001-1"],
        devolucion_solicitada_por_id: id,
      }),
    });
    expect(mockTx.inventario_beck_epp.update).not.toHaveBeenCalled();
  });
  test("reintentar la solicitud del supervisor no vuelve a separar unidades", async () => {
    mockTx.trazabilidad_inventario_beck.findMany.mockResolvedValue([
      {
        asignacion_id: id,
        datos: {
          obraId: id,
          tipoItem: "epp",
          itemId: id,
          cantidad: 1,
          motivo: null,
        },
      },
    ]);
    expect(
      await devolverInventarioABodega({
        supervisorId: id,
        obraId: id,
        tipoItem: "epp",
        itemId: id,
        cantidad: 1,
        requestId: operation,
      }),
    ).toEqual({ ids: [id], cantidad: 1, pendienteRecepcionBodega: true });
    expect(
      mockTx.asignaciones_inventario_beck.updateMany,
    ).not.toHaveBeenCalled();
    expect(mockTx.asignaciones_inventario_beck.create).not.toHaveBeenCalled();
  });
  test("recibir la misma operación dos veces no aumenta de nuevo el stock", async () => {
    mockTx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          usuario_id: id,
          datos: {
            accion: "DEVOLUCION_RECIBIDA_BODEGA",
            payload: { id },
            resultado: { id, cantidad: 2 },
          },
        },
      ]);
    expect(await recibirBodega(id, id, operation)).toEqual({ id, cantidad: 2 });
    expect(mockTx.asignaciones_inventario_beck.update).not.toHaveBeenCalled();
    expect(mockTx.$executeRaw).not.toHaveBeenCalled();
  });
  test("editar datos descriptivos no puede reemplazar el stock ni los códigos", async () => {
    await guardarArticulo(id, "epp", id, {
      nombre: "Casco",
      saldo: 500,
      salida: 0,
      sku: "alterado",
      stock: 999,
      requestId: operation,
    });
    const sql = mockTx.$executeRaw.mock.calls[0][0];
    expect(sql.sql).not.toMatch(/saldo|salida|sku|stock/);
    expect(sql.values).not.toContain("alterado");
  });
  test("no se desactiva un artículo con asignaciones vigentes", async () => {
    mockTx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id }])
      .mockResolvedValueOnce([{ id }]);
    await expect(
      guardarArticulo(id, "epp", id, {
        nombre: "Casco",
        activo: false,
        requestId: operation,
      }),
    ).rejects.toThrow("asignaciones activas");
    expect(mockTx.$executeRaw).not.toHaveBeenCalled();
  });
  test("rechaza fechas imposibles antes de abrir una transacción", async () => {
    await expect(
      guardarArticulo(id, "herramienta", id, {
        nombre: "Sierra",
        fecha_compra: "2026-02-30",
        requestId: operation,
      }),
    ).rejects.toThrow("fecha");
    expect(mockTransaction).not.toHaveBeenCalled();
  });
  test("genera un PDF real con el código de barras, sin modificar inventario", async () => {
    mockTx.$queryRaw.mockResolvedValueOnce([
      { nombre: "Casco", sku: "900001" },
    ]);
    const pdf = await etiquetasBodega({ tipo: "epp", id });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
  test.each([
    { ...asignacion, estado: "devuelto" },
    { ...asignacion, trabajador_id: id },
    { ...asignacion, devolucion_solicitada_at: null },
  ])(
    "no recibe devoluciones duplicadas, de operario o no solicitadas",
    async (value) => {
      mockTx.asignaciones_inventario_beck.findUnique.mockResolvedValue(value);
      await expect(recibirBodega(id, id, operation)).rejects.toThrow(
        "no tiene una devolución pendiente",
      );
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    },
  );
});
