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
  validarRegistroIngenieria,
} from "../controllers/ingenieria.controller";
import { verifyAppToken } from "../middlewares/auth.middleware";

const router = Router();

router.get("/resumen", verifyAppToken, getIngenieriaResumen);
router.get("/registros", verifyAppToken, getIngenieriaRegistros);
router.get("/registros/:id", verifyAppToken, getIngenieriaRegistroById);
router.put("/registros/:id", verifyAppToken, updateRegistroIngenieria);
router.put("/registros/:id/iniciar-revision", verifyAppToken, iniciarRevisionIngenieria);
router.put("/registros/:id/validar", verifyAppToken, validarRegistroIngenieria);
router.put("/registros/:id/rechazar", verifyAppToken, rechazarRegistroIngenieria);
router.patch("/registros/:id/inspeccion", verifyAppToken, marcarInspeccionIngenieria);
router.get("/registros/:id/control-inspeccion", verifyAppToken, getControlInspeccion);
router.post("/registros/:id/control-inspeccion", verifyAppToken, createControlInspeccion);

export default router;
