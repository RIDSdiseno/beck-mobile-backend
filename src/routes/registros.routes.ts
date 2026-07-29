import { Router } from "express";
import { checkRole, verifyAppToken } from "../middlewares/auth.middleware";
import { uploadRegistroFotosFiles } from "../middlewares/upload.middleware";
import {
  createRegistro,
  deleteRegistroPendiente,
  devolverRegistroATecnico,
  getMisRegistros,
  updateRegistroJefeObra,
  updateRegistroObservaciones,
  updateRegistroTecnico,
  uploadRegistroFotos,
} from "../controllers/registros.controller";

const router = Router();

router.get("/mis-registros", verifyAppToken, getMisRegistros);
router.post(
  "/",
  verifyAppToken,
  checkRole("terreno", "jefeobra", "administrador"),
  createRegistro,
);
router.delete("/:id", verifyAppToken, deleteRegistroPendiente);
router.put("/:id/enviar-ingenieria", verifyAppToken, updateRegistroJefeObra);
router.put("/:id/reenviar-tecnico", verifyAppToken, updateRegistroTecnico);
router.put("/:id/enviar-tecnico", verifyAppToken, devolverRegistroATecnico);
router.put("/:id/observaciones", verifyAppToken, updateRegistroObservaciones);
router.post(
  "/:id/fotos",
  verifyAppToken,
  uploadRegistroFotosFiles,
  uploadRegistroFotos
);

export default router;
