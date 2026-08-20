import { Router } from "express";
import { getAdminActividad, getAdminResumen } from "../controllers/admin.controller";
import { checkRole, verifyAppToken } from "../middlewares/auth.middleware";

const router = Router();

router.use(verifyAppToken, checkRole("administrador"));
router.get("/resumen", getAdminResumen);
router.get("/actividad", getAdminActividad);

export default router;
