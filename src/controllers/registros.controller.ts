import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { uploadBufferToCloudinary } from "../services/cloudinary.service";

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

function isAdmin(role: string | undefined) {
  return role === "administrador";
}

async function canAccessObra(userId: string, role: string | undefined, obraId: string) {
  if (isAdmin(role)) return true;

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
      modulo,
      piso,
      ejeNumerico,
      ejeAlfabetico,
      numeroSello,
      cantidadSellos,
      nombreSellador,
      holgura,
      accesibilidad,
      observaciones,
      itemizadoSacyr,
      tipoRegistro,
      metrosLineales,
    } = req.body ?? {};
    const normalizedTipoRegistro = normalizeText(tipoRegistro) || "sello_cortafuego";
    const isJuntaLineal = normalizedTipoRegistro === "junta_lineal_espuma";

    if (!["sello_cortafuego", "junta_lineal_espuma"].includes(normalizedTipoRegistro)) {
      return res.status(400).json({
        success: false,
        error: "tipoRegistro no válido",
      });
    }

    const requiredFields = {
      obraId,
      fecha,
      modulo,
      piso,
      ejeNumerico,
      ejeAlfabetico,
      nombreSellador,
      ...(isJuntaLineal
        ? { metrosLineales }
        : {
            descripcionMaterial,
            numeroSello,
            cantidadSellos,
            holgura,
            accesibilidad,
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
    const accesibilidadParsed = isJuntaLineal
      ? { value: 1, error: null }
      : parsePositiveInteger(accesibilidad, "accesibilidad");
    const metrosLinealesParsed = isJuntaLineal
      ? parsePositiveNumber(metrosLineales, "longitud")
      : { value: null, error: null };
    const numericErrors = [
      cantidadSellosParsed.error,
      holguraParsed.error,
      accesibilidadParsed.error,
      metrosLinealesParsed.error,
    ].filter(Boolean);

    if (numericErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: numericErrors.join(". "),
      });
    }

    const obra = await prisma.obras.findUnique({
      where: { id: String(obraId) },
      select: { id: true },
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
        error: "No tienes permisos para registrar información en esta obra",
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
          : normalizeText(descripcionMaterial),
        modulo: normalizeText(modulo),
        piso: normalizeText(piso),
        eje_numerico: normalizeText(ejeNumerico),
        eje_alfabetico: normalizeText(ejeAlfabetico),
        numero_sello: isJuntaLineal ? "N/A" : normalizeText(numeroSello),
        cantidad_sellos: cantidadSellosParsed.value!,
        nombre_sellador: normalizeText(nombreSellador),
        holgura: holguraParsed.value!,
        accesibilidad: accesibilidadParsed.value!,
        observaciones: normalizeText(observaciones) || null,
        fotos_urls: [],
        estado: "pendiente",
        itemizado_sacyr: isJuntaLineal ? null : normalizeText(itemizadoSacyr) || null,
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

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    const where =
      userRole === "jefeobra"
        ? {
            obras: {
              usuarios_obras: {
                some: {
                  usuario_id: userId,
                },
              },
            },
            usuarios: {
              rol: "terreno" as const,
            },
          }
        : {
            usuario_id: userId,
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
      },
    });

    return res.json({
      success: true,
      data: registros,
    });
  } catch (error) {
    console.error("GET MIS REGISTROS ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudieron obtener los registros",
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
      modulo,
      piso,
      ejeNumerico,
      ejeAlfabetico,
      numeroSello,
      cantidadSellos,
      nombreSellador,
      holgura,
      accesibilidad,
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
    const accesibilidadParsed = isJuntaLineal
      ? { value: 1, error: null }
      : parsePositiveInteger(
          accesibilidad ?? currentRegistro.accesibilidad,
          "accesibilidad"
        );
    const metrosLinealesParsed = isJuntaLineal
      ? parsePositiveNumber(
          metrosLineales ?? currentRegistro.metros_lineales,
          "longitud"
        )
      : { value: null, error: null };
    const numericErrors = [
      cantidadSellosParsed.error,
      holguraParsed.error,
      accesibilidadParsed.error,
      metrosLinealesParsed.error,
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
          : normalizeText(descripcionMaterial) || currentRegistro.descripcion_material,
        modulo: normalizeText(modulo) || currentRegistro.modulo,
        piso: normalizeText(piso) || currentRegistro.piso,
        eje_numerico: normalizeText(ejeNumerico) || currentRegistro.eje_numerico,
        eje_alfabetico: normalizeText(ejeAlfabetico) || currentRegistro.eje_alfabetico,
        numero_sello: isJuntaLineal
          ? "N/A"
          : normalizeText(numeroSello) || currentRegistro.numero_sello,
        cantidad_sellos: cantidadSellosParsed.value!,
        nombre_sellador: normalizeText(nombreSellador) || currentRegistro.nombre_sellador,
        holgura: holguraParsed.value!,
        accesibilidad: accesibilidadParsed.value!,
        observaciones: normalizeText(observaciones) || null,
        itemizado_sacyr: isJuntaLineal
          ? null
          : normalizeText(itemizadoSacyr) || currentRegistro.itemizado_sacyr,
        metros_lineales: isJuntaLineal ? metrosLinealesParsed.value! : null,
        tipo_registro: normalizedTipoRegistro,
        estado: "en_revision",
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

    const uploadedFotos = [];

    for (const file of files) {
      const result = await uploadBufferToCloudinary(file.buffer, {
        folder,
      });

      const foto = await prisma.fotos_registro.create({
        data: {
          registro_id: registro.id,
          url: result.secure_url,
          public_id: result.public_id,
          nombre_archivo: file.originalname,
          formato: result.format,
          bytes: result.bytes,
          subido_por_id: userId || null,
        },
      });

      uploadedFotos.push(foto);
    }

    return res.json({
      success: true,
      data: uploadedFotos,
      message: "Fotos subidas correctamente",
    });
  } catch (error) {
    console.error("UPLOAD REGISTRO FOTOS ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudieron subir las fotos",
    });
  }
}
