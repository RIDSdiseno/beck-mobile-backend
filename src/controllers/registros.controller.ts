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

function buildCloudinaryFolder(codigoObra: string, fecha: Date) {
  const year = String(fecha.getFullYear());
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const dd = String(fecha.getDate()).padStart(2, "0");

  return `beck/${year}/${codigoObra}/${yyyy}-${mm}-${dd}/registros`;
}

export async function createRegistro(req: Request, res: Response) {
  try {
    const userId = req.user?.id;

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
    } = req.body ?? {};

    const requiredFields = {
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

    const registro = await prisma.registros_terreno.create({
      data: {
        obra_id: obraId,
        usuario_id: userId,
        fecha: fechaDate,
        dia_semana: getDiaSemana(fechaDate),
        descripcion_material: descripcionMaterial,
        modulo: String(modulo),
        piso: String(piso),
        eje_numerico: Number(ejeNumerico),
        eje_alfabetico: String(ejeAlfabetico),
        numero_sello: String(numeroSello),
        cantidad_sellos: Number(cantidadSellos),
        nombre_sellador: String(nombreSellador),
        holgura: Number(holgura),
        accesibilidad: Number(accesibilidad),
        observaciones: observaciones || null,
        fotos_urls: [],
        estado: "pendiente",
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

export async function updateRegistroObservaciones(req: Request, res: Response) {
  try {
    const registroId = req.params.id;
    const { observaciones } = req.body ?? {};

    if (!registroId) {
      return res.status(400).json({
        success: false,
        error: "Falta id del registro",
      });
    }

    const registro = await prisma.registros_terreno.update({
      where: { id: registroId },
      data: {
        observaciones: observaciones || null,
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
    const registroId = req.params.id;
    const userId = req.user?.id;
    const files = req.files as Express.Multer.File[] | undefined;

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
      include: {
        obras: true,
      },
    });

    if (!registro) {
      return res.status(404).json({
        success: false,
        error: "Registro no encontrado",
      });
    }

    const folder = buildCloudinaryFolder(
      registro.obras.codigo,
      new Date(registro.fecha)
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