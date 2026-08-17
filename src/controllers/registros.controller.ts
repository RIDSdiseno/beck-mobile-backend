import { Request, Response } from "express";
import { EstadoObra, EstadoRegistroTerreno } from "@prisma/client";
import { prisma } from "../config/prisma";
import {
  deleteImageFromCloudinary,
  uploadBufferToCloudinary,
  withPrivateImageUrl,
} from "../services/cloudinary.service";
import {
  calcularCamposConConfiguracion,
  getFactoresAislacionObra,
} from "../services/calculosRegistroTerreno.service";
import {
  crearMapaVisibilidad,
  obtenerConfiguracionRegistro,
} from "../services/configuracionCamposRegistro.service";
import { eliminarRegistroIncompleto } from "../services/registrosIncompletos.service";
import { canAccessObra } from "../services/obras.service";
import { normalizarHolguraMovil } from "../utils/normalizarHolguraMovil";
import { resolveEstadoAislacionDesdeFactor } from "../utils/calculosRegistroTerreno";

function getDiaSemana(fecha: Date) {
  const dias = [
    "domingo",
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
  ];

  return dias[fecha.getDay()];
}

export function sanitizeCloudinaryFolderSegment(value: string | null | undefined) {
  const sanitized = String(value || "")
    .trim()
    .replace(/[\/\\]+/g, "-")
    .replace(/\s+/g, " ");

  return sanitized || "sin-nombre";
}

export function buildCloudinaryFolder(
  codigoObra: string,
  fecha: Date,
  piso: string | null | undefined,
  nombreSellador: string | null | undefined,
  subfolder: string = "registros"
) {
  const year = String(fecha.getFullYear());
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const dd = String(fecha.getDate()).padStart(2, "0");
  const obraSegment = sanitizeCloudinaryFolderSegment(codigoObra);
  const pisoSegment = sanitizeCloudinaryFolderSegment(`Piso ${piso || "sin-piso"}`);
  const selladorSegment = sanitizeCloudinaryFolderSegment(nombreSellador);

  return `BeckSoluciones/${year}/${obraSegment}/${pisoSegment}/${yyyy}-${mm}-${dd}/${selladorSegment}/${subfolder}`;
}

function getParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function parsePositiveInteger(value: unknown, fieldName: string) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return {
      value: null,
      error: `${fieldName} debe ser un número entero mayor a 0`,
    };
  }

  return { value: parsed, error: null };
}

function parseNonNegativeNumber(value: unknown, fieldName: string) {
  const parsed = Number(String(value).replace(",", "."));

  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      value: null,
      error: `${fieldName} debe ser un número mayor o igual a 0`,
    };
  }

  return { value: parsed, error: null };
}

function parsePositiveNumber(value: unknown, fieldName: string) {
  const parsed = Number(String(value).replace(",", "."));

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      value: null,
      error: `${fieldName} debe ser un número mayor a 0`,
    };
  }

  return { value: parsed, error: null };
}

function parseOptionalNonNegativeNumber(value: unknown, fieldName: string) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { value: null, error: null };
  }

  return parseNonNegativeNumber(value, fieldName);
}

function parseAccesibilidadNivel(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
    return {
      value: null,
      error: "accesibilidad debe ser 0 (No aplica) o uno de los niveles 1, 2 o 3",
    };
  }

  return { value: parsed, error: null };
}

function normalizarEstadoAislacionMovil(value: number | null) {
  if (value === 1) return true;
  if (value === 0) return false;
  return value;
}

function isAdmin(role: string | undefined) {
  return role === "administrador";
}

async function seguimientoSupervisorDisponible() {
  const columnas = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'registros_terreno'
      AND column_name IN ('enviado_ingenieria_at', 'enviado_ingenieria_por_id')
  `;

  return columnas.length === 2;
}

async function canModifyRegistro(
  userId: string,
  role: string | undefined,
  registro: { usuario_id: string; obra_id: string }
) {
  if (isAdmin(role)) return true;
  if (registro.usuario_id === userId) return true;
  if (role !== "jefeobra") return false;

  return canAccessObra(userId, role, registro.obra_id);
}

export async function createRegistro(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.rol;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    if (!["terreno", "jefeobra", "administrador"].includes(userRole || "")) {
      return res.status(403).json({
        success: false,
        error: "Tu rol no puede crear registros de terreno",
      });
    }

    const {
      obraId,
      fecha,
      descripcionMaterial,
      itemizadoBeck,
      recinto,
      moduloEdificio,
      modulo,
      piso,
      ejeNumerico,
      ejeAlfabetico,
      numeroSello,
      cantidadSellos,
      nombreSellador,
      holgura,
      accesibilidad,
      cieloModular,
      aislacion,
      reparacionTabique,
      folio,
      observaciones,
      itemizadoSacyr,
      tipoRegistro,
      metrosLineales,
    } = req.body ?? {};
    const normalizedTipoRegistro = normalizeText(tipoRegistro) || "sello_cortafuego";
    const isJuntaLineal = normalizedTipoRegistro === "junta_lineal_espuma";
    const normalizedModuloInput = normalizeText(moduloEdificio) || normalizeText(modulo);
    const normalizedRecintoInput = normalizeText(recinto) || normalizeText(modulo);
    const normalizedItemizadoBeck =
      normalizeText(itemizadoBeck) || normalizeText(descripcionMaterial);

    if (!["sello_cortafuego", "junta_lineal_espuma"].includes(normalizedTipoRegistro)) {
      return res.status(400).json({
        success: false,
        error: "tipoRegistro no válido",
      });
    }

    const requiredFields = {
      obraId,
      fecha,
      piso,
      nombreSellador,
      ...(isJuntaLineal
        ? { metrosLineales }
        : {
            descripcionMaterial: normalizedItemizadoBeck,
            numeroSello,
            cantidadSellos,
          }),
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([, value]) => {
        if (value === undefined || value === null) return true;
        if (typeof value === "string" && value.trim() === "") return true;
        return false;
      })
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Faltan campos obligatorios: ${missingFields.join(", ")}`,
      });
    }

    const fechaDate = new Date(fecha);

    if (Number.isNaN(fechaDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: "La fecha es inválida",
      });
    }

    const obra = await prisma.obras.findUnique({
      where: { id: String(obraId) },
      select: { id: true, estado: true },
    });

    if (!obra) {
      return res.status(404).json({
        success: false,
        error: "Obra no encontrada",
      });
    }

    const hasObraAccess = await canAccessObra(userId, userRole, obra.id);

    if (!hasObraAccess) {
      return res.status(403).json({
        success: false,
        error:
          obra.estado === EstadoObra.inactiva || obra.estado === EstadoObra.finalizada
            ? "Esta obra no permite registros mientras este inactiva o finalizada"
            : "No tienes permisos para registrar información en esta obra",
      });
    }

    const rolConfiguracion = userRole === "terreno" ? "trabajador" : "jefeobra";
    const configuracion = await obtenerConfiguracionRegistro(
      obra.id,
      rolConfiguracion,
    );
    const visibilidad = crearMapaVisibilidad(configuracion);
    const esVisible = (campo: string) => visibilidad.get(campo) ?? true;

    const normalizedModulo = esVisible("modulo")
      ? normalizedModuloInput
      : "No aplica";
    const normalizedRecinto = esVisible("recinto")
      ? normalizedRecintoInput
      : "";
    const ejeNumericoEfectivo = esVisible("eje_numerico")
      ? normalizeText(ejeNumerico)
      : "No aplica";
    const ejeAlfabeticoEfectivo = esVisible("eje_alfabetico")
      ? normalizeText(ejeAlfabetico)
      : "N/A";
    const holguraInput = isJuntaLineal || !esVisible("holgura") ? 0 : holgura;
    const accesibilidadInput =
      isJuntaLineal || !esVisible("accesibilidad")
        ? 0
        : accesibilidad ?? cieloModular;
    const aislacionInput =
      isJuntaLineal || !esVisible("aislacion") ? null : aislacion;
    const reparacionTabiqueInput =
      isJuntaLineal || !esVisible("reparacion_tabique")
        ? null
        : reparacionTabique;

    const requiredConfiguredFields = {
      ...(esVisible("modulo") ? { modulo: normalizedModulo } : {}),
      ...(esVisible("eje_numerico") ? { ejeNumerico: ejeNumericoEfectivo } : {}),
      ...(esVisible("eje_alfabetico") ? { ejeAlfabetico: ejeAlfabeticoEfectivo } : {}),
      ...(!isJuntaLineal && esVisible("holgura") ? { holgura: holguraInput } : {}),
      ...(!isJuntaLineal && esVisible("accesibilidad")
        ? { accesibilidad: accesibilidadInput }
        : {}),
      ...(!isJuntaLineal && esVisible("aislacion") ? { aislacion: aislacionInput } : {}),
      ...(!isJuntaLineal && esVisible("reparacion_tabique")
        ? { reparacionTabique: reparacionTabiqueInput }
        : {}),
    };
    const missingConfiguredFields = Object.entries(requiredConfiguredFields)
      .filter(([, value]) => {
        if (value === undefined || value === null) return true;
        return typeof value === "string" && value.trim() === "";
      })
      .map(([key]) => key);
    if (missingConfiguredFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Faltan campos obligatorios: ${missingConfiguredFields.join(", ")}`,
      });
    }

    const cantidadSellosParsed = isJuntaLineal
      ? { value: 1, error: null }
      : parsePositiveInteger(cantidadSellos, "cantidadSellos");
    const holguraParsed = isJuntaLineal
      ? { value: 0, error: null }
      : parseNonNegativeNumber(normalizarHolguraMovil(holguraInput), "holgura");
    const accesibilidadParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseAccesibilidadNivel(accesibilidadInput);
    const metrosLinealesParsed = isJuntaLineal
      ? parsePositiveNumber(metrosLineales, "longitud")
      : { value: null, error: null };
    const aislacionParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(aislacionInput, "aislacion");
    const reparacionTabiqueParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(reparacionTabiqueInput, "reparacionTabique");
    const numericErrors = [
      cantidadSellosParsed.error,
      holguraParsed.error,
      accesibilidadParsed.error,
      metrosLinealesParsed.error,
      aislacionParsed.error,
      reparacionTabiqueParsed.error,
    ].filter(Boolean);

    if (numericErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: numericErrors.join(". "),
      });
    }

    const calcResult = isJuntaLineal
      ? null
      : await calcularCamposConConfiguracion(obra.id, {
          cantidad_sellos: cantidadSellosParsed.value!,
          holgura: holguraParsed.value!,
          accesibilidad: accesibilidadParsed.value ?? 1,
          aislacion: normalizarEstadoAislacionMovil(aislacionParsed.value),
          reparacion_tabique: reparacionTabiqueParsed.value,
          piso: normalizeText(piso),
          tipoRegistro: normalizedTipoRegistro,
        });

    const registro = await prisma.registros_terreno.create({
      data: {
        obra_id: obra.id,
        usuario_id: userId,
        fecha: fechaDate,
        dia_semana: getDiaSemana(fechaDate),
        descripcion_material: isJuntaLineal
          ? "Junta Lineal Espuma"
          : normalizedItemizadoBeck,
        itemizado_beck: isJuntaLineal ? null : normalizedItemizadoBeck,
        modulo: normalizedModulo,
        recinto: normalizedRecinto || null,
        piso: normalizeText(piso),
        eje_numerico: ejeNumericoEfectivo,
        eje_alfabetico: ejeAlfabeticoEfectivo,
        numero_sello: isJuntaLineal ? "N/A" : normalizeText(numeroSello),
        cantidad_sellos: cantidadSellosParsed.value!,
        nombre_sellador: normalizeText(nombreSellador),
        holgura: holguraParsed.value!,
        factor_por_holguras: calcResult?.factor_por_holguras ?? null,
        accesibilidad:
          !isJuntaLineal && accesibilidadInput !== undefined
            ? accesibilidadParsed.value
            : null,
        cantidad_sellos_con_factores:
          calcResult?.cantidad_sellos_con_factores ?? null,
        aislacion: calcResult?.aislacion_normalizada ?? null,
        cantidad_sellos_aislacion:
          calcResult?.cantidad_sellos_aislacion ?? null,
        reparacion_tabique:
          calcResult?.reparacion_tabique_normalizada ?? null,
        cantidad_final: calcResult?.cantidad_final ?? null,
        observaciones: normalizeText(observaciones) || null,
        folio: esVisible("folio") ? normalizeText(folio) || null : null,
        fotos_urls: [],
        carga_completa: false,
        estado: "pendiente",
        devuelto_a_tecnico: false,
        itemizado_mandante: isJuntaLineal || !esVisible("itemizadoMandante")
          ? null
          : normalizeText(itemizadoSacyr) || null,
        metros_lineales: isJuntaLineal ? metrosLinealesParsed.value! : null,
        tipo_registro: normalizedTipoRegistro,
      },
    });

    return res.status(201).json({
      success: true,
      data: registro,
      message: "Registro creado correctamente",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CORREGIR HOLGURA") {
      return res.status(400).json({
        success: false,
        error: "CORREGIR HOLGURA",
      });
    }

    console.error("CREATE REGISTRO ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudo crear el registro",
    });
  }
}

export async function getMisRegistros(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.rol;
    const obraId = typeof req.query.obraId === "string" ? req.query.obraId : undefined;
    const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
    const scope = typeof req.query.scope === "string" ? req.query.scope : undefined;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    const ESTADOS_VALIDOS = Object.values(EstadoRegistroTerreno);

    if (estado && !ESTADOS_VALIDOS.includes(estado as EstadoRegistroTerreno)) {
      return res.status(400).json({
        success: false,
        error: `Estado no válido. Valores aceptados: ${ESTADOS_VALIDOS.join(", ")}`,
      });
    }

    const visibilidadTerreno = {
      OR: [
        { es_correccion: false },
        { es_correccion: true, devuelto_a_tecnico: true },
        { es_correccion: true, corregido_at: { not: null } },
        { estado: { not: EstadoRegistroTerreno.pendiente } },
      ],
    };
    const where =
      userRole === "jefeobra"
        ? {
            carga_completa: true,
            ...(scope === "historial"
              ? { enviado_ingenieria_por_id: userId }
              : {}),
            ...(obraId ? { obra_id: obraId } : {}),
            ...(estado ? { estado: estado as EstadoRegistroTerreno } : {}),
            obras: {
              estado: {
                in: [EstadoObra.activa, EstadoObra.pausada],
              },
            },
            usuarios: {
              rol: "terreno" as const,
            },
          }
        : {
            carga_completa: true,
            usuario_id: userId,
            ...(estado ? { estado: estado as EstadoRegistroTerreno } : {}),
            ...(userRole === "terreno" ? { AND: [visibilidadTerreno] } : {}),
            ...(scope === "registro"
              ? {
                  OR: [
                    {
                      estado: "pendiente" as const,
                      es_correccion: false,
                    },
                    {
                      estado: "pendiente" as const,
                      es_correccion: true,
                      devuelto_a_tecnico: true,
                    },
                    {
                      estado: "pendiente" as const,
                      es_correccion: true,
                      corregido_at: { not: null },
                    },
                    {
                      estado: "rechazado" as const,
                      devuelto_a_tecnico: true,
                    },
                  ],
                }
              : {}),
          };

    const registros = await prisma.registros_terreno.findMany({
      where,
      orderBy: {
        created_at: "desc",
      },
      take: 100,
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
        usuarios_registros_terreno_rechazado_por_idTousuarios: {
          select: {
            id: true,
            nombre: true,
            email: true,
            rol: true,
          },
        },
        registros_terreno: {
          select: {
            id: true,
            estado: true,
            numero_sello: true,
            descripcion_material: true,
            motivo_rechazo: true,
            fecha_rechazo: true,
            foto_url: true,
            fotos_urls: true,
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
          },
        },
      },
    });

    const factoresAislacionPorObra = new Map(
      await Promise.all(
        [...new Set(registros.map((registro) => registro.obra_id))].map(
          async (id) => [id, await getFactoresAislacionObra(id)] as const,
        ),
      ),
    );

    const normalizeRegistroFotos = (registro: {
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
    }) => {
      const relationFotos = (registro.fotos || []).filter((foto) => foto.url);
      const fallbackUrls =
        relationFotos.length > 0
          ? []
          : [
              ...(Array.isArray(registro.fotos_urls) ? registro.fotos_urls : []),
              registro.foto_url,
            ].filter((url): url is string => Boolean(url));

      const seen = new Set<string>();
      const normalized = [
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

      return normalized;
    };

    return res.json({
      success: true,
      data: registros.map((registro) => {
        const registroOrigen = registro.registros_terreno
          ? {
              ...registro.registros_terreno,
              fotos: normalizeRegistroFotos(registro.registros_terreno),
            }
          : null;

        return {
          ...registro,
          aislacion_aplica: resolveEstadoAislacionDesdeFactor(
            registro.aislacion,
            factoresAislacionPorObra.get(registro.obra_id),
          ),
          fotos: normalizeRegistroFotos(registro),
          rechazado_por:
            registro.usuarios_registros_terreno_rechazado_por_idTousuarios,
          registro_origen: registroOrigen,
        };
      }),
    });
  } catch (error) {
    console.error("GET MIS REGISTROS ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudieron obtener los registros",
    });
  }
}

export async function getResumenSupervisor(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.rol;
    const tipoRegistro =
      typeof req.query.tipoRegistro === "string"
        ? req.query.tipoRegistro
        : "sello_cortafuego";

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    if (userRole !== "jefeobra" && !isAdmin(userRole)) {
      return res.status(403).json({
        success: false,
        error: "Solo jefe de obra puede consultar este resumen",
      });
    }

    if (!["sello_cortafuego", "junta_lineal_espuma"].includes(tipoRegistro)) {
      return res.status(400).json({
        success: false,
        error: "tipoRegistro no válido",
      });
    }

    const baseWhere = {
      carga_completa: true,
      tipo_registro: tipoRegistro,
      obras: {
        estado: {
          in: [EstadoObra.activa, EstadoObra.pausada],
        },
      },
      usuarios: {
        rol: "terreno" as const,
      },
    };
    const now = new Date();
    const inicioMes = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const seguimientoPersonalDisponible = await seguimientoSupervisorDisponible();

    const [pendientesRevision, rechazadosIngenieria] = await prisma.$transaction([
      prisma.registros_terreno.count({
        where: {
          ...baseWhere,
          estado: EstadoRegistroTerreno.pendiente,
          devuelto_a_tecnico: false,
          OR: [
            { es_correccion: false },
            { es_correccion: true, corregido_at: { not: null } },
          ],
        },
      }),
      prisma.registros_terreno.count({
        where: {
          ...baseWhere,
          estado: EstadoRegistroTerreno.pendiente,
          es_correccion: true,
          corregido_at: null,
        },
      }),
    ]);

    let enRevisionIngenieria: number | null = null;
    let validadosIngenieria: number | null = null;
    let enviadosMes: number | null = null;
    let correccionesReenviadasMes: number | null = null;

    if (seguimientoPersonalDisponible) {
      [
        enRevisionIngenieria,
        validadosIngenieria,
        enviadosMes,
        correccionesReenviadasMes,
      ] = await prisma.$transaction([
        prisma.registros_terreno.count({
        where: {
          ...baseWhere,
          estado: EstadoRegistroTerreno.en_revision,
          enviado_ingenieria_por_id: userId,
        },
        }),
        prisma.registros_terreno.count({
        where: {
          ...baseWhere,
          estado: EstadoRegistroTerreno.validado,
          enviado_ingenieria_por_id: userId,
        },
        }),
        prisma.registros_terreno.count({
        where: {
          ...baseWhere,
          enviado_ingenieria_por_id: userId,
          enviado_ingenieria_at: { gte: inicioMes },
        },
        }),
        prisma.registros_terreno.count({
        where: {
          ...baseWhere,
          es_correccion: true,
          enviado_ingenieria_por_id: userId,
          enviado_ingenieria_at: { gte: inicioMes },
        },
        }),
      ]);
    }

    return res.json({
      success: true,
      data: {
        pendientesRevision,
        rechazadosIngenieria,
        enRevisionIngenieria,
        validadosIngenieria,
        enviadosMes,
        correccionesReenviadasMes,
        seguimientoPersonalDisponible,
      },
    });
  } catch (error) {
    console.error("GET RESUMEN SUPERVISOR ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudo obtener el resumen del supervisor",
    });
  }
}

export async function updateRegistroTecnico(req: Request, res: Response) {
  try {
    const registroId = getParamValue(req.params.id);
    const userId = req.user?.id;
    const userRole = req.user?.rol;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    if (!registroId) {
      return res.status(400).json({
        success: false,
        error: "Falta id del registro",
      });
    }

    if (userRole !== "terreno") {
      return res.status(403).json({
        success: false,
        error: "Solo el técnico terreno puede reenviar este registro",
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

    if (
      currentRegistro.estado === EstadoRegistroTerreno.validado ||
      currentRegistro.estado === EstadoRegistroTerreno.en_revision ||
      currentRegistro.validado_cliente
    ) {
      return res.status(409).json({
        success: false,
        error: "El registro ya está en revisión o validado y no puede modificarse",
        code: "REGISTRO_LOCKED",
      });
    }

    const isEditableCorrection =
      currentRegistro.estado === "rechazado" ||
      (currentRegistro.estado === "pendiente" &&
        currentRegistro.es_correccion &&
        currentRegistro.devuelto_a_tecnico);

    if (currentRegistro.usuario_id !== userId || !isEditableCorrection) {
      return res.status(403).json({
        success: false,
        error: "Solo puedes editar correcciones habilitadas propias",
      });
    }

    const hasObraAccess = await canAccessObra(userId, userRole, currentRegistro.obra_id);

    if (!hasObraAccess) {
      return res.status(403).json({
        success: false,
        error: "La obra del registro no esta disponible para reenviar",
      });
    }

    const camposVisibles = crearMapaVisibilidad(
      await obtenerConfiguracionRegistro(currentRegistro.obra_id, "trabajador")
    );
    const campoVisible = (campo: string) => camposVisibles.get(campo) === true;

    const {
      fecha,
      descripcionMaterial,
      itemizadoBeck,
      recinto,
      moduloEdificio,
      modulo,
      piso,
      ejeNumerico,
      ejeAlfabetico,
      numeroSello,
      cantidadSellos,
      nombreSellador,
      holgura,
      accesibilidad,
      cieloModular,
      aislacion,
      reparacionTabique,
      observaciones,
      itemizadoSacyr,
      tipoRegistro,
      metrosLineales,
    } = req.body ?? {};
    const recintoInput = campoVisible("recinto") ? recinto : undefined;
    const moduloEdificioInput = campoVisible("modulo") ? moduloEdificio : undefined;
    const moduloInput = campoVisible("modulo") ? modulo : undefined;
    const ejeNumericoInput = campoVisible("eje_numerico") ? ejeNumerico : undefined;
    const ejeAlfabeticoInput = campoVisible("eje_alfabetico") ? ejeAlfabetico : undefined;
    const holguraInput = campoVisible("holgura") ? holgura : undefined;
    const accesibilidadInput = campoVisible("accesibilidad")
      ? accesibilidad ?? cieloModular
      : undefined;
    const aislacionInput = campoVisible("aislacion") ? aislacion : undefined;
    const reparacionTabiqueInput = campoVisible("reparacion_tabique")
      ? reparacionTabique
      : undefined;
    const itemizadoMandanteInput = campoVisible("itemizadoMandante")
      ? itemizadoSacyr
      : undefined;

    const normalizedTipoRegistro =
      normalizeText(tipoRegistro) || currentRegistro.tipo_registro || "sello_cortafuego";
    const isJuntaLineal = normalizedTipoRegistro === "junta_lineal_espuma";

    if (!["sello_cortafuego", "junta_lineal_espuma"].includes(normalizedTipoRegistro)) {
      return res.status(400).json({
        success: false,
        error: "tipoRegistro no válido",
      });
    }

    const fechaDate =
      fecha === undefined || fecha === null || normalizeText(fecha) === ""
        ? currentRegistro.fecha
        : new Date(fecha);

    if (Number.isNaN(fechaDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: "La fecha es inválida",
      });
    }

    const cantidadSellosParsed = isJuntaLineal
      ? { value: 1, error: null }
      : parsePositiveInteger(cantidadSellos ?? currentRegistro.cantidad_sellos, "cantidadSellos");
    const holguraParsed = isJuntaLineal
      ? { value: 0, error: null }
      : parseNonNegativeNumber(
          normalizarHolguraMovil(holguraInput ?? currentRegistro.holgura),
          "holgura",
        );
    const accesibilidadParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseAccesibilidadNivel(
          accesibilidadInput ?? currentRegistro.accesibilidad,
        );
    const metrosLinealesParsed = isJuntaLineal
      ? parsePositiveNumber(metrosLineales ?? currentRegistro.metros_lineales, "longitud")
      : { value: null, error: null };
    const aislacionParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(aislacionInput, "aislacion");
    const reparacionTabiqueParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(reparacionTabiqueInput, "reparacionTabique");
    const numericErrors = [
      cantidadSellosParsed.error,
      holguraParsed.error,
      accesibilidadParsed.error,
      metrosLinealesParsed.error,
      aislacionParsed.error,
      reparacionTabiqueParsed.error,
    ].filter(Boolean);

    if (numericErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: numericErrors.join(". "),
      });
    }

    const pisoFinal = normalizeText(piso) || currentRegistro.piso;
    const accesibilidadFinal = isJuntaLineal
      ? null
      : accesibilidadInput !== undefined
        ? accesibilidadParsed.value
        : currentRegistro.accesibilidad;
    const aislacionFinal = isJuntaLineal
      ? null
      : aislacionInput !== undefined
        ? normalizarEstadoAislacionMovil(aislacionParsed.value)
        : currentRegistro.aislacion;
    const reparacionFinal = isJuntaLineal
      ? null
      : reparacionTabiqueInput !== undefined
        ? reparacionTabiqueParsed.value
        : currentRegistro.reparacion_tabique;
    const calcResult = isJuntaLineal
      ? null
      : await calcularCamposConConfiguracion(currentRegistro.obra_id, {
          cantidad_sellos: cantidadSellosParsed.value!,
          holgura: holguraParsed.value!,
          accesibilidad: accesibilidadFinal ?? 1,
          aislacion: aislacionFinal,
          reparacion_tabique: reparacionFinal,
          piso: pisoFinal,
          tipoRegistro: normalizedTipoRegistro,
        });

    const transition = await prisma.registros_terreno.updateMany({
      where: {
        id: registroId,
        estado: currentRegistro.estado,
        validado_cliente: false,
        carga_completa: true,
      },
      data: {
        fecha: fechaDate,
        dia_semana: getDiaSemana(fechaDate),
        descripcion_material: isJuntaLineal
          ? "Junta Lineal Espuma"
          : normalizeText(itemizadoBeck) ||
            normalizeText(descripcionMaterial) ||
            currentRegistro.itemizado_beck ||
            currentRegistro.descripcion_material,
        itemizado_beck: isJuntaLineal
          ? null
          : normalizeText(itemizadoBeck) ||
            normalizeText(descripcionMaterial) ||
            currentRegistro.itemizado_beck ||
            currentRegistro.descripcion_material,
        modulo:
          normalizeText(moduloEdificioInput) ||
          normalizeText(moduloInput) ||
          currentRegistro.modulo,
        recinto:
          normalizeText(recintoInput) || currentRegistro.recinto || currentRegistro.modulo,
        piso: pisoFinal,
        eje_numerico: normalizeText(ejeNumericoInput) || currentRegistro.eje_numerico,
        eje_alfabetico: normalizeText(ejeAlfabeticoInput) || currentRegistro.eje_alfabetico,
        numero_sello: isJuntaLineal
          ? "N/A"
          : normalizeText(numeroSello) || currentRegistro.numero_sello,
        cantidad_sellos: cantidadSellosParsed.value!,
        nombre_sellador: normalizeText(nombreSellador) || currentRegistro.nombre_sellador,
        holgura: holguraParsed.value!,
        factor_por_holguras: calcResult?.factor_por_holguras ?? null,
        accesibilidad: accesibilidadFinal,
        cantidad_sellos_con_factores:
          calcResult?.cantidad_sellos_con_factores ?? null,
        aislacion: calcResult?.aislacion_normalizada ?? null,
        cantidad_sellos_aislacion:
          calcResult?.cantidad_sellos_aislacion ?? null,
        reparacion_tabique:
          calcResult?.reparacion_tabique_normalizada ?? null,
        cantidad_final: calcResult?.cantidad_final ?? null,
        observaciones: normalizeText(observaciones) || null,
        itemizado_mandante: isJuntaLineal
          ? null
          : normalizeText(itemizadoMandanteInput) || currentRegistro.itemizado_mandante,
        metros_lineales: isJuntaLineal ? metrosLinealesParsed.value! : null,
        tipo_registro: normalizedTipoRegistro,
        estado: "pendiente",
        devuelto_a_tecnico: false,
        corregido_at: new Date(),
        updated_at: new Date(),
      },
    });
    if (transition.count !== 1) {
      return res.status(409).json({
        success: false,
        error: "El registro cambió de estado mientras se actualizaba",
        code: "ESTADO_CONFLICTO",
      });
    }
    const registro = await prisma.registros_terreno.findUniqueOrThrow({
      where: { id: registroId },
    });

    return res.json({
      success: true,
      data: registro,
      message: "Registro corregido y enviado al jefe de obra",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CORREGIR HOLGURA") {
      return res.status(400).json({
        success: false,
        error: "CORREGIR HOLGURA",
      });
    }

    console.error("UPDATE REGISTRO TECNICO ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudo reenviar el registro",
    });
  }
}

export async function devolverRegistroATecnico(req: Request, res: Response) {
  try {
    const registroId = getParamValue(req.params.id);
    const userId = req.user?.id;
    const userRole = req.user?.rol;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    if (!registroId) {
      return res.status(400).json({
        success: false,
        error: "Falta id del registro",
      });
    }

    if (userRole !== "jefeobra" && !isAdmin(userRole)) {
      return res.status(403).json({
        success: false,
        error: "Solo jefe de obra puede enviar registros al técnico",
      });
    }

    const currentRegistro = await prisma.registros_terreno.findUnique({
      where: { id: registroId },
      include: {
        usuarios: {
          select: {
            rol: true,
          },
        },
      },
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

    const esCorreccionPendienteSupervisor =
      currentRegistro.estado === EstadoRegistroTerreno.pendiente &&
      currentRegistro.es_correccion &&
      !currentRegistro.devuelto_a_tecnico;

    if (!esCorreccionPendienteSupervisor) {
      return res.status(400).json({
        success: false,
        error: "Solo se pueden enviar al operario correcciones pendientes del supervisor",
      });
    }

    if (userRole === "jefeobra") {
      const hasAccess = await canAccessObra(userId, userRole, currentRegistro.obra_id);

      if (!hasAccess || currentRegistro.usuarios.rol !== "terreno") {
        return res.status(403).json({
          success: false,
          error: "No tienes permisos para enviar este registro al técnico",
        });
      }
    }

    const transition = await prisma.registros_terreno.updateMany({
      where: {
        id: registroId,
        estado: EstadoRegistroTerreno.pendiente,
        es_correccion: true,
        devuelto_a_tecnico: false,
        carga_completa: true,
      },
      data: {
        devuelto_a_tecnico: true,
        corregido_at: null,
        updated_at: new Date(),
      },
    });
    if (transition.count !== 1) {
      return res.status(409).json({
        success: false,
        error: "El registro cambió de estado mientras se enviaba al técnico",
        code: "ESTADO_CONFLICTO",
      });
    }
    const registro = await prisma.registros_terreno.findUniqueOrThrow({
      where: { id: registroId },
    });

    return res.json({
      success: true,
      data: registro,
      message: "Registro disponible para corrección del técnico",
    });
  } catch (error) {
    console.error("DEVOLVER REGISTRO TECNICO ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudo enviar el registro al técnico",
    });
  }
}

export async function deleteRegistroPendiente(req: Request, res: Response) {
  try {
    const registroId = getParamValue(req.params.id);
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    if (!registroId) {
      return res.status(400).json({
        success: false,
        error: "Falta id del registro",
      });
    }

    const registro = await prisma.registros_terreno.findUnique({
      where: { id: registroId },
      include: {
        fotos: {
          select: {
            public_id: true,
          },
        },
      },
    });

    if (!registro) {
      return res.status(404).json({
        success: false,
        error: "Registro no encontrado",
      });
    }

    if (registro.usuario_id !== userId) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para eliminar este registro",
      });
    }

    if (registro.estado !== "pendiente") {
      return res.status(400).json({
        success: false,
        error: "Solo se pueden eliminar registros pendientes",
      });
    }

    await Promise.allSettled(
      registro.fotos.map((foto) => deleteImageFromCloudinary(foto.public_id))
    );

    await prisma.registros_terreno.delete({
      where: { id: registro.id },
    });

    return res.json({
      success: true,
      message: "Registro eliminado correctamente",
    });
  } catch (error) {
    console.error("DELETE REGISTRO PENDIENTE ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudo eliminar el registro",
    });
  }
}

export async function updateRegistroJefeObra(req: Request, res: Response) {
  try {
    const registroId = getParamValue(req.params.id);
    const userId = req.user?.id;
    const userRole = req.user?.rol;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    if (!registroId) {
      return res.status(400).json({
        success: false,
        error: "Falta id del registro",
      });
    }

    if (userRole !== "jefeobra" && !isAdmin(userRole)) {
      return res.status(403).json({
        success: false,
        error: "Solo jefe de obra puede enviar registros a ingeniería",
      });
    }

    const currentRegistro = await prisma.registros_terreno.findUnique({
      where: { id: registroId },
      include: {
        usuarios: {
          select: {
            rol: true,
          },
        },
      },
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

    if (currentRegistro.estado !== "pendiente") {
      return res.status(400).json({
        success: false,
        error: "Solo se pueden enviar a ingeniería registros en estado pendiente",
      });
    }

    if (userRole === "jefeobra") {
      const hasAccess = await canAccessObra(userId, userRole, currentRegistro.obra_id);

      if (!hasAccess || currentRegistro.usuarios.rol !== "terreno") {
        return res.status(403).json({
          success: false,
          error: "No tienes permisos para editar este registro",
        });
      }
    }

    const camposVisibles = crearMapaVisibilidad(
      await obtenerConfiguracionRegistro(currentRegistro.obra_id, "jefeobra")
    );
    const campoVisible = (campo: string) => camposVisibles.get(campo) === true;

    const {
      fecha,
      descripcionMaterial,
      itemizadoBeck,
      recinto,
      moduloEdificio,
      modulo,
      piso,
      ejeNumerico,
      ejeAlfabetico,
      numeroSello,
      cantidadSellos,
      nombreSellador,
      holgura,
      accesibilidad,
      cieloModular,
      aislacion,
      reparacionTabique,
      folio,
      observaciones,
      itemizadoSacyr,
      codigoBeck,
      codigo_beck,
      tipoRegistro,
      metrosLineales,
    } = req.body ?? {};
    const codigoBeckInput = codigoBeck ?? codigo_beck;
    const recintoInput = campoVisible("recinto") ? recinto : undefined;
    const moduloEdificioInput = campoVisible("modulo") ? moduloEdificio : undefined;
    const moduloInput = campoVisible("modulo") ? modulo : undefined;
    const ejeNumericoInput = campoVisible("eje_numerico") ? ejeNumerico : undefined;
    const ejeAlfabeticoInput = campoVisible("eje_alfabetico") ? ejeAlfabetico : undefined;
    const holguraInput = campoVisible("holgura") ? holgura : undefined;
    const accesibilidadInput = campoVisible("accesibilidad")
      ? accesibilidad ?? cieloModular
      : undefined;
    const aislacionInput = campoVisible("aislacion") ? aislacion : undefined;
    const reparacionTabiqueInput = campoVisible("reparacion_tabique")
      ? reparacionTabique
      : undefined;
    const folioInput = campoVisible("folio") ? folio : undefined;
    const itemizadoMandanteInput = campoVisible("itemizadoMandante")
      ? itemizadoSacyr
      : undefined;

    const normalizedTipoRegistro =
      normalizeText(tipoRegistro) || currentRegistro.tipo_registro || "sello_cortafuego";
    const isJuntaLineal = normalizedTipoRegistro === "junta_lineal_espuma";

    if (!["sello_cortafuego", "junta_lineal_espuma"].includes(normalizedTipoRegistro)) {
      return res.status(400).json({
        success: false,
        error: "tipoRegistro no válido",
      });
    }

    const fechaDate =
      fecha === undefined || fecha === null || normalizeText(fecha) === ""
        ? currentRegistro.fecha
        : new Date(fecha);

    if (Number.isNaN(fechaDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: "La fecha es inválida",
      });
    }

    const cantidadSellosParsed = isJuntaLineal
      ? { value: 1, error: null }
      : parsePositiveInteger(
          cantidadSellos ?? currentRegistro.cantidad_sellos,
          "cantidadSellos"
        );
    const holguraParsed = isJuntaLineal
      ? { value: 0, error: null }
      : parseNonNegativeNumber(
          normalizarHolguraMovil(holguraInput ?? currentRegistro.holgura),
          "holgura",
        );
    const accesibilidadParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseAccesibilidadNivel(
          accesibilidadInput ?? currentRegistro.accesibilidad,
        );
    const metrosLinealesParsed = isJuntaLineal
      ? parsePositiveNumber(
          metrosLineales ?? currentRegistro.metros_lineales,
          "longitud"
        )
      : { value: null, error: null };
    const aislacionParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(aislacionInput, "aislacion");
    const reparacionTabiqueParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(reparacionTabiqueInput, "reparacionTabique");
    const numericErrors = [
      cantidadSellosParsed.error,
      holguraParsed.error,
      accesibilidadParsed.error,
      metrosLinealesParsed.error,
      aislacionParsed.error,
      reparacionTabiqueParsed.error,
    ].filter(Boolean);

    if (numericErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: numericErrors.join(". "),
      });
    }

    const pisoFinal = normalizeText(piso) || currentRegistro.piso;
    const accesibilidadFinal = isJuntaLineal
      ? null
      : accesibilidadInput !== undefined
        ? accesibilidadParsed.value
        : currentRegistro.accesibilidad;
    const aislacionFinal = isJuntaLineal
      ? null
      : aislacionInput !== undefined
        ? normalizarEstadoAislacionMovil(aislacionParsed.value)
        : currentRegistro.aislacion;
    const reparacionFinal = isJuntaLineal
      ? null
      : reparacionTabiqueInput !== undefined
        ? reparacionTabiqueParsed.value
        : currentRegistro.reparacion_tabique;
    const calcResult = isJuntaLineal
      ? null
      : await calcularCamposConConfiguracion(currentRegistro.obra_id, {
          cantidad_sellos: cantidadSellosParsed.value!,
          holgura: holguraParsed.value!,
          accesibilidad: accesibilidadFinal ?? 1,
          aislacion: aislacionFinal,
          reparacion_tabique: reparacionFinal,
          piso: pisoFinal,
          tipoRegistro: normalizedTipoRegistro,
        });

    const puedeRegistrarEnvio = await seguimientoSupervisorDisponible();
    const transition = await prisma.registros_terreno.updateMany({
      where: {
        id: registroId,
        estado: EstadoRegistroTerreno.pendiente,
        carga_completa: true,
      },
      data: {
        fecha: fechaDate,
        dia_semana: getDiaSemana(fechaDate),
        descripcion_material: isJuntaLineal
          ? "Junta Lineal Espuma"
          : normalizeText(itemizadoBeck) ||
            normalizeText(descripcionMaterial) ||
            currentRegistro.itemizado_beck ||
            currentRegistro.descripcion_material,
        itemizado_beck: isJuntaLineal
          ? null
          : normalizeText(itemizadoBeck) ||
            normalizeText(descripcionMaterial) ||
            currentRegistro.itemizado_beck ||
            currentRegistro.descripcion_material,
        modulo:
          normalizeText(moduloEdificioInput) ||
          normalizeText(moduloInput) ||
          currentRegistro.modulo,
        recinto:
          normalizeText(recintoInput) || currentRegistro.recinto || currentRegistro.modulo,
        piso: pisoFinal,
        eje_numerico: normalizeText(ejeNumericoInput) || currentRegistro.eje_numerico,
        eje_alfabetico: normalizeText(ejeAlfabeticoInput) || currentRegistro.eje_alfabetico,
        numero_sello: isJuntaLineal
          ? "N/A"
          : normalizeText(numeroSello) || currentRegistro.numero_sello,
        cantidad_sellos: cantidadSellosParsed.value!,
        nombre_sellador: normalizeText(nombreSellador) || currentRegistro.nombre_sellador,
        holgura: holguraParsed.value!,
        factor_por_holguras: calcResult?.factor_por_holguras ?? null,
        accesibilidad: accesibilidadFinal,
        cantidad_sellos_con_factores:
          calcResult?.cantidad_sellos_con_factores ?? null,
        aislacion: calcResult?.aislacion_normalizada ?? null,
        cantidad_sellos_aislacion:
          calcResult?.cantidad_sellos_aislacion ?? null,
        reparacion_tabique:
          calcResult?.reparacion_tabique_normalizada ?? null,
        cantidad_final: calcResult?.cantidad_final ?? null,
        folio:
          folioInput !== undefined
            ? normalizeText(folioInput) || null
            : currentRegistro.folio,
        observaciones: normalizeText(observaciones) || null,
        itemizado_mandante: isJuntaLineal
          ? null
          : normalizeText(itemizadoMandanteInput) || currentRegistro.itemizado_mandante,
        codigo_beck: isJuntaLineal
          ? null
          : codigoBeckInput !== undefined
            ? normalizeText(codigoBeckInput) || null
            : currentRegistro.codigo_beck,
        metros_lineales: isJuntaLineal ? metrosLinealesParsed.value! : null,
        tipo_registro: normalizedTipoRegistro,
        estado: "en_revision",
        devuelto_a_tecnico: false,
        ...(puedeRegistrarEnvio
          ? {
              enviado_ingenieria_por_id: userId,
              enviado_ingenieria_at: new Date(),
            }
          : {}),
        updated_at: new Date(),
      },
    });
    if (transition.count !== 1) {
      return res.status(409).json({
        success: false,
        error: "El registro cambió de estado mientras se enviaba a ingeniería",
        code: "ESTADO_CONFLICTO",
      });
    }
    const registro = await prisma.registros_terreno.findUniqueOrThrow({
      where: { id: registroId },
    });

    return res.json({
      success: true,
      data: registro,
      message: "Registro enviado a ingeniería",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CORREGIR HOLGURA") {
      return res.status(400).json({
        success: false,
        error: "CORREGIR HOLGURA",
      });
    }

    console.error("UPDATE REGISTRO JEFE OBRA ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudo enviar el registro a ingeniería",
    });
  }
}

export async function updateRegistroObservaciones(req: Request, res: Response) {
  try {
    const registroId = getParamValue(req.params.id);
    const userId = req.user?.id;
    const userRole = req.user?.rol;
    const { observaciones } = req.body ?? {};

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    if (!registroId) {
      return res.status(400).json({
        success: false,
        error: "Falta id del registro",
      });
    }

    const currentRegistro = await prisma.registros_terreno.findUnique({
      where: { id: registroId },
      select: {
        id: true,
        usuario_id: true,
        obra_id: true,
      },
    });

    if (!currentRegistro) {
      return res.status(404).json({
        success: false,
        error: "Registro no encontrado",
      });
    }

    const currentState = await prisma.registros_terreno.findUnique({
      where: { id: registroId },
      select: { estado: true, validado_cliente: true },
    });
    if (
      !currentState ||
      !(new Set<EstadoRegistroTerreno>([
        EstadoRegistroTerreno.pendiente,
        EstadoRegistroTerreno.rechazado,
      ])).has(
        currentState.estado,
      ) ||
      currentState.validado_cliente
    ) {
      return res.status(409).json({
        success: false,
        error: "El registro ya está en revisión o validado y no puede modificarse",
        code: "REGISTRO_LOCKED",
      });
    }

    const hasAccess = await canModifyRegistro(userId, userRole, currentRegistro);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para modificar este registro",
      });
    }

    const registro = await prisma.registros_terreno.update({
      where: { id: registroId },
      data: {
        observaciones: normalizeText(observaciones) || null,
        updated_at: new Date(),
      },
    });

    return res.json({
      success: true,
      data: registro,
      message: "Observaciones actualizadas",
    });
  } catch (error) {
    console.error("UPDATE REGISTRO OBS ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudieron actualizar las observaciones",
    });
  }
}

export async function uploadRegistroFotos(req: Request, res: Response) {
  try {
    const registroId = getParamValue(req.params.id);
    const userId = req.user?.id;
    const userRole = req.user?.rol;
    const files = req.files as Express.Multer.File[] | undefined;
    const replaceExisting = req.query.replace === "true";

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    if (!registroId) {
      return res.status(400).json({
        success: false,
        error: "Falta id del registro",
      });
    }

    if (!files || !files.length) {
      return res.status(400).json({
        success: false,
        error: "Debes enviar al menos una foto",
      });
    }

    const registro = await prisma.registros_terreno.findUnique({
      where: { id: registroId },
    });

    if (!registro) {
      return res.status(404).json({
        success: false,
        error: "Registro no encontrado",
      });
    }

    if (
      !(new Set<EstadoRegistroTerreno>([
        EstadoRegistroTerreno.pendiente,
        EstadoRegistroTerreno.rechazado,
      ])).has(
        registro.estado,
      ) ||
      registro.validado_cliente
    ) {
      return res.status(409).json({
        success: false,
        error: "Las fotografías de este registro están bloqueadas",
        code: "REGISTRO_LOCKED",
      });
    }

    const hasAccess = await canModifyRegistro(userId, userRole, registro);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para subir fotos a este registro",
      });
    }

    if (
      replaceExisting &&
      !isAdmin(userRole) &&
      userRole !== "jefeobra" &&
      registro.usuario_id !== userId
    ) {
      return res.status(403).json({
        success: false,
        error: "Solo jefe de obra puede reemplazar fotografias de registros de otros usuarios",
      });
    }

    const obra = await prisma.obras.findUnique({
      where: { id: registro.obra_id },
      select: { codigo: true },
    });

    if (!obra) {
      return res.status(404).json({
        success: false,
        error: "Obra del registro no encontrada",
      });
    }

    const folder = buildCloudinaryFolder(
      obra.codigo || registro.obra_id,
      new Date(registro.fecha),
      registro.piso,
      req.user?.nombre
    );

    const fotosExistentes = replaceExisting
      ? await prisma.fotos_registro.findMany({
          where: { registro_id: registro.id },
          select: { id: true, public_id: true },
        })
      : [];
    const existingPhotoCount = replaceExisting
      ? 0
      : await prisma.fotos_registro.count({
          where: { registro_id: registro.id },
        });
    if (existingPhotoCount + files.length > 10) {
      return res.status(400).json({
        success: false,
        error: "Puedes guardar hasta 10 fotografías por registro",
      });
    }
    const uploadedResults: {
      secure_url: string;
      public_id: string;
      format: string;
      bytes: number;
      originalname: string;
    }[] = [];

    try {
      for (const file of files) {
        const result = await uploadBufferToCloudinary(file.buffer, {
          folder,
        });

        uploadedResults.push({
          secure_url: result.secure_url,
          public_id: result.public_id,
          format: result.format,
          bytes: result.bytes,
          originalname: file.originalname,
        });
      }

      const uploadedFotos = await prisma.$transaction(async (tx) => {
        if (replaceExisting && fotosExistentes.length) {
          await tx.fotos_registro.deleteMany({
            where: {
              id: {
                in: fotosExistentes.map((foto) => foto.id),
              },
            },
          });
        }

        const createdFotos = [];

        for (const uploaded of uploadedResults) {
          const foto = await tx.fotos_registro.create({
            data: {
              registro_id: registro.id,
              url: uploaded.secure_url,
              public_id: uploaded.public_id,
              nombre_archivo: uploaded.originalname,
              formato: uploaded.format,
              bytes: uploaded.bytes,
              subido_por_id: userId || null,
            },
          });

          createdFotos.push(foto);
        }

        const fotosActuales = await tx.fotos_registro.findMany({
          where: { registro_id: registro.id },
          select: { url: true },
          orderBy: {
            created_at: "asc",
          },
        });

        await tx.registros_terreno.update({
          where: { id: registro.id },
          data: {
            foto_url: fotosActuales[0]?.url || null,
            fotos_urls: fotosActuales.map((foto) => foto.url),
            carga_completa: fotosActuales.length > 0,
          },
        });

        return createdFotos;
      });

      if (replaceExisting && fotosExistentes.length) {
        await Promise.allSettled(
          fotosExistentes.map((foto) =>
            deleteImageFromCloudinary(foto.public_id)
          )
        );
      }

      return res.json({
        success: true,
        data: uploadedFotos.map((foto) => withPrivateImageUrl(foto)),
        message: replaceExisting
          ? "Fotografias reemplazadas correctamente"
          : "Fotos subidas correctamente",
      });
    } catch (uploadError) {
      await Promise.allSettled(
        uploadedResults.map((foto) =>
          deleteImageFromCloudinary(foto.public_id)
        )
      );

      await eliminarRegistroIncompleto(registro.id, userId).catch((cleanupError) => {
        console.error("DELETE REGISTRO INCOMPLETO ERROR:", cleanupError);
      });

      throw uploadError;
    }
  } catch (error) {
    console.error("UPLOAD REGISTRO FOTOS ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudieron subir las fotos",
    });
  }
}
