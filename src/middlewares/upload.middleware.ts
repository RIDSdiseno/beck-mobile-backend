import multer from "multer";
import { NextFunction, Request, Response } from "express";
import { eliminarRegistroIncompleto } from "../services/registrosIncompletos.service";

const storage = multer.memoryStorage();
const MAX_REGISTRO_FOTOS = 10;
const MAX_CONTROL_INSPECCION_FOTOS = 5;
const MAX_CORRECCION_PARAMETRO_FOTOS = 5;
const MAX_IMAGE_SIZE_MB = 8;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const allowedImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function hasAllowedImageSignature(file: Express.Multer.File) {
  const buffer = file.buffer;
  if (buffer.length < 12) return false;

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  const isWebp =
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP";
  const brand = buffer.subarray(8, 12).toString("ascii");
  const isHeif =
    buffer.subarray(4, 8).toString("ascii") === "ftyp" &&
    ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand);

  return isJpeg || isPng || isWebp || isHeif;
}

function validateUploadedImages(req: Request, res: Response, next: NextFunction) {
  const files = req.files as Express.Multer.File[] | undefined;
  if ((files || []).some((file) => !hasAllowedImageSignature(file))) {
    return res.status(400).json({
      success: false,
      error: "Uno de los archivos no contiene una imagen válida",
    });
  }
  next();
}

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
  upload.array("fotos", MAX_REGISTRO_FOTOS)(req, res, async (error) => {
    if (!error) {
      const files = req.files as Express.Multer.File[] | undefined;
      if ((files || []).some((file) => !hasAllowedImageSignature(file))) {
        if (req.user?.id && typeof req.params.id === "string") {
          await eliminarRegistroIncompleto(req.params.id, req.user.id).catch(
            (cleanupError) => {
              console.error("DELETE REGISTRO INCOMPLETO ERROR:", cleanupError);
            },
          );
        }
        return res.status(400).json({
          success: false,
          error: "Uno de los archivos no contiene una imagen válida",
        });
      }

      next();
      return;
    }

    if (req.user?.id && typeof req.params.id === "string") {
      await eliminarRegistroIncompleto(req.params.id, req.user.id).catch(
        (cleanupError) => {
          console.error("DELETE REGISTRO INCOMPLETO ERROR:", cleanupError);
        },
      );
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
      validateUploadedImages(req, res, next);
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
      validateUploadedImages(req, res, next);
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
