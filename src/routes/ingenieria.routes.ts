import { Router } from "express";
import {
  getIngenieriaRegistros,
  getIngenieriaResumen,
  iniciarRevisionIngenieria,
  rechazarRegistroIngenieria,
  updateRegistroIngenieria,
  validarRegistroIngenieria,
} from "../controllers/ingenieria.controller";
import { verifyAppToken } from "../middlewares/auth.middleware";

const router = Router();

router.get("/resumen", verifyAppToken, getIngenieriaResumen);
router.get("/registros", verifyAppToken, getIngenieriaRegistros);
router.put("/registros/:id", verifyAppToken, updateRegistroIngenieria);
router.put(
  "/registros/:id/iniciar-revision",
  verifyAppToken,
  iniciarRevisionIngenieria
);
router.put("/registros/:id/validar", verifyAppToken, validarRegistroIngenieria);
router.put("/registros/:id/rechazar", verifyAppToken, rechazarRegistroIngenieria);

export default router;
