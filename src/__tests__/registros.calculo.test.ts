import type { Request, Response } from "express";

const mockFindUniqueObra = jest.fn();
const mockCreateRegistro = jest.fn();
const mockCanAccessObra = jest.fn();
const mockCalcularCampos = jest.fn();
const mockFindManyConfiguracion = jest.fn();
const mockTipos = jest.fn();

jest.mock("../config/prisma", () => ({
  prisma: {
    obra_tipos_registro: { findMany: (...args: unknown[]) => mockTipos(...args) },
    obras: {
      findUnique: (...args: unknown[]) => mockFindUniqueObra(...args),
    },
    registros_terreno: {
      create: (...args: unknown[]) => mockCreateRegistro(...args),
    },
    configuracion_campos_registro: {
      findMany: (...args: unknown[]) => mockFindManyConfiguracion(...args),
    },
  },
}));

jest.mock("../services/cloudinary.service", () => ({
  deleteImageFromCloudinary: jest.fn(),
  uploadBufferToCloudinary: jest.fn(),
  withPrivateImageUrl: jest.fn(),
}));

jest.mock("../services/obras.service", () => ({
  canAccessObra: (...args: unknown[]) => mockCanAccessObra(...args),
}));

jest.mock("../services/calculosRegistroTerreno.service", () => ({
  calcularCamposConConfiguracion: (...args: unknown[]) =>
    mockCalcularCampos(...args),
}));

import { calcularCamposRegistroTerreno } from "../utils/calculosRegistroTerreno";
import { createRegistro } from "../controllers/registros.controller";

function buildResponse() {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response;
}

describe("createRegistro usa el cálculo autoritativo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTipos.mockResolvedValue([]);
    mockFindUniqueObra.mockResolvedValue({
      id: "a6048c0c-7641-4ae8-ac05-4a124fc68bc9",
      estado: "activa",
    });
    mockCanAccessObra.mockResolvedValue(true);
    mockFindManyConfiguracion.mockResolvedValue([]);
    mockCalcularCampos.mockResolvedValue({
      factor_por_holguras: 1,
      cantidad_sellos_con_factores: 6,
      aislacion_normalizada: 1.3,
      cantidad_sellos_aislacion: 1.3,
      reparacion_tabique_normalizada: 1,
      cantidad_final: 8.8,
    });
    mockCreateRegistro.mockImplementation(async ({ data }) => ({
      id: "registro-1",
      ...data,
    }));
  });

  it("ignora derivados del cliente y guarda juntos los seis del servidor", async () => {
    const request = {
      user: {
        id: "ef4113f1-4056-4c95-86a2-d32d87aa17d9",
        rol: "terreno",
      },
      body: {
        obraId: "a6048c0c-7641-4ae8-ac05-4a124fc68bc9",
        fecha: "2026-07-30",
        descripcionMaterial: "Tubería metálica",
        itemizadoBeck: "Tubería metálica",
        modulo: "Módulo A",
        recinto: "Sala",
        piso: "1",
        ejeNumerico: "1",
        ejeAlfabetico: "A",
        numeroSello: "S-1",
        cantidadSellos: 3,
        nombreSellador: "Operario",
        holgura: 1.2,
        factorHolguras: 99,
        factor_por_holguras: 99,
        cantidad_sellos_con_factores: 999,
        accesibilidad: 2,
        aislacion: 1,
        cantidad_sellos_aislacion: null,
        reparacionTabique: 1,
        cantidad_final: null,
        tipoRegistro: "sello_cortafuego",
      },
    } as unknown as Request;
    const response = buildResponse();

    await createRegistro(request, response);

    expect(mockCalcularCampos).toHaveBeenCalledWith(
      request.body.obraId,
      expect.objectContaining({
        cantidad_sellos: 3,
        holgura: 4,
        accesibilidad: 2,
        aislacion: true,
        reparacion_tabique: 1,
      })
    );
    expect(mockCreateRegistro).toHaveBeenCalledWith({
      data: expect.objectContaining({
        holgura: 4,
        factor_por_holguras: 1,
        cantidad_sellos_con_factores: 6,
        aislacion: 1.3,
        cantidad_sellos_aislacion: 1.3,
        reparacion_tabique: 1,
        cantidad_final: 8.8,
        carga_completa: false,
      }),
    });
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it("usa valores neutros al crear cuando la obra oculta campos configurables", async () => {
    mockFindManyConfiguracion.mockResolvedValue([
      { campo: "recinto", visible: false },
      { campo: "modulo", visible: false },
      { campo: "eje_numerico", visible: false },
      { campo: "eje_alfabetico", visible: false },
      { campo: "holgura", visible: false },
      { campo: "accesibilidad", visible: false },
      { campo: "aislacion", visible: false },
      { campo: "reparacion_tabique", visible: false },
    ]);
    const request = {
      user: { id: "usuario-1", rol: "terreno" },
      body: {
        obraId: "a6048c0c-7641-4ae8-ac05-4a124fc68bc9",
        fecha: "2026-07-30",
        descripcionMaterial: "Tubería metálica",
        piso: "1",
        numeroSello: "S-2",
        cantidadSellos: 2,
        nombreSellador: "Operario",
        recinto: "valor de app antigua",
        modulo: "valor de app antigua",
        ejeNumerico: "99",
        ejeAlfabetico: "Z",
        holgura: 9,
        accesibilidad: 9,
        aislacion: 9,
        reparacionTabique: 9,
      },
    } as unknown as Request;
    const response = buildResponse();

    await createRegistro(request, response);

    expect(mockCalcularCampos).toHaveBeenCalledWith(
      request.body.obraId,
      expect.objectContaining({
        holgura: 0,
        accesibilidad: 0,
        aislacion: null,
        reparacion_tabique: null,
      }),
    );
    expect(mockCreateRegistro).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recinto: null,
        modulo: "No aplica",
        eje_numerico: "No aplica",
        eje_alfabetico: "N/A",
      }),
    });
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it("rechaza reparación de tabique distinta de 0 o 1", async () => {
    const request = {
      user: { id: "usuario-1", rol: "terreno" },
      body: {
        obraId: "a6048c0c-7641-4ae8-ac05-4a124fc68bc9",
        fecha: "2026-07-30",
        descripcionMaterial: "Tubería metálica",
        itemizadoBeck: "Tubería metálica",
        modulo: "Módulo A",
        recinto: "Sala",
        piso: "1",
        ejeNumerico: "1",
        ejeAlfabetico: "A",
        numeroSello: "S-3",
        cantidadSellos: 1,
        nombreSellador: "Operario",
        holgura: 2,
        accesibilidad: 1,
        aislacion: 0,
        reparacionTabique: 9,
        tipoRegistro: "sello_cortafuego",
      },
    } as unknown as Request;
    const response = buildResponse();

    await createRegistro(request, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining("reparacionTabique debe ser 0"),
      }),
    );
    expect(mockCalcularCampos).not.toHaveBeenCalled();
    expect(mockCreateRegistro).not.toHaveBeenCalled();
  });
  const nuevo = (tipo: string) => ({
    user: { id: "usuario-1", rol: "terreno" },
    body: { obraId: "a6048c0c-7641-4ae8-ac05-4a124fc68bc9", fecha: "2026-09-30",
      descripcionMaterial: tipo, itemizadoBeck: tipo, numeroSello: "J-1",
      modulo: "A", recinto: "Sala", piso: "1", ejeNumerico: "1", ejeAlfabetico: "A",
      nombreSellador: "Operario", tipoRegistro: tipo, cantidadSellos: 3, metrosLineales: 1.5,
      holgura: 4, accesibilidad: 2, aislacion: 1, reparacionTabique: 1,
      cantidad_final: 9999, cantidad_sellos_aislacion: null,
    },
  } as unknown as Request);

  it.each(["junta_lineal_espuma", "tabiqueria"])("crea %s con seis derivados, foto pendiente y aislación conservada", async (tipo) => {
    mockCalcularCampos.mockImplementation(async (_obra, input) => calcularCamposRegistroTerreno(input));
    const req = nuevo(tipo);
    const res = buildResponse();
    await createRegistro(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    const data = mockCreateRegistro.mock.calls[0][0].data;
    expect(data.tipo_registro).toBe(tipo);
    expect(data.numero_sello).toBe("J-1");
    expect(data.itemizado_beck).toBe(tipo);
    expect(data.carga_completa).toBe(false);
    expect(data.cantidad_sellos).toBe(tipo === "tabiqueria" ? 3 : 0);
    expect(data.metros_lineales).toBe(tipo === "tabiqueria" ? null : 1.5);
    expect(data.aislacion).toBe(1.3);
    expect(data.cantidad_sellos_aislacion).toBe(1.3);
    expect(data.cantidad_final).toBeCloseTo(tipo === "tabiqueria" ? 8.2 : 7);
  });

  it("tabiquería rechaza cantidades fraccionarias", async () => {
    const req = nuevo("tabiqueria"); req.body.cantidadSellos = 1.5;
    const res = buildResponse(); await createRegistro(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCreateRegistro).not.toHaveBeenCalled();
  });

  it("no permite crear un tipo deshabilitado para la obra", async () => {
    mockTipos.mockResolvedValue([{ tipo_registro: "sello_cortafuego" }]);
    const res = buildResponse(); await createRegistro(nuevo("tabiqueria"), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCalcularCampos).not.toHaveBeenCalled();
    expect(mockCreateRegistro).not.toHaveBeenCalled();
  });

});
