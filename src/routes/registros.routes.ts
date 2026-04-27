import { Router } from "express";
import { verifyAppToken } from "../middlewares/auth.middleware";
import { upload } from "../middlewares/upload.middleware";
import {
  createRegistro,
  updateRegistroObservaciones,
  uploadRegistroFotos,
} from "../controllers/registros.controller";

const router = Router();

router.post("/", verifyAppToken, createRegistro);
router.put("/:id/observaciones", verifyAppToken, updateRegistroObservaciones);
router.post(
  "/:id/fotos",
  verifyAppToken,
  upload.array("fotos", 10),
  uploadRegistroFotos
);

export default router;