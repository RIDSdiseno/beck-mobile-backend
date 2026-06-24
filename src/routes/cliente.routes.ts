import { Router } from "express";
import {
  getClienteDashboard,
  getClienteObras,
  getClienteRegistrosObra,
} from "../controllers/cliente.controller";
import { verifyAppToken } from "../middlewares/auth.middleware";

const router = Router();

router.get("/dashboard", verifyAppToken, getClienteDashboard);
router.get("/obras", verifyAppToken, getClienteObras);
router.get("/obras/:obraId/registros", verifyAppToken, getClienteRegistrosObra);

export default router;
