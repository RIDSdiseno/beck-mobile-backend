import { Router } from "express";
import { getAdminActividad, getAdminResumen } from "../controllers/admin.controller";
import { checkRole, verifyAppToken } from "../middlewares/auth.middleware";
import { getAdminAvance, getAdminAvanceObras } from "../controllers/adminAvance.controller";

const router = Router();

router.use(verifyAppToken, checkRole("administrador"));
router.get("/resumen", getAdminResumen);
router.get("/actividad", getAdminActividad);
router.get("/avance-obras/opciones", getAdminAvanceObras);
router.get("/avance-obras", getAdminAvance);

export default router;
