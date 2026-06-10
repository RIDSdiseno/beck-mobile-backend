import { Request, Response } from "express";
import { EstadoObra } from "@prisma/client";
import { prisma } from "../config/prisma";
import {
  deleteImageFromCloudinary,
  uploadBufferToCloudinary,
} from "../services/cloudinary.service";

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

function sanitizeCloudinaryFolderSegment(value: string | null | undefined) {
  const sanitized = String(value || "")
    .trim()
    .replace(/[\/\\]+/g, "-")
    .replace(/\s+/g, " ");

  return sanitized || "sin-nombre";
}

function buildCloudinaryFolder(
  codigoObra: string,
  fecha: Date,
  piso: string | null | undefined,
  nombreSellador: string | null | undefined
) {
  const year = String(fecha.getFullYear());
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const dd = String(fecha.getDate()).padStart(2, "0");
  const obraSegment = sanitizeCloudinaryFolderSegment(codigoObra);
  const pisoSegment = sanitizeCloudinaryFolderSegment(`Piso ${piso || "sin-piso"}`);
  const selladorSegment = sanitizeCloudinaryFolderSegment(nombreSellador);

  return `BeckSoluciones/${year}/${obraSegment}/${pisoSegment}/${yyyy}-${mm}-${dd}/${selladorSegment}/registros`;
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

function isAdmin(role: string | undefined) {
  return role === "administrador";
}

function canUseAvailableObras(role: string | undefined) {
  return role === "terreno" || role === "jefeobra";
}

function isObraOperable(estado: EstadoObra) {
  return estado === EstadoObra.activa || estado === EstadoObra.pausada;
}

async function canAccessObra(userId: string, role: string | undefined, obraId: string) {
  if (isAdmin(role)) return true;

  if (canUseAvailableObras(role)) {
    const obra = await prisma.obras.findUnique({
      where: { id: obraId },
      select: { estado: true },
    });

    return Boolean(obra && isObraOperable(obra.estado));
  }

  const asignacion = await prisma.usuarios_obras.findUnique({
    where: {
      usuario_id_obra_id: {
        usuario_id: userId,
        obra_id: obraId,
      },
    },
  });

  return Boolean(asignacion);
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
      factorHolguras,
      accesibilidad,
      cieloModular,
      aislacion,
      reparacionTabique,
      observaciones,
      itemizadoSacyr,
      tipoRegistro,
      metrosLineales,
    } = req.body ?? {};
    const normalizedTipoRegistro = normalizeText(tipoRegistro) || "sello_cortafuego";
    const isJuntaLineal = normalizedTipoRegistro === "junta_lineal_espuma";
    const normalizedModulo = normalizeText(moduloEdificio) || normalizeText(modulo);
    const normalizedRecinto = normalizeText(recinto) || normalizeText(modulo);
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
      modulo: normalizedModulo,
      piso,
      ejeNumerico,
      ejeAlfabetico,
      nombreSellador,
      ...(isJuntaLineal
        ? { metrosLineales }
        : {
            descripcionMaterial: normalizedItemizadoBeck,
            numeroSello,
            cantidadSellos,
            holgura,
            accesibilidad: accesibilidad ?? cieloModular,
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

    const cantidadSellosParsed = isJuntaLineal
      ? { value: 1, error: null }
      : parsePositiveInteger(cantidadSellos, "cantidadSellos");
    const holguraParsed = isJuntaLineal
      ? { value: 0, error: null }
      : parseNonNegativeNumber(holgura, "holgura");
    const factorHolgurasParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(factorHolguras ?? holgura, "factorHolguras");
    const accesibilidadInput = accesibilidad ?? cieloModular;
    const accesibilidadParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(accesibilidadInput, "accesibilidad");
    const metrosLinealesParsed = isJuntaLineal
      ? parsePositiveNumber(metrosLineales, "longitud")
      : { value: null, error: null };
    const aislacionParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(aislacion, "aislacion");
    const reparacionTabiqueParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(reparacionTabique, "reparacionTabique");
    const numericErrors = [
      cantidadSellosParsed.error,
      holguraParsed.error,
      factorHolgurasParsed.error,
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
        eje_numerico: normalizeText(ejeNumerico),
        eje_alfabetico: normalizeText(ejeAlfabetico),
        numero_sello: isJuntaLineal ? "N/A" : normalizeText(numeroSello),
        cantidad_sellos: cantidadSellosParsed.value!,
        nombre_sellador: normalizeText(nombreSellador),
        holgura: holguraParsed.value!,
        factor_por_holguras: factorHolgurasParsed.value,
        accesibilidad:
          !isJuntaLineal && accesibilidadInput !== undefined
            ? accesibilidadParsed.value
            : null,
        cantidad_sellos_con_factores:
          !isJuntaLineal && factorHolgurasParsed.value !== null
            ? cantidadSellosParsed.value! * factorHolgurasParsed.value
            : null,
        aislacion: aislacionParsed.value,
        reparacion_tabique: reparacionTabiqueParsed.value,
        observaciones: normalizeText(observaciones) || null,
        fotos_urls: [],
        estado: "pendiente",
        devuelto_a_tecnico: false,
        itemizado_mandante: isJuntaLineal
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

    const where =
      userRole === "jefeobra"
        ? {
            ...(obraId ? { obra_id: obraId } : {}),
            ...(estado ? { estado: estado as any } : {}),
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
            usuario_id: userId,
            ...(estado ? { estado: estado as any } : {}),
            ...(scope === "registro"
              ? {
                  OR: [
                    { estado: "pendiente" as const },
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

    const normalizeRegistroFotos = (registro: {
      id: string;
      foto_url?: string | null;
      fotos_urls?: string[] | null;
      fotos?: { id: string; url: string; created_at: Date }[];
    }) => {
      const relationFotos = (registro.fotos || []).filter((foto) => foto.url);
      const fallbackUrls = [
        ...(Array.isArray(registro.fotos_urls) ? registro.fotos_urls : []),
        registro.foto_url,
      ].filter((url): url is string => Boolean(url));

      const seen = new Set<string>();
      const normalized = [
        ...relationFotos.map((foto) => ({
          id: foto.id,
          url: foto.url,
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
      factorHolguras,
      accesibilidad,
      cieloModular,
      aislacion,
      reparacionTabique,
      observaciones,
      itemizadoSacyr,
      tipoRegistro,
      metrosLineales,
    } = req.body ?? {};

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
      : parseNonNegativeNumber(holgura ?? currentRegistro.holgura, "holgura");
    const factorHolgurasParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(factorHolguras, "factorHolguras");
    const accesibilidadInput = accesibilidad ?? cieloModular;
    const accesibilidadParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(
          accesibilidadInput ?? currentRegistro.accesibilidad,
          "accesibilidad"
        );
    const metrosLinealesParsed = isJuntaLineal
      ? parsePositiveNumber(metrosLineales ?? currentRegistro.metros_lineales, "longitud")
      : { value: null, error: null };
    const aislacionParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(aislacion, "aislacion");
    const reparacionTabiqueParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(reparacionTabique, "reparacionTabique");
    const numericErrors = [
      cantidadSellosParsed.error,
      holguraParsed.error,
      factorHolgurasParsed.error,
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

    const registro = await prisma.registros_terreno.update({
      where: { id: registroId },
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
          normalizeText(moduloEdificio) || normalizeText(modulo) || currentRegistro.modulo,
        recinto:
          normalizeText(recinto) || currentRegistro.recinto || currentRegistro.modulo,
        piso: normalizeText(piso) || currentRegistro.piso,
        eje_numerico: normalizeText(ejeNumerico) || currentRegistro.eje_numerico,
        eje_alfabetico: normalizeText(ejeAlfabetico) || currentRegistro.eje_alfabetico,
        numero_sello: isJuntaLineal
          ? "N/A"
          : normalizeText(numeroSello) || currentRegistro.numero_sello,
        cantidad_sellos: cantidadSellosParsed.value!,
        nombre_sellador: normalizeText(nombreSellador) || currentRegistro.nombre_sellador,
        holgura: holguraParsed.value!,
        factor_por_holguras: isJuntaLineal
          ? null
          : factorHolguras !== undefined
            ? factorHolgurasParsed.value
            : currentRegistro.factor_por_holguras,
        accesibilidad:
          isJuntaLineal
            ? null
            : accesibilidadInput !== undefined
              ? accesibilidadParsed.value
              : currentRegistro.accesibilidad,
        cantidad_sellos_con_factores:
          isJuntaLineal
            ? null
            : factorHolguras !== undefined && factorHolgurasParsed.value !== null
              ? cantidadSellosParsed.value! * factorHolgurasParsed.value
              : currentRegistro.cantidad_sellos_con_factores,
        aislacion:
          isJuntaLineal
            ? null
            : aislacion !== undefined
              ? aislacionParsed.value
              : currentRegistro.aislacion,
        reparacion_tabique:
          isJuntaLineal
            ? null
            : reparacionTabique !== undefined
              ? reparacionTabiqueParsed.value
              : currentRegistro.reparacion_tabique,
        observaciones: normalizeText(observaciones) || null,
        itemizado_mandante: isJuntaLineal
          ? null
          : normalizeText(itemizadoSacyr) || currentRegistro.itemizado_mandante,
        metros_lineales: isJuntaLineal ? metrosLinealesParsed.value! : null,
        tipo_registro: normalizedTipoRegistro,
        estado: "pendiente",
        devuelto_a_tecnico: false,
        updated_at: new Date(),
      },
    });

    return res.json({
      success: true,
      data: registro,
      message: "Registro corregido y enviado al jefe de obra",
    });
  } catch (error) {
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

    if (currentRegistro.estado !== "rechazado") {
      return res.status(400).json({
        success: false,
        error: "Solo se pueden enviar al técnico registros rechazados",
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

    const registro = await prisma.registros_terreno.update({
      where: { id: registroId },
      data: {
        estado: "rechazado",
        devuelto_a_tecnico: true,
        updated_at: new Date(),
      },
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

    await prisma.registros_terreno.delete({
      where: { id: registro.id },
    });

    await Promise.allSettled(
      registro.fotos.map((foto) => deleteImageFromCloudinary(foto.public_id))
    );

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

    if (userRole === "jefeobra") {
      const hasAccess = await canAccessObra(userId, userRole, currentRegistro.obra_id);

      if (!hasAccess || currentRegistro.usuarios.rol !== "terreno") {
        return res.status(403).json({
          success: false,
          error: "No tienes permisos para editar este registro",
        });
      }
    }

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
      factorHolguras,
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
      : parseNonNegativeNumber(holgura ?? currentRegistro.holgura, "holgura");
    const factorHolgurasParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(factorHolguras, "factorHolguras");
    const accesibilidadInput = accesibilidad ?? cieloModular;
    const accesibilidadParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(
          accesibilidadInput ?? currentRegistro.accesibilidad,
          "accesibilidad"
        );
    const metrosLinealesParsed = isJuntaLineal
      ? parsePositiveNumber(
          metrosLineales ?? currentRegistro.metros_lineales,
          "longitud"
        )
      : { value: null, error: null };
    const aislacionParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(aislacion, "aislacion");
    const reparacionTabiqueParsed = isJuntaLineal
      ? { value: null, error: null }
      : parseOptionalNonNegativeNumber(reparacionTabique, "reparacionTabique");
    const numericErrors = [
      cantidadSellosParsed.error,
      holguraParsed.error,
      factorHolgurasParsed.error,
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

    const registro = await prisma.registros_terreno.update({
      where: { id: registroId },
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
          normalizeText(moduloEdificio) || normalizeText(modulo) || currentRegistro.modulo,
        recinto:
          normalizeText(recinto) || currentRegistro.recinto || currentRegistro.modulo,
        piso: normalizeText(piso) || currentRegistro.piso,
        eje_numerico: normalizeText(ejeNumerico) || currentRegistro.eje_numerico,
        eje_alfabetico: normalizeText(ejeAlfabetico) || currentRegistro.eje_alfabetico,
        numero_sello: isJuntaLineal
          ? "N/A"
          : normalizeText(numeroSello) || currentRegistro.numero_sello,
        cantidad_sellos: cantidadSellosParsed.value!,
        nombre_sellador: normalizeText(nombreSellador) || currentRegistro.nombre_sellador,
        holgura: holguraParsed.value!,
        factor_por_holguras: isJuntaLineal
          ? null
          : factorHolguras !== undefined
            ? factorHolgurasParsed.value
            : currentRegistro.factor_por_holguras,
        accesibilidad:
          isJuntaLineal
            ? null
            : accesibilidadInput !== undefined
              ? accesibilidadParsed.value
              : currentRegistro.accesibilidad,
        cantidad_sellos_con_factores:
          isJuntaLineal
            ? null
            : factorHolguras !== undefined && factorHolgurasParsed.value !== null
              ? cantidadSellosParsed.value! * factorHolgurasParsed.value
              : currentRegistro.cantidad_sellos_con_factores,
        aislacion:
          isJuntaLineal
            ? null
            : aislacion !== undefined
              ? aislacionParsed.value
              : currentRegistro.aislacion,
        reparacion_tabique:
          isJuntaLineal
            ? null
            : reparacionTabique !== undefined
              ? reparacionTabiqueParsed.value
              : currentRegistro.reparacion_tabique,
        folio: folio !== undefined ? normalizeText(folio) || null : currentRegistro.folio,
        observaciones: normalizeText(observaciones) || null,
        itemizado_mandante: isJuntaLineal
          ? null
          : normalizeText(itemizadoSacyr) || currentRegistro.itemizado_mandante,
        metros_lineales: isJuntaLineal ? metrosLinealesParsed.value! : null,
        tipo_registro: normalizedTipoRegistro,
        estado: "en_revision",
        devuelto_a_tecnico: false,
        updated_at: new Date(),
      },
    });

    return res.json({
      success: true,
      data: registro,
      message: "Registro enviado a ingeniería",
    });
  } catch (error) {
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

    if (replaceExisting && userRole !== "jefeobra" && !isAdmin(userRole)) {
      return res.status(403).json({
        success: false,
        error: "Solo jefe de obra puede reemplazar fotografias",
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

    const hasAccess = await canModifyRegistro(userId, userRole, registro);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para subir fotos a este registro",
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
        data: uploadedFotos,
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
