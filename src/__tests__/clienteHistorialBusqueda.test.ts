import type { Request, Response } from "express";
import { filtroBusquedaHistorialCliente } from "../utils/clienteHistorialBusqueda";

const mockAsignaciones = jest.fn();
const mockRegistros = jest.fn();
const mockCount = jest.fn();
const mockTransaction = jest.fn();
jest.mock("../config/prisma", () => ({ prisma: {
  usuarios_obras: { findMany: (...args: unknown[]) => mockAsignaciones(...args) },
  registros_terreno: {
    findMany: (...args: unknown[]) => mockRegistros(...args),
    count: (...args: unknown[]) => mockCount(...args),
  },
  $transaction: (...args: unknown[]) => mockTransaction(...args),
} }));
jest.mock("../services/calculosRegistroTerreno.service", () => ({
  getFactoresAislacionObra: jest.fn(async () => []),
  getFactoresAccesibilidadObra: jest.fn(async () => []),
}));
jest.mock("../services/cloudinary.service", () => ({ withPrivateImageUrl: jest.fn((foto) => foto) }));
jest.mock("../controllers/ingenieria.controller", () => ({ findRegistroWithDetails: jest.fn() }));
jest.mock("../controllers/registroPdf.controller", () => ({ generateRegistroPdfBuffer: jest.fn() }));
import { getClienteHistorial } from "../controllers/cliente.controller";

function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockAsignaciones.mockResolvedValue([{ obra_id: "odata" }, { obra_id: "otra" }]);
  mockRegistros.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
  mockTransaction.mockImplementation((queries) => Promise.all(queries));
});

test("sin texto no restringe el historial", () => {
  expect(filtroBusquedaHistorialCliente("   ")).toEqual({});
});

test("busca solamente sello, piso, recinto, ambos ejes y material", () => {
  const filtro = filtroBusquedaHistorialCliente("  dato  ");
  const coincidencia = (columna: string) => ({ OR: [{
    [columna]: { contains: "dato", mode: "insensitive" },
  }] });
  expect(filtro.OR).toEqual([
    coincidencia("numero_sello"),
    ...[
      ["piso", "piso"], ["recinto", "recinto"],
      ["eje_numerico", "eje_numerico"], ["eje_alfabetico", "eje_alfabetico"],
      ["descripcion_material", "itemizadoBeck"],
    ].map(([columna, campo]) => ({ AND: [
      coincidencia(columna),
      { obras: { configuracion_campos_registro: {
        none: { rol: "cliente", campo, visible: false },
      } } },
    ] })),
  ]);
  for (const excluded of ["nombre_sellador", "folio", "codigo", "nombre"]) {
    expect(JSON.stringify(filtro)).not.toContain(`"${excluded}":`);
  }
});

test.each([
  ["SELLO 0002", "numero_sello", "0002"],
  ["Piso -1", "piso", "-1"],
])("acepta el alias %s sin perder ceros o signos", (query, campo, value) => {
  expect(JSON.stringify(filtroBusquedaHistorialCliente(query))).toContain(
    JSON.stringify({ [campo]: { contains: value, mode: "insensitive" } }),
  );
});

test("aplica búsqueda, fecha y obras permitidas a los datos y al total antes de paginar", async () => {
  mockRegistros.mockResolvedValueOnce([
    { id: "r1", obra_id: "odata" }, { id: "r2", obra_id: "odata" },
  ]).mockResolvedValueOnce([{ obra_id: "odata", obras: { nombre: "ODATA" } }]);
  mockCount.mockResolvedValue(150);
  const res = response();
  await getClienteHistorial({
    user: { id: "cliente", rol: "cliente" },
    query: { paginated: "true", search: "Recinto norte", obraId: "odata", fecha: "2026-09-25", limit: "1", cursor: "anterior" },
  } as unknown as Request, res);

  const query = mockRegistros.mock.calls[0][0];
  expect(query.where).toEqual({
    obra_id: { in: ["odata", "otra"], equals: "odata" },
    estado: "validado", validado_cliente: true,
    fecha: new Date("2026-09-25T00:00:00.000Z"),
    ...filtroBusquedaHistorialCliente("Recinto norte"),
  });
  expect(query).toMatchObject({ take: 2, cursor: { id: "anterior" }, skip: 1 });
  expect(mockCount).toHaveBeenCalledWith({ where: query.where });
  expect(res.json).toHaveBeenCalledWith({ success: true, data: {
    items: [expect.objectContaining({ id: "r1" })], total: 150, nextCursor: "r1",
    obras: [{ id: "odata", nombre: "ODATA" }],
  } });
});

test("no permite buscar en una obra ajena aunque se solicite en el filtro", async () => {
  await getClienteHistorial({
    user: { id: "cliente", rol: "cliente" },
    query: { paginated: "true", obraId: "ajena", search: "dato" },
  } as unknown as Request, response());
  expect(mockRegistros.mock.calls[0][0].where.obra_id).toEqual({
    in: ["odata", "otra"], equals: "ajena",
  });
});

test("la ruta sin paginación conserva el mismo criterio de búsqueda", async () => {
  await getClienteHistorial({
    user: { id: "cliente", rol: "cliente" }, query: { search: "material" },
  } as unknown as Request, response());
  expect(mockRegistros.mock.calls[0][0].where.OR).toEqual(filtroBusquedaHistorialCliente("material").OR);
});

test("no consulta registros si el usuario no tiene permiso para la vista cliente", async () => {
  const res = response();
  await getClienteHistorial({
    user: { id: "operario", rol: "terreno" }, query: { search: "dato" },
  } as unknown as Request, res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(mockRegistros).not.toHaveBeenCalled();
});

test("el historial paginado entrega los campos de la tarjeta sin cargar fotos ni detalles completos", async () => {
  mockRegistros.mockResolvedValueOnce([{
    id: "r1", obra_id: "odata", tipo_registro: "sello_cortafuego",
    recinto: "Sala técnica", eje_numerico: "2-3", eje_alfabetico: "A-B",
    descripcion_material: "Sello de lana mineral", cantidad_sellos: 3, metros_lineales: null,
  }, {
    id: "r2", obra_id: "odata", tipo_registro: "junta_lineal_espuma",
    cantidad_sellos: 0, metros_lineales: "2.5",
  }]);
  const res = response();
  await getClienteHistorial({
    user: { id: "cliente", rol: "cliente" }, query: { paginated: "true" },
  } as unknown as Request, res);
  const select = mockRegistros.mock.calls[0][0].select;
  expect(select).toMatchObject({
    recinto: true, eje_numerico: true, eje_alfabetico: true,
    descripcion_material: true, cantidad_sellos: true, metros_lineales: true,
  });
  expect(select.fotos).toBeUndefined();
  expect(select.observaciones).toBeUndefined();
  expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({
    items: [expect.objectContaining({
      recinto: "Sala técnica", ejeNumerico: "2-3", ejeAlfabetico: "A-B",
      descripcionMaterial: "Sello de lana mineral", cantidadSellos: 3, metrosLineales: null,
    }), expect.objectContaining({ tipoRegistro: "junta_lineal_espuma", metrosLineales: 2.5 })],
  }) });
});
