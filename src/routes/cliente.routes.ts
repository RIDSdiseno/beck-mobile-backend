import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  getClienteDashboard,
  getClienteHistorial,
  getClienteRegistroDetalle,
  getClienteObras,
  getClienteRegistrosObra,
  descargarPdfCliente,
  validarRegistroCliente,
} from "../controllers/cliente.controller";
import { verifyAppToken } from "../middlewares/auth.middleware";

const router = Router();

const firmaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Demasiadas solicitudes de firma. Espera un momento e intenta de nuevo." },
});

router.get("/dashboard",                    verifyAppToken, getClienteDashboard);
router.get("/obras",                        verifyAppToken, getClienteObras);
router.get("/obras/:obraId/registros",      verifyAppToken, getClienteRegistrosObra);
// historial DEBE ir antes de :id para que no se interprete como parámetro
router.get("/registros/historial",          verifyAppToken, getClienteHistorial);
router.get("/registros/:id",                verifyAppToken, getClienteRegistroDetalle);
router.get("/registros/:id/pdf",             verifyAppToken, descargarPdfCliente);
router.post("/registros/:id/validar",       verifyAppToken, firmaLimiter, validarRegistroCliente);

export default router;
