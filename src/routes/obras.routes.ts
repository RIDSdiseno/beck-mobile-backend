import { Router } from "express";
import {
  getConfiguracionRegistro,
  getMisObras,
} from "../controllers/obras.controller";
import { verifyAppToken } from "../middlewares/auth.middleware";

const router = Router();

router.get("/mis-obras", verifyAppToken, getMisObras);
router.get("/:id/configuracion-registro", verifyAppToken, getConfiguracionRegistro);

export default router;
