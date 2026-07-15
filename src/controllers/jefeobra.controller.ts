import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import {
  deleteImageFromCloudinary,
  uploadBufferToCloudinary,
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

const PARAMETRO_INCLUDE = {
  orderBy: { orden: "asc" as const },
  include: { fotos_correccion_parametro: true },
};

export async function getControlesPendientesCorreccion(req: Request, res: Response) {
  try {
    if (!ensureJefeObra(req, res)) return;

    const controles = await prisma.controles_inspeccion.findMany({
      where: { conformidad: "no_conforme", correccion_enviada_at: null },
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

    return res.json({ success: true, data: controles });
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
      where: { registro_terreno_id: registroId },
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

    return res.json({ success: true, data: control });
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

    const control = await prisma.controles_inspeccion.findUnique({ where: { id: controlId } });

    if (!control) {
      return res.status(404).json({ success: false, error: "Control de inspección no encontrado" });
    }

    if (control.conformidad !== "no_conforme") {
      return res.status(400).json({ success: false, error: "Este control no requiere corrección" });
    }

    const parametrosConTexto = parametros.filter(
      (p: any) =>
        p?.parametroId && typeof p.correccionObservacion === "string" && p.correccionObservacion.trim()
    );

    await prisma.$transaction([
      ...parametrosConTexto.map((p: any) =>
        prisma.controles_inspeccion_parametros.update({
          where: { id: p.parametroId },
          data: {
            correccion_observacion: normalizeText(p.correccionObservacion),
            corregido_at: new Date(),
            corregido_por_id: userId,
          },
        })
      ),
      prisma.controles_inspeccion.update({
        where: { id: controlId },
        data: {
          correccion_enviada_at: new Date(),
          correccion_enviada_por_id: userId,
        },
      }),
      prisma.registros_terreno.update({
        where: { id: control.registro_terreno_id },
        data: { inspeccion_revision_estado: "pendiente" },
      }),
    ]);

    const actualizado = await prisma.controles_inspeccion.findUnique({
      where: { id: controlId },
      include: { controles_inspeccion_parametros: PARAMETRO_INCLUDE },
    });

    return res.json({ success: true, data: actualizado });
  } catch (error) {
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
              include: { obras: { select: { codigo: true } } },
            },
          },
        },
      },
    });

    if (!parametro) {
      return res.status(404).json({ success: false, error: "Parámetro no encontrado" });
    }

    const registro = parametro.controles_inspeccion.registros_terreno;
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

      return res.status(201).json({ success: true, data: fotos });
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
