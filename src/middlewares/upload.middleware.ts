import multer from "multer";
import { NextFunction, Request, Response } from "express";

const storage = multer.memoryStorage();
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
    fileSize: 5 * 1024 * 1024,
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
  upload.array("fotos", 10)(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      return res.status(400).json({
        success: false,
        error:
          error.code === "LIMIT_FILE_SIZE"
            ? "Cada imagen debe pesar 5 MB o menos"
            : "No se pudieron procesar las imágenes",
      });
    }

    return res.status(400).json({
      success: false,
      error: error.message || "No se pudieron procesar las imágenes",
    });
  });
}
