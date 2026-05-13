import { Router } from "express";
import { verifyAppToken } from "../middlewares/auth.middleware";
import { uploadRegistroFotosFiles } from "../middlewares/upload.middleware";
import {
  createRegistro,
  getMisRegistros,
  updateRegistroObservaciones,
  uploadRegistroFotos,
} from "../controllers/registros.controller";

const router = Router();

router.get("/mis-registros", verifyAppToken, getMisRegistros);
router.post("/", verifyAppToken, createRegistro);
router.put("/:id/observaciones", verifyAppToken, updateRegistroObservaciones);
router.post(
  "/:id/fotos",
  verifyAppToken,
  uploadRegistroFotosFiles,
  uploadRegistroFotos
);

export default router;
