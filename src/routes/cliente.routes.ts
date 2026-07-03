import { Router } from "express";
import {
  getClienteDashboard,
  getClienteHistorial,
  getClienteObras,
  getClienteRegistrosObra,
  validarRegistroCliente,
} from "../controllers/cliente.controller";
import { verifyAppToken } from "../middlewares/auth.middleware";

const router = Router();

router.get("/dashboard",                    verifyAppToken, getClienteDashboard);
router.get("/obras",                        verifyAppToken, getClienteObras);
router.get("/obras/:obraId/registros",      verifyAppToken, getClienteRegistrosObra);
// historial DEBE ir antes de :id para que no se interprete como parámetro
router.get("/registros/historial",          verifyAppToken, getClienteHistorial);
router.post("/registros/:id/validar",       verifyAppToken, validarRegistroCliente);

export default router;
