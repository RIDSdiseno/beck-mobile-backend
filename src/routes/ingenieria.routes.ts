import { Router } from "express";
import {
  createControlInspeccion,
  getControlInspeccion,
  getIngenieriaRegistroById,
  getIngenieriaRegistros,
  getIngenieriaResumen,
  iniciarRevisionIngenieria,
  marcarInspeccionIngenieria,
  rechazarRegistroIngenieria,
  updateRegistroIngenieria,
  uploadControlInspeccionFotos,
  validarRegistroIngenieria,
} from "../controllers/ingenieria.controller";
import { descargarRegistroPdf } from "../controllers/registroPdf.controller";
import { verifyAppToken } from "../middlewares/auth.middleware";
import { uploadControlInspeccionFotosFiles } from "../middlewares/upload.middleware";

const router = Router();

router.get("/resumen", verifyAppToken, getIngenieriaResumen);
router.get("/registros", verifyAppToken, getIngenieriaRegistros);
router.get("/registros/:id", verifyAppToken, getIngenieriaRegistroById);
router.get("/registros/:id/pdf", verifyAppToken, descargarRegistroPdf);
router.put("/registros/:id", verifyAppToken, updateRegistroIngenieria);
router.put("/registros/:id/iniciar-revision", verifyAppToken, iniciarRevisionIngenieria);
router.put("/registros/:id/validar", verifyAppToken, validarRegistroIngenieria);
router.put("/registros/:id/rechazar", verifyAppToken, rechazarRegistroIngenieria);
router.patch("/registros/:id/inspeccion", verifyAppToken, marcarInspeccionIngenieria);
router.get("/registros/:id/control-inspeccion", verifyAppToken, getControlInspeccion);
router.post("/registros/:id/control-inspeccion", verifyAppToken, createControlInspeccion);
router.post(
  "/registros/:id/control-inspeccion/:controlId/fotos",
  verifyAppToken,
  uploadControlInspeccionFotosFiles,
  uploadControlInspeccionFotos
);

export default router;
