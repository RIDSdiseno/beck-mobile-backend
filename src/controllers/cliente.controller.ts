import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import {
  deleteRawFromCloudinary,
  getPrivateDownloadUrl,
  uploadRawBufferToCloudinary,
  withPrivateImageUrl,
} from "../services/cloudinary.service";
import { findRegistroWithDetails } from "./ingenieria.controller";
import { generateRegistroPdfBuffer } from "./registroPdf.controller";
import { obtenerConfiguracionRegistro } from "../services/configuracionCamposRegistro.service";
import { getFactoresAislacionObra } from "../services/calculosRegistroTerreno.service";
import {
  type FactorAislacionEstado,
  resolveEstadoAislacionDesdeFactor,
} from "../utils/calculosRegistroTerreno";

function requireCliente(req: Request, res: Response) {
  const userId   = req.user?.id;
  const userRole = req.user?.rol;

  if (!userId || !userRole) {
    res.status(401).json({ success: false, error: "Usuario no autenticado" });
    return null;
  }

  if (userRole !== "cliente" && userRole !== "administrador") {
    res.status(403).json({ success: false, error: "No tienes permisos para acceder a la vista cliente" });
    return null;
  }

  return { userId, userRole };
}

async function getObraIdsCliente(userId: string, userRole: string) {
  if (userRole === "administrador") {
    const obras = await prisma.obras.findMany({
      select: { id: true },
      orderBy: { nombre: "asc" },
    });
    return obras.map((obra) => obra.id);
  }

  const asignaciones = await prisma.usuarios_obras.findMany({
    where: { usuario_id: userId },
    select: { obra_id: true },
    orderBy: { asignado_en: "desc" },
  });

  return asignaciones.map((a) => a.obra_id);
}

function normalizeFotos(registro: {
  id: string;
  foto_url?: string | null;
  fotos_urls?: string[] | null;
  fotos?: {
    id: string;
    url: string;
    public_id: string;
    formato?: string | null;
    created_at: Date;
    nombre_archivo?: string | null;
  }[];
}) {
  const seen = new Set<string>();
  const relationFotos = registro.fotos || [];
  const legacyFotos = relationFotos.length
    ? []
    : [
        ...(Array.isArray(registro.fotos_urls) ? registro.fotos_urls : []).map(
          (url, index) => ({
            id: `${registro.id}-url-${index}`,
            url,
            nombre: null,
            created_at: new Date(0),
          }),
        ),
        ...(registro.foto_url
          ? [
              {
                id: `${registro.id}-foto-url`,
                url: registro.foto_url,
                nombre: null,
                created_at: new Date(0),
              },
            ]
          : []),
      ];

  return [
    ...relationFotos.map((foto) => ({
      id: foto.id,
      url: withPrivateImageUrl(foto).url,
      nombre: foto.nombre_archivo || null,
      created_at: foto.created_at,
    })),
    ...legacyFotos,
  ].filter((foto) => {
    if (!foto.url || seen.has(foto.url)) return false;
    seen.add(foto.url);
    return true;
  });
}

function normalizeRegistroCliente(
  registro: any,
  factoresAislacion?: FactorAislacionEstado[],
) {
  const ejeParts = [registro.eje_alfabetico, registro.eje_numerico]
    .filter(Boolean)
    .map((v: any) => String(v).trim());

  return {
    id:                        registro.id,
    fecha:                     registro.fecha,
    diaSemana:                 registro.dia_semana,
    tipoRegistro:              registro.tipo_registro,
    piso:                      registro.piso,
    modulo:                    registro.modulo,
    recinto:                   registro.recinto,
    eje:                       ejeParts.join(" / "),
    ejeAlfabetico:             registro.eje_alfabetico,
    ejeNumerico:               registro.eje_numerico,
    numeroSello:               registro.numero_sello,
    cantidad:                  registro.cantidad_sellos,
    cantidadSellos:            registro.cantidad_sellos,
    cantidadFinal:             registro.cantidad_final ? Number(registro.cantidad_final) : null,
    material:                  registro.descripcion_material,
    descripcionMaterial:       registro.descripcion_material,
    codigoBeck:                registro.codigo_beck,
    sellador:                  registro.nombre_sellador,
    nombreSellador:            registro.nombre_sellador,
    itemizadoBeck:             registro.itemizado_beck,
    dimensiones:               registro.dimensiones,
    itemizadoMandante:         registro.itemizado_mandante,
    holgura:                   registro.holgura              ? Number(registro.holgura)               : null,
    factorPorHolguras:         registro.factor_por_holguras  ? Number(registro.factor_por_holguras)   : null,
    accesibilidad:             registro.accesibilidad,
    cantidadSellosConFactores: registro.cantidad_sellos_con_factores ? Number(registro.cantidad_sellos_con_factores) : null,
    aislacion:                 registro.aislacion             ? Number(registro.aislacion)             : null,
    aislacionAplica:           resolveEstadoAislacionDesdeFactor(
      registro.aislacion,
      factoresAislacion,
    ),
    cantidadSellosAislacion:   registro.cantidad_sellos_aislacion    ? Number(registro.cantidad_sellos_aislacion)    : null,
    reparacionTabique:         registro.reparacion_tabique != null ? Number(registro.reparacion_tabique) : null,
    folio:                     registro.folio,
    metrosLineales:            registro.metros_lineales != null ? Number(registro.metros_lineales) : null,
    observaciones:             registro.observaciones,
    estado:                    registro.estado,
    createdAt:                 registro.created_at,
    updatedAt:                 registro.updated_at,
    fotosUrls:                 Array.isArray(registro.fotos_urls) ? registro.fotos_urls : [],
    fotoUrl:                   registro.foto_url,
    fotos:                     normalizeFotos(registro),
    fotos_registro:            normalizeFotos(registro),
    // Campos cliente
    validadoCliente:           registro.validado_cliente ?? false,
    validadoClienteAt:         registro.validado_cliente_at  ?? null,
    firmaClienteUrl:           registro.firma_cliente_url    ?? null,
    pdfDisponible:             Boolean(registro.pdf_firmado_url),
    // Info de obra (disponible en historial)
    obraNombre:                registro.obras?.nombre  ?? null,
    obraCodigo:                registro.obras?.codigo  ?? null,
    obraId:                    registro.obra_id,
  };
}

async function normalizeRegistrosCliente(registros: any[]) {
  const obraIds = [...new Set(registros.map((registro) => registro.obra_id).filter(Boolean))];
  const factoresPorObra = new Map(
    await Promise.all(
      obraIds.map(async (obraId) => [obraId, await getFactoresAislacionObra(obraId)] as const),
    ),
  );

  return registros.map((registro) =>
    normalizeRegistroCliente(registro, factoresPorObra.get(registro.obra_id)),
  );
}

// ── Obras del cliente ────────────────────────────────────────────────────────────

export async function getClienteObras(req: Request, res: Response) {
  try {
    const session = requireCliente(req, res);
    if (!session) return;

    const obraIds = await getObraIdsCliente(session.userId, session.userRole);

    if (obraIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const obras = await prisma.obras.findMany({
      where: { id: { in: obraIds } },
      select: {
        id:        true,
        nombre:    true,
        codigo:    true,
        cliente:   true,
        direccion: true,
        estado:    true,
        _count: {
          select: {
            registros_terreno: { where: { estado: "validado", validado_cliente: false } },
          },
        },
        registros_terreno: {
          where: { estado: "validado", validado_cliente: true },
          select: { id: true },
        },
      },
      orderBy: { nombre: "asc" },
    });

    return res.json({
      success: true,
      data: obras.map((obra) => ({
        id:                   obra.id,
        nombre:               obra.nombre,
        codigo:               obra.codigo,
        cliente:              obra.cliente,
        direccion:            obra.direccion,
        estado:               obra.estado,
        registrosPendientes:  obra._count.registros_terreno,
        registrosValidados:   obra.registros_terreno.length,
      })),
    });
  } catch (error) {
    console.error("GET CLIENTE OBRAS ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudieron obtener las obras del cliente" });
  }
}

// ── Registros pendientes de una obra ────────────────────────────────────────────

const REGISTRO_SELECT = {
  id:                           true,
  fecha:                        true,
  dia_semana:                   true,
  tipo_registro:                true,
  estado:                       true,
  piso:                         true,
  modulo:                       true,
  recinto:                      true,
  eje_numerico:                 true,
  eje_alfabetico:               true,
  numero_sello:                 true,
  cantidad_sellos:              true,
  cantidad_final:               true,
  descripcion_material:         true,
  codigo_beck:                  true,
  nombre_sellador:              true,
  itemizado_beck:               true,
  dimensiones:                  true,
  itemizado_mandante:           true,
  holgura:                      true,
  factor_por_holguras:          true,
  accesibilidad:                true,
  cantidad_sellos_con_factores: true,
  aislacion:                    true,
  cantidad_sellos_aislacion:    true,
  reparacion_tabique:           true,
  folio:                        true,
  metros_lineales:              true,
  observaciones:                true,
  created_at:                   true,
  updated_at:                   true,
  fotos_urls:                   true,
  foto_url:                     true,
  obra_id:                      true,
  validado_cliente:             true,
  validado_cliente_at:          true,
  firma_cliente_url:            true,
  pdf_firmado_url:              true,
  fotos: {
    select: {
      id: true,
      url: true,
      public_id: true,
      formato: true,
      nombre_archivo: true,
      created_at: true,
    },
    orderBy: { created_at: "desc" as const },
  },
} as const;

export async function getClienteRegistrosObra(req: Request, res: Response) {
  try {
    const session = requireCliente(req, res);
    if (!session) return;

    const obraId = typeof req.params.obraId === "string" ? req.params.obraId : "";

    if (!obraId) {
      return res.status(400).json({ success: false, error: "Falta id de la obra" });
    }

    const obraIds = await getObraIdsCliente(session.userId, session.userRole);

    if (!obraIds.includes(obraId)) {
      return res.status(403).json({ success: false, error: "No tienes acceso a esta obra" });
    }

    const registros = await prisma.registros_terreno.findMany({
      where: { obra_id: obraId, estado: "validado", validado_cliente: false },
      select: REGISTRO_SELECT,
      orderBy: { fecha: "desc" },
    });

    return res.json({ success: true, data: await normalizeRegistrosCliente(registros) });
  } catch (error) {
    console.error("GET CLIENTE REGISTROS OBRA ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudieron obtener los registros del cliente" });
  }
}

// ── Historial de registros validados por el cliente ──────────────────────────────

export async function getClienteHistorial(req: Request, res: Response) {
  try {
    const session = requireCliente(req, res);
    if (!session) return;

    const obraIds = await getObraIdsCliente(session.userId, session.userRole);

    if (obraIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const paginated = req.query.paginated === "true";
    const search = String(req.query.search ?? "").trim();
    const obraId = String(req.query.obraId ?? "").trim();
    const fecha = String(req.query.fecha ?? "").trim();
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.trunc(requestedLimit), 50)
      : 25;
    const cursor = String(req.query.cursor ?? "").trim();
    const where = {
      obra_id: { in: obraIds, ...(obraId ? { equals: obraId } : {}) },
      estado: "validado" as const,
      validado_cliente: true,
      ...(fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)
        ? { fecha: new Date(`${fecha}T00:00:00.000Z`) }
        : {}),
      ...(search
        ? {
            OR: [
              { numero_sello: { contains: search, mode: "insensitive" as const } },
              { piso: { contains: search, mode: "insensitive" as const } },
              { nombre_sellador: { contains: search, mode: "insensitive" as const } },
              { obras: { nombre: { contains: search, mode: "insensitive" as const } } },
              { obras: { codigo: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };

    if (!paginated) {
      const registros = await prisma.registros_terreno.findMany({
        where,
        select: { ...REGISTRO_SELECT, obras: { select: { nombre: true, codigo: true } } },
        orderBy: { validado_cliente_at: "desc" },
      });
      return res.json({ success: true, data: await normalizeRegistrosCliente(registros) });
    }

    const [rows, total, historialObras] = await prisma.$transaction([
      prisma.registros_terreno.findMany({
        where,
        select: {
          id: true, fecha: true, tipo_registro: true, estado: true, piso: true,
          numero_sello: true, nombre_sellador: true, created_at: true, updated_at: true,
          obra_id: true, validado_cliente: true, validado_cliente_at: true,
          pdf_firmado_url: true,
          obras: { select: { nombre: true, codigo: true } },
        },
        orderBy: [{ validado_cliente_at: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      prisma.registros_terreno.count({ where }),
      prisma.registros_terreno.findMany({
        where: { obra_id: { in: obraIds }, estado: "validado", validado_cliente: true },
        distinct: ["obra_id"],
        select: { obra_id: true, obras: { select: { nombre: true } } },
        orderBy: { obra_id: "asc" },
      }),
    ]);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    return res.json({
      success: true,
      data: {
        items: pageRows.map((registro) => normalizeRegistroCliente(registro)),
        total,
        nextCursor: hasMore ? pageRows[pageRows.length - 1]?.id ?? null : null,
        obras: historialObras.map((item) => ({ id: item.obra_id, nombre: item.obras.nombre })),
      },
    });
  } catch (error) {
    console.error("GET CLIENTE HISTORIAL ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudo obtener el historial del cliente" });
  }
}

export async function getClienteRegistroDetalle(req: Request, res: Response) {
  try {
    const session = requireCliente(req, res);
    if (!session) return;
    const id = typeof req.params.id === "string" ? req.params.id : "";
    const obraIds = await getObraIdsCliente(session.userId, session.userRole);
    const registro = await prisma.registros_terreno.findFirst({
      where: { id, obra_id: { in: obraIds }, validado_cliente: true },
      select: { ...REGISTRO_SELECT, obras: { select: { nombre: true, codigo: true } } },
    });
    if (!registro) return res.status(404).json({ success: false, error: "Registro no encontrado" });
    const factoresAislacion = await getFactoresAislacionObra(registro.obra_id);
    return res.json({
      success: true,
      data: normalizeRegistroCliente(registro, factoresAislacion),
    });
  } catch (error) {
    console.error("GET CLIENTE REGISTRO DETALLE ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudo obtener el detalle" });
  }
}

// ── Validar registro con firma ───────────────────────────────────────────────────

export async function validarRegistroCliente(req: Request, res: Response) {
  try {
    const session = requireCliente(req, res);
    if (!session) return;

    const id = typeof req.params.id === "string" ? req.params.id : "";

    if (!id) {
      return res.status(400).json({ success: false, error: "Falta id del registro" });
    }

    const { pathData, canvasWidth, canvasHeight } = req.body ?? {};

    if (!pathData || typeof pathData !== "string" || pathData.trim().length === 0) {
      return res.status(400).json({ success: false, error: "Falta la firma del cliente" });
    }
    if (pathData.length > 100_000) {
      return res.status(400).json({ success: false, error: "La firma es demasiado compleja" });
    }
    if (
      !Number.isFinite(Number(canvasWidth))  || Number(canvasWidth)  <= 0 || Number(canvasWidth)  > 5000 ||
      !Number.isFinite(Number(canvasHeight)) || Number(canvasHeight) <= 0 || Number(canvasHeight) > 5000
    ) {
      return res.status(400).json({ success: false, error: "Dimensiones de canvas inválidas" });
    }

    const safeCanvasWidth  = Number(canvasWidth);
    const safeCanvasHeight = Number(canvasHeight);

    // Verificar acceso a la obra
    const obraIds = await getObraIdsCliente(session.userId, session.userRole);

    const registroBase = await prisma.registros_terreno.findUnique({
      where:  { id },
      select: { id: true, estado: true, validado_cliente: true, obra_id: true, codigo_beck: true },
    });

    if (!registroBase) {
      return res.status(404).json({ success: false, error: "Registro no encontrado" });
    }

    if (!obraIds.includes(registroBase.obra_id)) {
      return res.status(403).json({ success: false, error: "No tienes acceso a este registro" });
    }

    if (registroBase.estado !== "validado") {
      return res.status(400).json({ success: false, error: "Solo se pueden validar registros con estado 'validado'" });
    }

    if (registroBase.validado_cliente) {
      return res.status(409).json({ success: false, error: "Este registro ya fue validado por el cliente" });
    }

    // Cargar detalles completos para el PDF
    const registroFull = await findRegistroWithDetails(id);

    if (!registroFull) {
      return res.status(404).json({ success: false, error: "Registro no encontrado" });
    }

    // Nombre del firmante
    const firmante = await prisma.usuarios.findUnique({
      where:  { id: session.userId },
      select: { nombre: true },
    });

    const firmadoAt  = new Date();
    const firmadoPor = firmante?.nombre || "Cliente";

    // Generar PDF con firma incrustada
    const configuracionCliente = await obtenerConfiguracionRegistro(
      registroBase.obra_id,
      "cliente",
    );
    const camposVisiblesCliente = new Set(
      configuracionCliente
        .filter((campo) => campo.visible)
        .map((campo) => campo.campo),
    );
    const pdfBuffer = await generateRegistroPdfBuffer(registroFull, {
      pathData,
      canvasWidth:  safeCanvasWidth,
      canvasHeight: safeCanvasHeight,
      firmadoPor,
      firmadoAt,
    }, camposVisiblesCliente);

    const codigoBeck = registroBase.codigo_beck ?? `REG-${id.slice(0, 6).toUpperCase()}`;
    const safeCodigoBeck = codigoBeck.replace(/[^a-zA-Z0-9_-]/g, "_");

    // Subir PDF firmado a Cloudinary como raw
    const pdfResult = await uploadRawBufferToCloudinary(pdfBuffer, {
      folder:   "beck/pdfs-firmados",
      publicId: `${safeCodigoBeck}-firmado-${id}.pdf`,
    });

    const updateResult = await prisma.registros_terreno.updateMany({
      where: {
        id,
        estado: "validado",
        validado_cliente: false,
      },
      data: {
        validado_cliente:        true,
        validado_cliente_at:     firmadoAt,
        validado_cliente_por_id: session.userId,
        // Se conserva la columna por compatibilidad, pero ahora almacena el
        // public_id privado y nunca una URL pública.
        pdf_firmado_url:         pdfResult.public_id,
      },
    });

    if (updateResult.count !== 1) {
      await deleteRawFromCloudinary(pdfResult.public_id);
      return res.status(409).json({
        success: false,
        error: "Este registro ya fue validado por otro proceso",
        code: "REGISTRO_ALREADY_SIGNED",
      });
    }

    const updated = await prisma.registros_terreno.findUniqueOrThrow({
      where: { id },
      select: {
        ...REGISTRO_SELECT,
        obras: { select: { nombre: true, codigo: true } },
      },
    });

    const factoresAislacion = await getFactoresAislacionObra(updated.obra_id);
    return res.json({
      success: true,
      data: normalizeRegistroCliente(updated, factoresAislacion),
    });
  } catch (error) {
    console.error("VALIDAR REGISTRO CLIENTE ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudo validar el registro" });
  }
}

export async function descargarPdfCliente(req: Request, res: Response) {
  try {
    const session = requireCliente(req, res);
    if (!session) return;

    const id = typeof req.params.id === "string" ? req.params.id : "";
    if (!id) {
      return res.status(400).json({ success: false, error: "Falta id del registro" });
    }

    const obraIds = await getObraIdsCliente(session.userId, session.userRole);
    const registro = await prisma.registros_terreno.findUnique({
      where: { id },
      select: {
        obra_id: true,
        validado_cliente: true,
        pdf_firmado_url: true,
      },
    });

    if (!registro) {
      return res.status(404).json({ success: false, error: "Registro no encontrado" });
    }
    if (!obraIds.includes(registro.obra_id)) {
      return res.status(403).json({ success: false, error: "No tienes acceso a este registro" });
    }
    if (!registro.validado_cliente || !registro.pdf_firmado_url) {
      return res.status(404).json({ success: false, error: "PDF firmado no disponible" });
    }

    return res.redirect(
      getPrivateDownloadUrl(registro.pdf_firmado_url, "pdf", "raw"),
    );
  } catch (error) {
    console.error("DESCARGAR PDF CLIENTE ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudo descargar el PDF" });
  }
}

// ── Dashboard (sin cambios) ──────────────────────────────────────────────────────

export async function getClienteDashboard(req: Request, res: Response) {
  try {
    const session = requireCliente(req, res);
    if (!session) return;

    const obraIds = await getObraIdsCliente(session.userId, session.userRole);

    const emptyDashboard = {
      totalObras: 0, totalRegistros: 0, cantidadFinalTotal: 0, registrosEsteMes: 0,
      registrosPorObra: [], registrosPorTipo: [], registrosPorPiso: [], registrosPorFecha: [],
      ultimosRegistrosValidados: [],
    };

    if (obraIds.length === 0) {
      return res.json({ success: true, data: emptyDashboard });
    }

    const ahora          = new Date();
    const inicioMes      = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const finMes         = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0, 23, 59, 59, 999);
    const treintaDiasAtras = new Date(ahora);
    treintaDiasAtras.setDate(treintaDiasAtras.getDate() - 30);

    const registros = await prisma.registros_terreno.findMany({
      where:   { obra_id: { in: obraIds }, estado: "validado" },
      select:  { id: true, obra_id: true, fecha: true, tipo_registro: true, piso: true, modulo: true, cantidad_final: true, obras: { select: { nombre: true } } },
      orderBy: { fecha: "desc" },
    });

    const cantidadFinalTotal = registros.reduce((total, r) => total + Number(r.cantidad_final || 0), 0);
    const registrosEsteMes   = registros.filter((r) => r.fecha >= inicioMes && r.fecha <= finMes).length;

    const porTipoMap = new Map<string, number>();
    const porObraMap = new Map<string, number>();
    const porPisoMap = new Map<string, number>();
    const porFechaMap = new Map<string, number>();

    registros.forEach((r) => {
      const tipo = r.tipo_registro || "sin_tipo";
      const obra = r.obras?.nombre  || "Sin obra";
      const piso = r.piso           || "Sin piso";
      porTipoMap.set(tipo, (porTipoMap.get(tipo) || 0) + 1);
      porObraMap.set(obra, (porObraMap.get(obra) || 0) + 1);
      porPisoMap.set(piso, (porPisoMap.get(piso) || 0) + 1);
      if (r.fecha >= treintaDiasAtras) {
        const fecha = r.fecha.toISOString().slice(0, 10);
        porFechaMap.set(fecha, (porFechaMap.get(fecha) || 0) + 1);
      }
    });

    return res.json({
      success: true,
      data: {
        totalObras:            obraIds.length,
        totalRegistros:        registros.length,
        cantidadFinalTotal,
        registrosEsteMes,
        registrosPorObra:      [...porObraMap.entries()].map(([nombre, total]) => ({ nombre, total })),
        registrosPorTipo:      [...porTipoMap.entries()].map(([tipo,   total]) => ({ tipo,   total })),
        registrosPorPiso:      [...porPisoMap.entries()].map(([piso,   total]) => ({ piso,   total })),
        registrosPorFecha:     [...porFechaMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, total]) => ({ fecha, total })),
        ultimosRegistrosValidados: registros.slice(0, 10).map((r) => ({
          id: r.id, fecha: r.fecha, tipoRegistro: r.tipo_registro, obraId: r.obra_id,
          obraNombre: r.obras?.nombre || "Sin obra", modulo: r.modulo,
          cantidadFinal: r.cantidad_final ? Number(r.cantidad_final) : null,
        })),
      },
    });
  } catch (error) {
    console.error("GET CLIENTE DASHBOARD ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudo obtener el dashboard del cliente" });
  }
}
