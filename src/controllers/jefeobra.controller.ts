import { Request, Response } from "express";
import { EstadoObra } from "@prisma/client";
import { prisma } from "../config/prisma";
import {
  deleteImageFromCloudinary,
  uploadBufferToCloudinary,
  withPrivateImageUrl,
} from "../services/cloudinary.service";
import { buildCloudinaryFolder } from "./registros.controller";

function isJefeObraRole(role?: string) {
  return role === "jefeobra" || role === "administrador";
}

function ensureJefeObra(req: Request, res: Response) {
  if (!req.user?.id) {
    res.status(401).json({
      success: false,
      error: "Usuario no autenticado",
    });
    return false;
  }

  if (!isJefeObraRole(req.user.rol)) {
    res.status(403).json({
      success: false,
      error: "Solo el Supervisor puede acceder a este módulo",
    });
    return false;
  }

  return true;
}

function getParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function isObraDisponible(estado: EstadoObra) {
  return estado === EstadoObra.activa || estado === EstadoObra.pausada;
}

const PARAMETRO_INCLUDE = {
  orderBy: { orden: "asc" as const },
  include: { fotos_correccion_parametro: true },
};

function mapControlPrivatePhotos(control: any) {
  return {
    ...control,
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

export async function getControlesPendientesCorreccion(req: Request, res: Response) {
  try {
    if (!ensureJefeObra(req, res)) return;

    const controles = await prisma.controles_inspeccion.findMany({
      where: {
        conformidad: "no_conforme",
        correccion_enviada_at: null,
        registros_terreno: {
          obras: { estado: { in: [EstadoObra.activa, EstadoObra.pausada] } },
        },
      },
      orderBy: { fecha: "desc" },
      include: {
        registros_terreno: {
          include: {
            obras: { select: { id: true, nombre: true, codigo: true } },
          },
        },
        usuarios: { select: { id: true, nombre: true, email: true } },
      },
    });

    return res.json({
      success: true,
      data: controles.map(mapControlPrivatePhotos),
    });
  } catch (error) {
    console.error("GET CONTROLES PENDIENTES CORRECCION ERROR:", error);
    return res.status(500).json({
      success: false,
      error: "No se pudieron obtener los controles pendientes de corrección",
    });
  }
}

export async function getControlCorreccionDetalle(req: Request, res: Response) {
  try {
    if (!ensureJefeObra(req, res)) return;

    const registroId = getParamValue(req.params.registroId);

    if (!registroId) {
      return res.status(400).json({ success: false, error: "Falta id del registro" });
    }

    const control = await prisma.controles_inspeccion.findFirst({
      where: {
        registro_terreno_id: registroId,
        registros_terreno: {
          obras: { estado: { in: [EstadoObra.activa, EstadoObra.pausada] } },
        },
      },
      orderBy: { created_at: "desc" },
      include: {
        controles_inspeccion_parametros: PARAMETRO_INCLUDE,
        usuarios: { select: { id: true, nombre: true, email: true } },
        registros_terreno: {
          include: {
            obras: { select: { id: true, nombre: true, codigo: true } },
          },
        },
      },
    });

    if (!control) {
      return res.status(404).json({ success: false, error: "Control de inspección no encontrado" });
    }

    return res.json({ success: true, data: mapControlPrivatePhotos(control) });
  } catch (error) {
    console.error("GET CONTROL CORRECCION DETALLE ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudo obtener el control de inspección" });
  }
}

export async function enviarCorreccionControlInspeccion(req: Request, res: Response) {
  try {
    if (!ensureJefeObra(req, res)) return;

    const controlId = getParamValue(req.params.controlId);
    const userId = req.user!.id;

    if (!controlId) {
      return res.status(400).json({ success: false, error: "Falta id del control" });
    }

    const { parametros } = req.body ?? {};

    if (!Array.isArray(parametros)) {
      return res.status(400).json({ success: false, error: "Los parámetros son requeridos" });
    }

    const control = await prisma.controles_inspeccion.findUnique({
      where: { id: controlId },
      include: {
        controles_inspeccion_parametros: {
          select: { id: true, resultado: true },
        },
        registros_terreno: {
          include: { obras: { select: { estado: true } } },
        },
      },
    });

    if (!control) {
      return res.status(404).json({ success: false, error: "Control de inspección no encontrado" });
    }

    if (control.conformidad !== "no_conforme") {
      return res.status(400).json({ success: false, error: "Este control no requiere corrección" });
    }

    if (!isObraDisponible(control.registros_terreno.obras.estado)) {
      return res.status(403).json({
        success: false,
        error: "La obra ya no está disponible para correcciones",
      });
    }

    if (control.correccion_enviada_at) {
      return res.status(409).json({
        success: false,
        error: "La corrección ya fue enviada",
        code: "CORRECCION_ENVIADA",
      });
    }

    const requeridos = control.controles_inspeccion_parametros.filter(
      (p) => p.resultado === "no_cumple",
    );
    const payloadById = new Map(
      parametros.map((p: any) => [String(p?.parametroId || ""), p]),
    );
    const faltante = requeridos.find((p) => {
      const payload = payloadById.get(p.id) as any;
      return !payload || !normalizeText(payload.correccionObservacion);
    });
    if (faltante) {
      return res.status(400).json({
        success: false,
        error: "Debes describir la corrección de cada parámetro que no cumple",
      });
    }
    if (
      parametros.some(
        (p: any) =>
          !control.controles_inspeccion_parametros.some(
            (stored) => stored.id === String(p?.parametroId || ""),
          ),
      )
    ) {
      return res.status(400).json({
        success: false,
        error: "Uno de los parámetros no pertenece a este control",
      });
    }

    await prisma.$transaction(async (tx) => {
      for (const parametro of requeridos) {
        const payload = payloadById.get(parametro.id) as any;
        await tx.controles_inspeccion_parametros.update({
          where: { id: parametro.id },
          data: {
            correccion_observacion: normalizeText(payload.correccionObservacion),
            corregido_at: new Date(),
            corregido_por_id: userId,
          },
        });
      }

      const updated = await tx.controles_inspeccion.updateMany({
        where: { id: controlId, correccion_enviada_at: null },
        data: {
          correccion_enviada_at: new Date(),
          correccion_enviada_por_id: userId,
        },
      });
      if (updated.count !== 1) throw new Error("CORRECCION_ENVIADA");

      await tx.registros_terreno.update({
        where: { id: control.registro_terreno_id },
        data: { inspeccion_revision_estado: "pendiente" },
      });
    });

    const actualizado = await prisma.controles_inspeccion.findUnique({
      where: { id: controlId },
      include: { controles_inspeccion_parametros: PARAMETRO_INCLUDE },
    });

    return res.json({
      success: true,
      data: mapControlPrivatePhotos(actualizado),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CORRECCION_ENVIADA") {
      return res.status(409).json({
        success: false,
        error: "La corrección ya fue enviada",
        code: error.message,
      });
    }
    console.error("ENVIAR CORRECCION CONTROL INSPECCION ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudo enviar la corrección" });
  }
}

export async function uploadCorreccionParametroFotos(req: Request, res: Response) {
  try {
    if (!ensureJefeObra(req, res)) return;

    const parametroId = getParamValue(req.params.parametroId);
    const userId = req.user!.id;
    const files = req.files as Express.Multer.File[] | undefined;

    if (!parametroId) {
      return res.status(400).json({ success: false, error: "Falta id del parámetro" });
    }

    if (!files || !files.length) {
      return res.status(400).json({ success: false, error: "Debes enviar al menos una foto" });
    }

    const parametro = await prisma.controles_inspeccion_parametros.findUnique({
      where: { id: parametroId },
      include: {
        controles_inspeccion: {
          include: {
            registros_terreno: {
              include: { obras: { select: { codigo: true, estado: true } } },
            },
          },
        },
      },
    });

    if (!parametro) {
      return res.status(404).json({ success: false, error: "Parámetro no encontrado" });
    }

    if (
      parametro.resultado !== "no_cumple" ||
      parametro.controles_inspeccion.correccion_enviada_at
    ) {
      return res.status(409).json({
        success: false,
        error: "Este parámetro ya no admite fotografías de corrección",
      });
    }

    const registro = parametro.controles_inspeccion.registros_terreno;
    if (!isObraDisponible(registro.obras.estado)) {
      return res.status(403).json({
        success: false,
        error: "La obra ya no está disponible para correcciones",
      });
    }

    const existingPhotoCount = await prisma.fotos_correccion_parametro.count({
      where: { parametro_id: parametroId },
    });
    if (existingPhotoCount + files.length > 5) {
      return res.status(400).json({
        success: false,
        error: "Puedes guardar hasta 5 fotografías por parámetro",
      });
    }
    const folder = buildCloudinaryFolder(
      registro.obras?.codigo || registro.obra_id || "sin-obra",
      new Date(registro.fecha),
      registro.piso,
      registro.nombre_sellador,
      "correccion-inspeccion"
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

      const fotos = await prisma.$transaction(
        uploadedResults.map((uploaded) =>
          prisma.fotos_correccion_parametro.create({
            data: {
              parametro_id: parametroId,
              url: uploaded.secure_url,
              public_id: uploaded.public_id,
              nombre_archivo: uploaded.originalname,
              formato: uploaded.format,
              bytes: uploaded.bytes,
              subido_por_id: userId,
            },
          })
        )
      );

      return res.status(201).json({
        success: true,
        data: fotos.map(withPrivateImageUrl),
      });
    } catch (uploadError) {
      await Promise.allSettled(
        uploadedResults.map((foto) => deleteImageFromCloudinary(foto.public_id))
      );

      throw uploadError;
    }
  } catch (error) {
    console.error("UPLOAD CORRECCION PARAMETRO FOTOS ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudieron subir las fotografías" });
  }
}
