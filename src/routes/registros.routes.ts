import { Router } from "express";
import { verifyAppToken } from "../middlewares/auth.middleware";
import { uploadRegistroFotosFiles } from "../middlewares/upload.middleware";
import {
  createRegistro,
  getMisRegistros,
  updateRegistroJefeObra,
  updateRegistroObservaciones,
  uploadRegistroFotos,
} from "../controllers/registros.controller";

const router = Router();

router.get("/mis-registros", verifyAppToken, getMisRegistros);
router.post("/", verifyAppToken, createRegistro);
router.put("/:id/enviar-ingenieria", verifyAppToken, updateRegistroJefeObra);
router.put("/:id/observaciones", verifyAppToken, updateRegistroObservaciones);
router.post(
  "/:id/fotos",
  verifyAppToken,
  uploadRegistroFotosFiles,
  uploadRegistroFotos
);

export default router;
