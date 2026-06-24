import { Request, Response } from "express";
import { prisma } from "../config/prisma";

function requireCliente(req: Request, res: Response) {
  const userId = req.user?.id;
  const userRole = req.user?.rol;

  if (!userId || !userRole) {
    res.status(401).json({
      success: false,
      error: "Usuario no autenticado",
    });
    return null;
  }

  if (userRole !== "cliente" && userRole !== "administrador") {
    res.status(403).json({
      success: false,
      error: "No tienes permisos para acceder a la vista cliente",
    });
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

  return asignaciones.map((asignacion) => asignacion.obra_id);
}

function normalizeFotos(registro: {
  id: string;
  foto_url?: string | null;
  fotos_urls?: string[] | null;
  fotos?: { id: string; url: string; created_at: Date; nombre_archivo?: string | null }[];
}) {
  const seen = new Set<string>();

  return [
    ...(registro.fotos || []).map((foto) => ({
      id: foto.id,
      url: foto.url,
      nombre: foto.nombre_archivo || null,
      created_at: foto.created_at,
    })),
    ...(Array.isArray(registro.fotos_urls) ? registro.fotos_urls : []).map((url, index) => ({
      id: `${registro.id}-url-${index}`,
      url,
      nombre: null,
      created_at: new Date(0),
    })),
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
  ].filter((foto) => {
    if (!foto.url || seen.has(foto.url)) return false;
    seen.add(foto.url);
    return true;
  });
}

function normalizeRegistroCliente(registro: any) {
  const ejeParts = [registro.eje_alfabetico, registro.eje_numerico]
    .filter(Boolean)
    .map((value) => String(value).trim());

  return {
    id: registro.id,
    fecha: registro.fecha,
    diaSemana: registro.dia_semana,
    tipoRegistro: registro.tipo_registro,
    piso: registro.piso,
    modulo: registro.modulo,
    recinto: registro.recinto,
    eje: ejeParts.join(" / "),
    ejeAlfabetico: registro.eje_alfabetico,
    ejeNumerico: registro.eje_numerico,
    numeroSello: registro.numero_sello,
    cantidad: registro.cantidad_sellos,
    cantidadSellos: registro.cantidad_sellos,
    cantidadFinal: registro.cantidad_final ? Number(registro.cantidad_final) : null,
    material: registro.descripcion_material,
    descripcionMaterial: registro.descripcion_material,
    codigoBeck: registro.codigo_beck,
    sellador: registro.nombre_sellador,
    nombreSellador: registro.nombre_sellador,
    itemizadoBeck: registro.itemizado_beck,
    itemizadoMandante: registro.itemizado_mandante,
    holgura: registro.holgura ? Number(registro.holgura) : null,
    factorPorHolguras: registro.factor_por_holguras
      ? Number(registro.factor_por_holguras)
      : null,
    accesibilidad: registro.accesibilidad,
    cantidadSellosConFactores: registro.cantidad_sellos_con_factores
      ? Number(registro.cantidad_sellos_con_factores)
      : null,
    aislacion: registro.aislacion ? Number(registro.aislacion) : null,
    cantidadSellosAislacion: registro.cantidad_sellos_aislacion
      ? Number(registro.cantidad_sellos_aislacion)
      : null,
    reparacionTabique: registro.reparacion_tabique
      ? Number(registro.reparacion_tabique)
      : null,
    folio: registro.folio,
    metrosLineales:
      registro.metros_lineales !== null && registro.metros_lineales !== undefined
        ? Number(registro.metros_lineales)
        : null,
    observaciones: registro.observaciones,
    estado: registro.estado,
    createdAt: registro.created_at,
    updatedAt: registro.updated_at,
    fotosUrls: Array.isArray(registro.fotos_urls) ? registro.fotos_urls : [],
    fotoUrl: registro.foto_url,
    fotos: normalizeFotos(registro),
    fotos_registro: normalizeFotos(registro),
  };
}

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
        id: true,
        nombre: true,
        codigo: true,
        cliente: true,
        direccion: true,
        estado: true,
        _count: {
          select: {
            registros_terreno: { where: { estado: "validado" } },
          },
        },
        registros_terreno: {
          where: { estado: "validado" },
          select: { cantidad_final: true },
        },
      },
      orderBy: { nombre: "asc" },
    });

    return res.json({
      success: true,
      data: obras.map((obra) => ({
        id: obra.id,
        nombre: obra.nombre,
        codigo: obra.codigo,
        cliente: obra.cliente,
        direccion: obra.direccion,
        estado: obra.estado,
        totalRegistros: obra._count.registros_terreno,
        totalRegistrosValidados: obra._count.registros_terreno,
        cantidadFinalTotal: obra.registros_terreno.reduce(
          (total, registro) => total + Number(registro.cantidad_final || 0),
          0,
        ),
      })),
    });
  } catch (error) {
    console.error("GET CLIENTE OBRAS ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudieron obtener las obras del cliente",
    });
  }
}

export async function getClienteRegistrosObra(req: Request, res: Response) {
  try {
    const session = requireCliente(req, res);
    if (!session) return;

    const obraId = typeof req.params.obraId === "string" ? req.params.obraId : "";

    if (!obraId) {
      return res.status(400).json({
        success: false,
        error: "Falta id de la obra",
      });
    }
    const obraIds = await getObraIdsCliente(session.userId, session.userRole);

    if (!obraIds.includes(obraId)) {
      return res.status(403).json({
        success: false,
        error: "No tienes acceso a esta obra",
      });
    }

    const registros = await prisma.registros_terreno.findMany({
      where: {
        obra_id: obraId,
        estado: "validado",
      },
      select: {
        id: true,
        fecha: true,
        dia_semana: true,
        tipo_registro: true,
        estado: true,
        piso: true,
        modulo: true,
        recinto: true,
        eje_numerico: true,
        eje_alfabetico: true,
        numero_sello: true,
        cantidad_sellos: true,
        cantidad_final: true,
        descripcion_material: true,
        codigo_beck: true,
        nombre_sellador: true,
        itemizado_beck: true,
        itemizado_mandante: true,
        holgura: true,
        factor_por_holguras: true,
        accesibilidad: true,
        cantidad_sellos_con_factores: true,
        aislacion: true,
        cantidad_sellos_aislacion: true,
        reparacion_tabique: true,
        folio: true,
        metros_lineales: true,
        observaciones: true,
        created_at: true,
        updated_at: true,
        fotos_urls: true,
        foto_url: true,
        fotos: {
          select: {
            id: true,
            url: true,
            nombre_archivo: true,
            created_at: true,
          },
          orderBy: {
            created_at: "desc",
          },
        },
      },
      orderBy: { fecha: "desc" },
    });

    return res.json({
      success: true,
      data: registros.map(normalizeRegistroCliente),
    });
  } catch (error) {
    console.error("GET CLIENTE REGISTROS OBRA ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudieron obtener los registros del cliente",
    });
  }
}

export async function getClienteDashboard(req: Request, res: Response) {
  try {
    const session = requireCliente(req, res);
    if (!session) return;

    const obraIds = await getObraIdsCliente(session.userId, session.userRole);

    const emptyDashboard = {
      totalObras: 0,
      totalRegistros: 0,
      cantidadFinalTotal: 0,
      registrosEsteMes: 0,
      registrosPorObra: [],
      registrosPorTipo: [],
      registrosPorPiso: [],
      registrosPorFecha: [],
      ultimosRegistrosValidados: [],
    };

    if (obraIds.length === 0) {
      return res.json({ success: true, data: emptyDashboard });
    }

    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const finMes = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0, 23, 59, 59, 999);
    const treintaDiasAtras = new Date(ahora);
    treintaDiasAtras.setDate(treintaDiasAtras.getDate() - 30);

    const registros = await prisma.registros_terreno.findMany({
      where: {
        obra_id: { in: obraIds },
        estado: "validado",
      },
      select: {
        id: true,
        obra_id: true,
        fecha: true,
        tipo_registro: true,
        piso: true,
        modulo: true,
        cantidad_final: true,
        obras: { select: { nombre: true } },
      },
      orderBy: { fecha: "desc" },
    });

    const totalRegistros = registros.length;
    const cantidadFinalTotal = registros.reduce(
      (total, registro) => total + Number(registro.cantidad_final || 0),
      0,
    );
    const registrosEsteMes = registros.filter(
      (registro) => registro.fecha >= inicioMes && registro.fecha <= finMes,
    ).length;

    const porTipoMap = new Map<string, number>();
    const porObraMap = new Map<string, number>();
    const porPisoMap = new Map<string, number>();
    const porFechaMap = new Map<string, number>();

    registros.forEach((registro) => {
      const tipo = registro.tipo_registro || "sin_tipo";
      const obra = registro.obras?.nombre || "Sin obra";
      const piso = registro.piso || "Sin piso";

      porTipoMap.set(tipo, (porTipoMap.get(tipo) || 0) + 1);
      porObraMap.set(obra, (porObraMap.get(obra) || 0) + 1);
      porPisoMap.set(piso, (porPisoMap.get(piso) || 0) + 1);

      if (registro.fecha >= treintaDiasAtras) {
        const fecha = registro.fecha.toISOString().slice(0, 10);
        porFechaMap.set(fecha, (porFechaMap.get(fecha) || 0) + 1);
      }
    });

    return res.json({
      success: true,
      data: {
        totalObras: obraIds.length,
        totalRegistros,
        cantidadFinalTotal,
        registrosEsteMes,
        registrosPorObra: [...porObraMap.entries()].map(([nombre, total]) => ({
          nombre,
          total,
        })),
        registrosPorTipo: [...porTipoMap.entries()].map(([tipo, total]) => ({
          tipo,
          total,
        })),
        registrosPorPiso: [...porPisoMap.entries()].map(([piso, total]) => ({
          piso,
          total,
        })),
        registrosPorFecha: [...porFechaMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([fecha, total]) => ({ fecha, total })),
        ultimosRegistrosValidados: registros.slice(0, 10).map((registro) => ({
          id: registro.id,
          fecha: registro.fecha,
          tipoRegistro: registro.tipo_registro,
          obraId: registro.obra_id,
          obraNombre: registro.obras?.nombre || "Sin obra",
          modulo: registro.modulo,
          cantidadFinal: registro.cantidad_final
            ? Number(registro.cantidad_final)
            : null,
        })),
      },
    });
  } catch (error) {
    console.error("GET CLIENTE DASHBOARD ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudo obtener el dashboard del cliente",
    });
  }
}
