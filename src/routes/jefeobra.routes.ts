import { Router } from "express";
import {
  enviarCorreccionControlInspeccion,
  getControlCorreccionDetalle,
  getControlesPendientesCorreccion,
  uploadCorreccionParametroFotos,
} from "../controllers/jefeobra.controller";
import { verifyAppToken } from "../middlewares/auth.middleware";
import { uploadCorreccionParametroFotosFiles } from "../middlewares/upload.middleware";

const router = Router();

router.get("/control-inspeccion/pendientes", verifyAppToken, getControlesPendientesCorreccion);
router.get("/control-inspeccion/:registroId", verifyAppToken, getControlCorreccionDetalle);
router.post(
  "/control-inspeccion/:controlId/correccion",
  verifyAppToken,
  enviarCorreccionControlInspeccion
);
router.post(
  "/control-inspeccion/parametro/:parametroId/fotos",
  verifyAppToken,
  uploadCorreccionParametroFotosFiles,
  uploadCorreccionParametroFotos
);

export default router;
