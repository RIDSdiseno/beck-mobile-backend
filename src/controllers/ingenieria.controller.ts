import { Request, Response } from "express";
import {
  EstadoConformidadInspeccion,
  EstadoRegistroTerreno,
  Prisma,
  ResultadoParametroInspeccion,
} from "@prisma/client";
import { prisma } from "../config/prisma";
import {
  deleteImageFromCloudinary,
  uploadBufferToCloudinary,
  withPrivateImageUrl,
} from "../services/cloudinary.service";
import { calcularCamposConConfiguracion } from "../services/calculosRegistroTerreno.service";
import { buildCloudinaryFolder } from "./registros.controller";

const MIN_CONTROL_INSPECCION_FOTOS = 1;
const MAX_CONTROL_INSPECCION_FOTOS = 5;

const ESTADOS_INGENIERIA = [
  EstadoRegistroTerreno.pendiente,
  EstadoRegistroTerreno.en_revision,
  EstadoRegistroTerreno.validado,
  EstadoRegistroTerreno.rechazado,
];

function isIngenieriaRole(role?: string) {
  return role === "ingenieria" || role === "administrador";
}

function getParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function parseOptionalDecimal(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || normalizeText(value) === "") return null;

  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed)) return undefined;

  return new Prisma.Decimal(parsed);
}

function parseOptionalInt(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || normalizeText(value) === "") return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;

  return Math.trunc(parsed);
}

function normalizeRegistroFotos(registro: {
  id: string;
  foto_url?: string | null;
  fotos_urls?: string[] | null;
  fotos?: {
    id: string;
    url: string;
    public_id: string;
    formato?: string | null;
    created_at: Date;
  }[];
}) {
  const relationFotos = (registro.fotos || []).filter((foto) => foto.url);
  const fallbackUrls =
    relationFotos.length > 0
      ? []
      : [
          ...(Array.isArray(registro.fotos_urls) ? registro.fotos_urls : []),
          registro.foto_url,
        ].filter((url): url is string => Boolean(url));

  const seen = new Set<string>();

  return [
    ...relationFotos.map((foto) => ({
      id: foto.id,
      url: withPrivateImageUrl(foto).url,
      created_at: foto.created_at,
    })),
    ...fallbackUrls.map((url, index) => ({
      id: `${registro.id}-url-${index}`,
      url,
      created_at: new Date(0),
    })),
  ].filter((foto) => {
    if (seen.has(foto.url)) return false;
    seen.add(foto.url);
    return true;
  });
}

function mapRegistroIngenieria(registro: any) {
  return {
    ...registro,
    fotos: normalizeRegistroFotos(registro),
    obra: registro.obras ?? null,
    usuario: registro.usuarios ?? null,
    rechazado_por:
      registro.usuarios_registros_terreno_rechazado_por_idTousuarios ?? null,
    procesamiento: registro.procesamiento_ingenieria ?? null,
  };
}

function mapControlPrivatePhotos(control: any) {
  return {
    ...control,
    fotos_control_inspeccion: (control.fotos_control_inspeccion || []).map(
      withPrivateImageUrl,
    ),
    controles_inspeccion_parametros: (
      control.controles_inspeccion_parametros || []
    ).map((parametro: any) => ({
      ...parametro,
      fotos_correccion_parametro: (
        parametro.fotos_correccion_parametro || []
      ).map(withPrivateImageUrl),
    })),
  };
}

export async function findRegistroWithDetails(id: string) {
  return prisma.registros_terreno.findFirst({
    where: { id, carga_completa: true },
    include: {
      obras: {
        select: {
          id: true,
          nombre: true,
          codigo: true,
          cliente: true,
          direccion: true,
          estado: true,
        },
      },
      usuarios: {
        select: {
          id: true,
          nombre: true,
          email: true,
          rol: true,
        },
      },
      fotos: {
        select: {
          id: true,
          url: true,
          public_id: true,
          formato: true,
          created_at: true,
        },
        orderBy: {
          created_at: "desc",
        },
      },
      procesamiento_ingenieria: true,
      usuarios_registros_terreno_rechazado_por_idTousuarios: {
        select: {
          id: true,
          nombre: true,
          email: true,
          rol: true,
        },
      },
      controles_inspeccion: {
        where: { conformidad: "conforme" },
        select: { id: true },
        take: 1,
      },
    },
  });
}

function ensureIngenieria(req: Request, res: Response) {
  if (!req.user?.id) {
    res.status(401).json({
      success: false,
      error: "Usuario no autenticado",
    });
    return false;
  }

  if (!isIngenieriaRole(req.user.rol)) {
    res.status(403).json({
      success: false,
      error: "Solo ingeniería puede acceder a este módulo",
    });
    return false;
  }

  return true;
}

export async function getIngenieriaResumen(req: Request, res: Response) {
  try {
    if (!ensureIngenieria(req, res)) return;

    const grouped = await prisma.registros_terreno.groupBy({
      by: ["estado"],
      where: {
        carga_completa: true,
      },
      _count: {
        _all: true,
      },
    });

    const counts = grouped.reduce<Record<string, number>>((acc, item) => {
      acc[item.estado] = item._count._all;
      return acc;
    }, {});

    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);

    return res.json({
      success: true,
      data: {
        pendientes: counts.pendiente ?? 0,
        enRevision: counts.en_revision ?? 0,
        validados: counts.validado ?? 0,
        rechazados: counts.rechazado ?? 0,
        total,
      },
    });
  } catch (error) {
    console.error("GET INGENIERIA RESUMEN ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudo obtener el resumen de ingeniería",
    });
  }
}

export async function getIngenieriaRegistros(req: Request, res: Response) {
  try {
    if (!ensureIngenieria(req, res)) return;

    const estado = normalizeText(req.query.estado);
    const search = normalizeText(req.query.search).toLowerCase();
    const obraId = normalizeText(req.query.obraId);
    const limitValue = Number(req.query.limit);
    const take =
      Number.isFinite(limitValue) && limitValue > 0
        ? Math.min(Math.trunc(limitValue), 100)
        : 80;

    if (estado && !ESTADOS_INGENIERIA.includes(estado as EstadoRegistroTerreno)) {
      return res.status(400).json({
        success: false,
        error: "Estado no válido",
      });
    }

    const registros = await prisma.registros_terreno.findMany({
      where: {
        carga_completa: true,
        ...(estado ? { estado: estado as EstadoRegistroTerreno } : {}),
        ...(obraId ? { obra_id: obraId } : {}),
        ...(search
          ? {
              OR: [
                { folio: { contains: search, mode: "insensitive" } },
                { codigo_beck: { contains: search, mode: "insensitive" } },
                { itemizado_beck: { contains: search, mode: "insensitive" } },
                { descripcion_material: { contains: search, mode: "insensitive" } },
                { numero_sello: { contains: search, mode: "insensitive" } },
                { nombre_sellador: { contains: search, mode: "insensitive" } },
                {
                  obras: {
                    nombre: { contains: search, mode: "insensitive" },
                  },
                },
                {
                  obras: {
                    codigo: { contains: search, mode: "insensitive" },
                  },
                },
                {
                  usuarios: {
                    nombre: { contains: search, mode: "insensitive" },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: {
        created_at: "desc",
      },
      take,
      include: {
        obras: {
          select: {
            id: true,
            nombre: true,
            codigo: true,
            cliente: true,
            direccion: true,
          },
        },
        usuarios: {
          select: {
            id: true,
            nombre: true,
            email: true,
            rol: true,
          },
        },
        fotos: {
          select: {
            id: true,
            url: true,
            public_id: true,
            formato: true,
            created_at: true,
          },
          orderBy: {
            created_at: "desc",
          },
        },
        procesamiento_ingenieria: true,
        usuarios_registros_terreno_rechazado_por_idTousuarios: {
          select: {
            id: true,
            nombre: true,
            email: true,
            rol: true,
          },
        },
      },
    });

    return res.json({
      success: true,
      data: registros.map(mapRegistroIngenieria),
    });
  } catch (error) {
    console.error("GET INGENIERIA REGISTROS ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudieron obtener los registros de ingeniería",
    });
  }
}

export async function iniciarRevisionIngenieria(req: Request, res: Response) {
  try {
    if (!ensureIngenieria(req, res)) return;

    const registroId = getParamValue(req.params.id);

    if (!registroId) {
      return res.status(400).json({
        success: false,
        error: "Falta id del registro",
      });
    }

    const currentRegistro = await prisma.registros_terreno.findUnique({
      where: { id: registroId },
    });

    if (!currentRegistro) {
      return res.status(404).json({
        success: false,
        error: "Registro no encontrado",
      });
    }

    if (!currentRegistro.carga_completa) {
      return res.status(409).json({
        success: false,
        error: "El registro todavía no tiene una fotografía guardada",
        code: "REGISTRO_INCOMPLETO",
      });
    }

    if (currentRegistro.estado !== EstadoRegistroTerreno.pendiente) {
      return res.status(400).json({
        success: false,
        error: "Solo se puede iniciar revisión de un registro pendiente",
      });
    }

    const transitioned = await prisma.$transaction(async (tx) => {
      const updated = await tx.registros_terreno.updateMany({
        where: {
          id: registroId,
          estado: EstadoRegistroTerreno.pendiente,
          carga_completa: true,
        },
        data: {
          estado: EstadoRegistroTerreno.en_revision,
          devuelto_a_tecnico: false,
          updated_at: new Date(),
        },
      });
      if (updated.count !== 1) return false;

      await tx.procesamiento_ingenieria.upsert({
        where: { registro_terreno_id: registroId },
        create: {
          registro_terreno_id: registroId,
          usuario_id: req.user!.id,
        },
        update: {
          usuario_id: req.user!.id,
          procesado_at: new Date(),
        },
      });
      return true;
    });
    if (!transitioned) {
      return res.status(409).json({
        success: false,
        error: "El registro cambió de estado mientras se iniciaba la revisión",
        code: "ESTADO_CONFLICTO",
      });
    }

    const registro = await findRegistroWithDetails(registroId);

    return res.json({
      success: true,
      data: mapRegistroIngenieria(registro),
      message: "Registro en revisión",
    });
  } catch (error) {
    console.error("INICIAR REVISION INGENIERIA ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudo iniciar la revisión",
    });
  }
}

export async function updateRegistroIngenieria(req: Request, res: Response) {
  try {
    if (!ensureIngenieria(req, res)) return;

    const registroId = getParamValue(req.params.id);

    if (!registroId) {
      return res.status(400).json({
        success: false,
        error: "Falta id del registro",
      });
    }

    const currentRegistro = await prisma.registros_terreno.findUnique({
      where: { id: registroId },
    });

    if (!currentRegistro) {
      return res.status(404).json({
        success: false,
        error: "Registro no encontrado",
      });
    }

    if (!currentRegistro.carga_completa) {
      return res.status(409).json({
        success: false,
        error: "El registro todavía no tiene una fotografía guardada",
        code: "REGISTRO_INCOMPLETO",
      });
    }

    if (currentRegistro.estado !== EstadoRegistroTerreno.en_revision) {
      return res.status(409).json({
        success: false,
        error: "Solo se puede editar un registro en revisión",
        code: "REGISTRO_LOCKED",
      });
    }

    const data: Prisma.registros_terrenoUpdateInput = {};
    const {
      codigoBeck,
      codigo_beck,
      itemizadoBeck,
      descripcionMaterial,
      descripcion_material,
      recinto,
      modulo,
      piso,
      ejeNumerico,
      eje_numerico,
      ejeAlfabetico,
      eje_alfabetico,
      numeroSello,
      numero_sello,
      cantidadSellos,
      cantidad_sellos,
      nombreSellador,
      nombre_sellador,
      holgura,
      accesibilidad,
      aislacion,
      reparacionTabique,
      reparacion_tabique,
      folio,
      observaciones,
      itemizadoMandante,
      itemizado_mandante,
    } = req.body ?? {};

    const codigoBeckInput = codigoBeck ?? codigo_beck;
    const itemizadoBeckInput =
      itemizadoBeck ?? descripcionMaterial ?? descripcion_material;
    const ejeNumericoInput = ejeNumerico ?? eje_numerico;
    const ejeAlfabeticoInput = ejeAlfabetico ?? eje_alfabetico;
    const numeroSelloInput = numeroSello ?? numero_sello;
    const cantidadSellosInput = cantidadSellos ?? cantidad_sellos;
    const nombreSelladorInput = nombreSellador ?? nombre_sellador;
    const reparacionTabiqueInput = reparacionTabique ?? reparacion_tabique;
    const itemizadoMandanteInput = itemizadoMandante ?? itemizado_mandante;

    if (codigoBeckInput !== undefined) {
      data.codigo_beck = normalizeText(codigoBeckInput) || null;
    }
    if (itemizadoBeckInput !== undefined) {
      const value = normalizeText(itemizadoBeckInput);
      data.itemizado_beck = value || null;
      data.descripcion_material = value || currentRegistro.descripcion_material;
    }
    if (recinto !== undefined) data.recinto = normalizeText(recinto) || null;
    if (modulo !== undefined) data.modulo = normalizeText(modulo) || currentRegistro.modulo;
    if (piso !== undefined) data.piso = normalizeText(piso) || currentRegistro.piso;
    if (ejeNumericoInput !== undefined) {
      data.eje_numerico = normalizeText(ejeNumericoInput) || currentRegistro.eje_numerico;
    }
    if (ejeAlfabeticoInput !== undefined) {
      data.eje_alfabetico =
        normalizeText(ejeAlfabeticoInput).toUpperCase() ||
        currentRegistro.eje_alfabetico;
    }
    if (numeroSelloInput !== undefined) {
      data.numero_sello = normalizeText(numeroSelloInput) || currentRegistro.numero_sello;
    }
    if (cantidadSellosInput !== undefined) {
      const parsed = Number(cantidadSellosInput);
      if (!Number.isFinite(parsed)) {
        return res.status(400).json({
          success: false,
          error: "Cantidad de sellos no válida",
        });
      }
      data.cantidad_sellos = Math.trunc(parsed);
    }
    if (nombreSelladorInput !== undefined) {
      data.nombre_sellador =
        normalizeText(nombreSelladorInput) || currentRegistro.nombre_sellador;
    }

    const holguraParsed = parseOptionalDecimal(holgura);
    if (holgura !== undefined) {
      if (holguraParsed === undefined) {
        return res.status(400).json({
          success: false,
          error: "Holgura no válida",
        });
      }
      data.holgura = holguraParsed ?? currentRegistro.holgura;
    }

    const accesibilidadParsed = parseOptionalInt(accesibilidad);
    if (accesibilidad !== undefined) {
      if (accesibilidadParsed === undefined) {
        return res.status(400).json({
          success: false,
          error: "Accesibilidad no válida",
        });
      }
      data.accesibilidad = accesibilidadParsed;
    }

    const aislacionParsed = parseOptionalDecimal(aislacion);
    if (aislacion !== undefined) {
      if (aislacionParsed === undefined) {
        return res.status(400).json({
          success: false,
          error: "Aislación no válida",
        });
      }
      data.aislacion = aislacionParsed;
    }

    const reparacionParsed = parseOptionalDecimal(reparacionTabiqueInput);
    if (reparacionTabiqueInput !== undefined) {
      if (reparacionParsed === undefined) {
        return res.status(400).json({
          success: false,
          error: "Reparación de tabique no válida",
        });
      }
      data.reparacion_tabique = reparacionParsed;
    }

    if (folio !== undefined) data.folio = normalizeText(folio) || null;
    if (observaciones !== undefined) {
      data.observaciones = normalizeText(observaciones) || null;
    }
    if (itemizadoMandanteInput !== undefined) {
      data.itemizado_mandante = normalizeText(itemizadoMandanteInput) || null;
    }

    const isJuntaLineal =
      currentRegistro.tipo_registro === "junta_lineal_espuma";
    const cantidadSellosFinal =
      cantidadSellosInput !== undefined
        ? Math.trunc(Number(cantidadSellosInput))
        : currentRegistro.cantidad_sellos;
    const holguraFinal =
      holgura !== undefined
        ? Number(holguraParsed ?? currentRegistro.holgura)
        : Number(currentRegistro.holgura);
    const accesibilidadFinal =
      accesibilidad !== undefined
        ? accesibilidadParsed
        : currentRegistro.accesibilidad;
    const aislacionFinal =
      aislacion !== undefined ? aislacionParsed : currentRegistro.aislacion;
    const reparacionFinal =
      reparacionTabiqueInput !== undefined
        ? reparacionParsed
        : currentRegistro.reparacion_tabique;
    const pisoFinal =
      piso !== undefined
        ? normalizeText(piso) || currentRegistro.piso
        : currentRegistro.piso;
    const calcResult = isJuntaLineal
      ? null
      : await calcularCamposConConfiguracion(currentRegistro.obra_id, {
          cantidad_sellos: cantidadSellosFinal,
          holgura: holguraFinal,
          accesibilidad: accesibilidadFinal ?? 1,
          aislacion: aislacionFinal,
          reparacion_tabique: reparacionFinal,
          piso: pisoFinal,
          tipoRegistro: currentRegistro.tipo_registro,
        });

    data.factor_por_holguras = calcResult?.factor_por_holguras ?? null;
    data.cantidad_sellos_con_factores =
      calcResult?.cantidad_sellos_con_factores ?? null;
    data.aislacion = calcResult?.aislacion_normalizada ?? null;
    data.cantidad_sellos_aislacion =
      calcResult?.cantidad_sellos_aislacion ?? null;
    data.reparacion_tabique =
      calcResult?.reparacion_tabique_normalizada ?? null;
    data.cantidad_final = calcResult?.cantidad_final ?? null;
    data.updated_at = new Date();

    const updated = await prisma.registros_terreno.updateMany({
      where: {
        id: registroId,
        estado: EstadoRegistroTerreno.en_revision,
        carga_completa: true,
      },
      data,
    });
    if (updated.count !== 1) {
      return res.status(409).json({
        success: false,
        error: "El registro cambió de estado mientras se actualizaba",
        code: "ESTADO_CONFLICTO",
      });
    }

    const registro = await findRegistroWithDetails(registroId);

    return res.json({
      success: true,
      data: mapRegistroIngenieria(registro),
      message: "Registro actualizado",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CORREGIR HOLGURA") {
      return res.status(400).json({
        success: false,
        error: "CORREGIR HOLGURA",
      });
    }

    console.error("UPDATE REGISTRO INGENIERIA ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudo actualizar el registro",
    });
  }
}

export async function validarRegistroIngenieria(req: Request, res: Response) {
  try {
    if (!ensureIngenieria(req, res)) return;

    const registroId = getParamValue(req.params.id);
    const notas = normalizeText(req.body?.notas);

    if (!registroId) {
      return res.status(400).json({
        success: false,
        error: "Falta id del registro",
      });
    }

    const currentRegistro = await prisma.registros_terreno.findUnique({
      where: { id: registroId },
    });

    if (!currentRegistro) {
      return res.status(404).json({
        success: false,
        error: "Registro no encontrado",
      });
    }

    if (!currentRegistro.carga_completa) {
      return res.status(409).json({
        success: false,
        error: "El registro todavía no tiene una fotografía guardada",
        code: "REGISTRO_INCOMPLETO",
      });
    }

    if (currentRegistro.estado !== EstadoRegistroTerreno.en_revision) {
      return res.status(400).json({
        success: false,
        error: "Solo se puede validar un registro en revisión",
      });
    }

    const transitioned = await prisma.$transaction(async (tx) => {
      const updated = await tx.registros_terreno.updateMany({
        where: {
          id: registroId,
          estado: EstadoRegistroTerreno.en_revision,
          carga_completa: true,
        },
        data: {
          estado: EstadoRegistroTerreno.validado,
          motivo_rechazo: null,
          fecha_rechazo: null,
          rechazado_por_id: null,
          devuelto_a_tecnico: false,
          updated_at: new Date(),
        },
      });
      if (updated.count !== 1) return false;

      await tx.procesamiento_ingenieria.upsert({
        where: { registro_terreno_id: registroId },
        create: {
          registro_terreno_id: registroId,
          usuario_id: req.user!.id,
          codigo: currentRegistro.codigo_beck,
          total_sellos_calculado: currentRegistro.cantidad_final,
          notas: notas || null,
        },
        update: {
          usuario_id: req.user!.id,
          codigo: currentRegistro.codigo_beck,
          total_sellos_calculado: currentRegistro.cantidad_final,
          notas: notas || undefined,
          procesado_at: new Date(),
        },
      });
      return true;
    });
    if (!transitioned) {
      return res.status(409).json({
        success: false,
        error: "El registro cambió de estado mientras se validaba",
        code: "ESTADO_CONFLICTO",
      });
    }

    const registro = await findRegistroWithDetails(registroId);

    return res.json({
      success: true,
      data: mapRegistroIngenieria(registro),
      message: "Registro validado",
    });
  } catch (error) {
    console.error("VALIDAR REGISTRO INGENIERIA ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudo validar el registro",
    });
  }
}

export async function rechazarRegistroIngenieria(req: Request, res: Response) {
  try {
    if (!ensureIngenieria(req, res)) return;

    const registroId = getParamValue(req.params.id);
    const motivoRechazo =
      normalizeText(req.body?.motivoRechazo) ||
      normalizeText(req.body?.motivo_rechazo);

    if (!registroId) {
      return res.status(400).json({
        success: false,
        error: "Falta id del registro",
      });
    }

    if (!motivoRechazo) {
      return res.status(400).json({
        success: false,
        error: "Debes ingresar el motivo del rechazo",
      });
    }

    const currentRegistro = await prisma.registros_terreno.findUnique({
      where: { id: registroId },
    });

    if (!currentRegistro) {
      return res.status(404).json({
        success: false,
        error: "Registro no encontrado",
      });
    }

    if (!currentRegistro.carga_completa) {
      return res.status(409).json({
        success: false,
        error: "El registro todavía no tiene una fotografía guardada",
        code: "REGISTRO_INCOMPLETO",
      });
    }

    if (currentRegistro.estado !== EstadoRegistroTerreno.en_revision) {
      return res.status(400).json({
        success: false,
        error: "Solo se puede rechazar un registro en revisión",
      });
    }

    const isJuntaLineal =
      currentRegistro.tipo_registro === "junta_lineal_espuma";
    const calcResult = isJuntaLineal
      ? null
      : await calcularCamposConConfiguracion(currentRegistro.obra_id, {
          cantidad_sellos: currentRegistro.cantidad_sellos,
          holgura: Number(currentRegistro.holgura),
          accesibilidad: currentRegistro.accesibilidad ?? 1,
          aislacion: currentRegistro.aislacion,
          reparacion_tabique: currentRegistro.reparacion_tabique,
          piso: currentRegistro.piso,
          tipoRegistro: currentRegistro.tipo_registro,
        });

    const result = await prisma.$transaction(async (tx) => {
      const rejected = await tx.registros_terreno.updateMany({
        where: {
          id: registroId,
          estado: EstadoRegistroTerreno.en_revision,
          carga_completa: true,
        },
        data: {
          estado: EstadoRegistroTerreno.rechazado,
          motivo_rechazo: motivoRechazo,
          fecha_rechazo: new Date(),
          rechazado_por_id: req.user!.id,
          devuelto_a_tecnico: false,
          factor_por_holguras: calcResult?.factor_por_holguras ?? null,
          cantidad_sellos_con_factores:
            calcResult?.cantidad_sellos_con_factores ?? null,
          aislacion: calcResult?.aislacion_normalizada ?? null,
          cantidad_sellos_aislacion:
            calcResult?.cantidad_sellos_aislacion ?? null,
          reparacion_tabique:
            calcResult?.reparacion_tabique_normalizada ?? null,
          cantidad_final: calcResult?.cantidad_final ?? null,
          updated_at: new Date(),
        },
      });
      if (rejected.count !== 1) return null;

      const copia = await tx.registros_terreno.create({
        data: {
          obra_id: currentRegistro.obra_id,
          usuario_id: currentRegistro.usuario_id,
          fecha: currentRegistro.fecha,
          dia_semana: currentRegistro.dia_semana,
          descripcion_material: currentRegistro.descripcion_material,
          modulo: currentRegistro.modulo,
          piso: currentRegistro.piso,
          eje_numerico: currentRegistro.eje_numerico,
          eje_alfabetico: currentRegistro.eje_alfabetico,
          numero_sello: currentRegistro.numero_sello,
          cantidad_sellos: currentRegistro.cantidad_sellos,
          nombre_sellador: currentRegistro.nombre_sellador,
          holgura: currentRegistro.holgura,
          observaciones: currentRegistro.observaciones,
          fotos_urls: currentRegistro.fotos_urls,
          estado: EstadoRegistroTerreno.pendiente,
          metros_lineales: currentRegistro.metros_lineales,
          tipo_registro: currentRegistro.tipo_registro,
          devuelto_a_tecnico: false,
          corregido_at: null,
          codigo_beck: currentRegistro.codigo_beck,
          itemizado_mandante_id: currentRegistro.itemizado_mandante_id,
          itemizado_beck: currentRegistro.itemizado_beck,
          itemizado_mandante: currentRegistro.itemizado_mandante,
          foto_url: currentRegistro.foto_url,
          recinto: currentRegistro.recinto,
          factor_por_holguras: calcResult?.factor_por_holguras ?? null,
          accesibilidad: currentRegistro.accesibilidad,
          cantidad_sellos_con_factores:
            calcResult?.cantidad_sellos_con_factores ?? null,
          aislacion: calcResult?.aislacion_normalizada ?? null,
          cantidad_sellos_aislacion:
            calcResult?.cantidad_sellos_aislacion ?? null,
          reparacion_tabique:
            calcResult?.reparacion_tabique_normalizada ?? null,
          cantidad_final: calcResult?.cantidad_final ?? null,
          folio: currentRegistro.folio,
          es_correccion: true,
          registro_origen_id: registroId,
          enviado_ingenieria_por_id: currentRegistro.enviado_ingenieria_por_id,
          enviado_ingenieria_at: currentRegistro.enviado_ingenieria_at,
        },
      });

      await tx.procesamiento_ingenieria.upsert({
        where: { registro_terreno_id: registroId },
        create: {
          registro_terreno_id: registroId,
          usuario_id: req.user!.id,
          notas: motivoRechazo,
        },
        update: {
          usuario_id: req.user!.id,
          notas: motivoRechazo,
          procesado_at: new Date(),
        },
      });

      return { copia };
    });
    if (!result) {
      return res.status(409).json({
        success: false,
        error: "El registro cambió de estado mientras se rechazaba",
        code: "ESTADO_CONFLICTO",
      });
    }

    const registro = await findRegistroWithDetails(registroId);

    return res.json({
      success: true,
      data: {
        registro: mapRegistroIngenieria(registro),
        correccionId: result.copia.id,
      },
      message: "Registro rechazado y copia creada para corrección",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CORREGIR HOLGURA") {
      return res.status(400).json({
        success: false,
        error: "CORREGIR HOLGURA",
      });
    }

    console.error("RECHAZAR REGISTRO INGENIERIA ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudo rechazar el registro",
    });
  }
}

export async function getIngenieriaRegistroById(req: Request, res: Response) {
  try {
    if (!ensureIngenieria(req, res)) return;

    const registroId = getParamValue(req.params.id);

    if (!registroId) {
      return res.status(400).json({ success: false, error: "Falta id del registro" });
    }

    const registro = await findRegistroWithDetails(registroId);

    if (!registro) {
      return res.status(404).json({ success: false, error: "Registro no encontrado" });
    }

    return res.json({ success: true, data: mapRegistroIngenieria(registro) });
  } catch (error) {
    console.error("GET INGENIERIA REGISTRO BY ID ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudo obtener el registro" });
  }
}

export async function marcarInspeccionIngenieria(req: Request, res: Response) {
  try {
    if (!ensureIngenieria(req, res)) return;

    const registroId = getParamValue(req.params.id);
    const seleccionado = req.body?.seleccionadoParaInspeccion;

    if (!registroId) {
      return res.status(400).json({ success: false, error: "Falta id del registro" });
    }

    if (typeof seleccionado !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "seleccionadoParaInspeccion debe ser true o false",
      });
    }

    const existing = await prisma.registros_terreno.findUnique({ where: { id: registroId } });

    if (!existing) {
      return res.status(404).json({ success: false, error: "Registro no encontrado" });
    }

    await prisma.registros_terreno.update({
      where: { id: registroId },
      data: {
        seleccionado_para_inspeccion: seleccionado,
        seleccionado_inspeccion_por_id: seleccionado ? req.user!.id : null,
        fecha_seleccion_inspeccion: seleccionado ? new Date() : null,
        updated_at: new Date(),
      },
    });

    const registro = await findRegistroWithDetails(registroId);

    return res.json({ success: true, data: mapRegistroIngenieria(registro) });
  } catch (error) {
    console.error("MARCAR INSPECCION ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudo actualizar la inspección" });
  }
}

export async function getControlInspeccion(req: Request, res: Response) {
  try {
    if (!ensureIngenieria(req, res)) return;

    const registroId = getParamValue(req.params.id);

    if (!registroId) {
      return res.status(400).json({ success: false, error: "Falta id del registro" });
    }

    const control = await prisma.controles_inspeccion.findFirst({
      where: { registro_terreno_id: registroId },
      include: {
        controles_inspeccion_parametros: {
          orderBy: { orden: "asc" },
          include: { fotos_correccion_parametro: true },
        },
        usuarios: {
          select: { id: true, nombre: true, email: true },
        },
        fotos_control_inspeccion: {
          orderBy: { created_at: "asc" },
        },
      },
      orderBy: { created_at: "desc" },
    });

    if (!control) {
      return res.status(404).json({ success: false, error: "Control de inspección no encontrado" });
    }

    return res.json({ success: true, data: mapControlPrivatePhotos(control) });
  } catch (error) {
    console.error("GET CONTROL INSPECCION ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudo obtener el control de inspección" });
  }
}

const PARAMETROS_RESULTADO_VALUES = new Set<string>(["cumple", "no_cumple", "no_aplica"]);
const CONFORMIDAD_VALUES = new Set<string>(["conforme", "no_conforme"]);

export async function createControlInspeccion(req: Request, res: Response) {
  try {
    if (!ensureIngenieria(req, res)) return;

    const registroId = getParamValue(req.params.id);

    if (!registroId) {
      return res.status(400).json({ success: false, error: "Falta id del registro" });
    }

    const existing = await prisma.registros_terreno.findUnique({
      where: { id: registroId },
      include: {
        controles_inspeccion: {
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: "Registro no encontrado" });
    }

    const { fecha, ensayo, observacion, conformidad, parametros } = req.body ?? {};
    const parsedFecha = new Date(fecha);

    if (!fecha || Number.isNaN(parsedFecha.getTime())) {
      return res.status(400).json({ success: false, error: "La fecha es requerida" });
    }

    if (
      !existing.seleccionado_para_inspeccion ||
      !(new Set<EstadoRegistroTerreno>([
        EstadoRegistroTerreno.validado,
        EstadoRegistroTerreno.en_revision,
      ])).has(existing.estado)
    ) {
      return res.status(409).json({
        success: false,
        error: "El registro no está habilitado para control de inspección",
        code: "REGISTRO_NO_HABILITADO",
      });
    }

    if (existing.controles_inspeccion.length) {
      return res.status(409).json({
        success: false,
        error: "El registro ya tiene un control de inspección",
        code: "CONTROL_EXISTENTE",
      });
    }

    if (!ensayo || !normalizeText(ensayo)) {
      return res.status(400).json({ success: false, error: "El ensayo es requerido" });
    }

    if (!CONFORMIDAD_VALUES.has(conformidad)) {
      return res.status(400).json({ success: false, error: "La conformidad es requerida" });
    }

    if (!Array.isArray(parametros) || parametros.length === 0 || parametros.length > 50) {
      return res.status(400).json({
        success: false,
        error: "Debes informar entre 1 y 50 parámetros de inspección",
      });
    }

    const parsedParametros: {
      orden: number;
      parametro: string;
      resultado: ResultadoParametroInspeccion;
      observacion?: string;
    }[] = [];

    if (Array.isArray(parametros)) {
      for (let i = 0; i < parametros.length; i++) {
        const p = parametros[i];
        if (!p.parametro || !p.resultado) {
          return res.status(400).json({
            success: false,
            error: `Parámetro ${i + 1}: parametro y resultado son requeridos`,
          });
        }
        if (!PARAMETROS_RESULTADO_VALUES.has(p.resultado)) {
          return res.status(400).json({
            success: false,
            error: `Parámetro ${i + 1}: resultado no válido`,
          });
        }
        parsedParametros.push({
          orden: p.orden ?? i + 1,
          parametro: normalizeText(p.parametro),
          resultado: p.resultado as ResultadoParametroInspeccion,
          observacion: p.observacion ? normalizeText(p.observacion) : undefined,
        });
      }
    }

    const tieneNoCumple = parsedParametros.some((p) => p.resultado === "no_cumple");
    if (
      (conformidad === "conforme" && tieneNoCumple) ||
      (conformidad === "no_conforme" && !tieneNoCumple)
    ) {
      return res.status(400).json({
        success: false,
        error: "La conformidad no coincide con el resultado de los parámetros",
      });
    }

    const control = await prisma.controles_inspeccion.create({
        data: {
          registro_terreno_id: registroId,
          ingeniero_id: req.user!.id,
          fecha: parsedFecha,
          ensayo: normalizeText(ensayo),
          observacion: observacion ? normalizeText(observacion) : null,
          conformidad: conformidad as EstadoConformidadInspeccion,
          controles_inspeccion_parametros: {
            create: parsedParametros,
          },
        },
        include: {
          controles_inspeccion_parametros: {
            orderBy: { orden: "asc" },
            include: { fotos_correccion_parametro: true },
          },
          usuarios: { select: { id: true, nombre: true, email: true } },
          fotos_control_inspeccion: true,
        },
      });

    return res.status(201).json({ success: true, data: control });
  } catch (error) {
    console.error("CREATE CONTROL INSPECCION ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudo crear el control de inspección" });
  }
}

export async function uploadControlInspeccionFotos(req: Request, res: Response) {
  try {
    if (!ensureIngenieria(req, res)) return;

    const registroId = getParamValue(req.params.id);
    const controlId = getParamValue(req.params.controlId);
    const userId = req.user!.id;
    const files = req.files as Express.Multer.File[] | undefined;

    if (!registroId || !controlId) {
      return res.status(400).json({ success: false, error: "Falta id del registro o del control" });
    }

    if (!files || files.length < MIN_CONTROL_INSPECCION_FOTOS || files.length > MAX_CONTROL_INSPECCION_FOTOS) {
      return res.status(400).json({
        success: false,
        error: `Debes subir entre ${MIN_CONTROL_INSPECCION_FOTOS} y ${MAX_CONTROL_INSPECCION_FOTOS} fotografías`,
      });
    }

    const control = await prisma.controles_inspeccion.findUnique({
      where: { id: controlId },
      include: {
        registros_terreno: {
          include: { obras: { select: { codigo: true } } },
        },
      },
    });

    if (!control || control.registro_terreno_id !== registroId) {
      return res.status(404).json({ success: false, error: "Control de inspección no encontrado" });
    }

    const existingPhotoCount = await prisma.fotos_control_inspeccion.count({
      where: { control_inspeccion_id: controlId },
    });
    if (existingPhotoCount > 0) {
      return res.status(409).json({
        success: false,
        error: "El control de inspección ya fue finalizado",
        code: "CONTROL_FINALIZADO",
      });
    }

    const registro = control.registros_terreno;
    const folder = buildCloudinaryFolder(
      registro.obras?.codigo || registro.obra_id || "sin-obra",
      new Date(registro.fecha),
      registro.piso,
      registro.nombre_sellador,
      "control-inspeccion"
    );

    const uploadedResults: {
      secure_url: string;
      public_id: string;
      format: string;
      bytes: number;
      originalname: string;
    }[] = [];

    try {
      for (const file of files) {
        const result = await uploadBufferToCloudinary(file.buffer, { folder });

        uploadedResults.push({
          secure_url: result.secure_url,
          public_id: result.public_id,
          format: result.format,
          bytes: result.bytes,
          originalname: file.originalname,
        });
      }

      const fotos = await prisma.$transaction(async (tx) => {
        const concurrentPhotoCount = await tx.fotos_control_inspeccion.count({
          where: { control_inspeccion_id: controlId },
        });
        if (concurrentPhotoCount > 0) {
          throw new Error("CONTROL_FINALIZADO");
        }

        const createdPhotos = await Promise.all(
          uploadedResults.map((uploaded) =>
            tx.fotos_control_inspeccion.create({
            data: {
              control_inspeccion_id: controlId,
              url: uploaded.secure_url,
              public_id: uploaded.public_id,
              nombre_archivo: uploaded.originalname,
              formato: uploaded.format,
              bytes: uploaded.bytes,
              subido_por_id: userId,
            },
            }),
          ),
        );

        const registroUpdated = await tx.registros_terreno.updateMany({
          where: {
            id: registroId,
            seleccionado_para_inspeccion: true,
            estado: {
              in: [EstadoRegistroTerreno.validado, EstadoRegistroTerreno.en_revision],
            },
          },
          data:
            control.conformidad === "no_conforme"
              ? {
                  inspeccion_estado: "inspeccionado",
                  inspeccion_revision_estado: "rechazado",
                  inspeccion_revision_at: new Date(),
                  inspeccion_revision_por_id: userId,
                }
              : {
                  inspeccion_estado: "inspeccionado",
                  inspeccion_revision_estado: "validado",
                  inspeccion_revision_at: new Date(),
                  inspeccion_revision_por_id: userId,
                  motivo_rechazo_inspeccion: null,
                },
        });
        if (registroUpdated.count !== 1) {
          throw new Error("REGISTRO_NO_HABILITADO");
        }

        return createdPhotos;
      });

      return res.status(201).json({
        success: true,
        data: fotos.map(withPrivateImageUrl),
      });
    } catch (uploadError) {
      await Promise.allSettled(
        uploadedResults.map((foto) => deleteImageFromCloudinary(foto.public_id))
      );

      if (uploadError instanceof Error && uploadError.message === "CONTROL_FINALIZADO") {
        return res.status(409).json({
          success: false,
          error: "El control de inspección ya fue finalizado",
          code: uploadError.message,
        });
      }
      if (uploadError instanceof Error && uploadError.message === "REGISTRO_NO_HABILITADO") {
        return res.status(409).json({
          success: false,
          error: "El registro dejó de estar habilitado para inspección",
          code: uploadError.message,
        });
      }
      throw uploadError;
    }
  } catch (error) {
    console.error("UPLOAD CONTROL INSPECCION FOTOS ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudieron subir las fotografías" });
  }
}
