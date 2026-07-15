import multer from "multer";
import { NextFunction, Request, Response } from "express";

const storage = multer.memoryStorage();
const MAX_REGISTRO_FOTOS = 10;
const MAX_CONTROL_INSPECCION_FOTOS = 5;
const MAX_CORRECCION_PARAMETRO_FOTOS = 5;
const MAX_IMAGE_SIZE_MB = 12;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const allowedImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_IMAGE_SIZE_BYTES,
    files: MAX_REGISTRO_FOTOS,
  },
  fileFilter: (_req, file, cb) => {
    if (allowedImageMimeTypes.has(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error("Solo se permiten archivos de imagen"));
  },
});

export function uploadRegistroFotosFiles(
  req: Request,
  res: Response,
  next: NextFunction
) {
  upload.array("fotos", MAX_REGISTRO_FOTOS)(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      return res.status(400).json({
        success: false,
        error:
          error.code === "LIMIT_FILE_SIZE"
            ? `Cada imagen debe pesar ${MAX_IMAGE_SIZE_MB} MB o menos`
            : error.code === "LIMIT_FILE_COUNT"
              ? `Puedes subir hasta ${MAX_REGISTRO_FOTOS} fotografias por registro`
              : "No se pudieron procesar las imágenes",
      });
    }

    return res.status(400).json({
      success: false,
      error: error.message || "No se pudieron procesar las imágenes",
    });
  });
}

export function uploadControlInspeccionFotosFiles(
  req: Request,
  res: Response,
  next: NextFunction
) {
  upload.array("fotos", MAX_CONTROL_INSPECCION_FOTOS)(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      return res.status(400).json({
        success: false,
        error:
          error.code === "LIMIT_FILE_SIZE"
            ? `Cada imagen debe pesar ${MAX_IMAGE_SIZE_MB} MB o menos`
            : error.code === "LIMIT_FILE_COUNT"
              ? `Puedes subir hasta ${MAX_CONTROL_INSPECCION_FOTOS} fotografias por control`
              : "No se pudieron procesar las imágenes",
      });
    }

    return res.status(400).json({
      success: false,
      error: error.message || "No se pudieron procesar las imágenes",
    });
  });
}

export function uploadCorreccionParametroFotosFiles(
  req: Request,
  res: Response,
  next: NextFunction
) {
  upload.array("fotos", MAX_CORRECCION_PARAMETRO_FOTOS)(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      return res.status(400).json({
        success: false,
        error:
          error.code === "LIMIT_FILE_SIZE"
            ? `Cada imagen debe pesar ${MAX_IMAGE_SIZE_MB} MB o menos`
            : error.code === "LIMIT_FILE_COUNT"
              ? `Puedes subir hasta ${MAX_CORRECCION_PARAMETRO_FOTOS} fotografias por parámetro`
              : "No se pudieron procesar las imágenes",
      });
    }

    return res.status(400).json({
      success: false,
      error: error.message || "No se pudieron procesar las imágenes",
    });
  });
}
