import { Router, Request, Response, NextFunction } from "express";
import { verifyAppToken } from "../middlewares/auth.middleware";
import { InventarioBeckError } from "../services/inventarioBeck.service";
import { obrasInventarioAdmin, asignacionesInventarioAdmin, trazabilidadInventarioAdmin } from "../services/inventarioAdmin.service";

export function soloAdministradorBeck(req: Request, res: Response, next: NextFunction) {
  if (req.user?.rol !== "administrador" || req.user.empresa !== "beck")
    return res.status(403).json({ success: false, error: "Consulta exclusiva del administrador de BECK." });
  next();
}
const router = Router();
router.use(verifyAppToken, soloAdministradorBeck);
const consultar = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try { res.json({ success: true, data: await fn(req) }); }
  catch (e) {
    if (!(e instanceof InventarioBeckError)) console.error("INVENTARIO_ADMIN", e instanceof Error ? e.message : "Error");
    res.status(e instanceof InventarioBeckError ? e.status : 500).json({ success: false, error: e instanceof InventarioBeckError ? e.message : "No se pudo consultar el inventario de la obra." });
  }
};
router.get("/obras", consultar(() => obrasInventarioAdmin()));
router.get("/asignaciones", consultar(req => asignacionesInventarioAdmin(req.query)));
router.get("/asignaciones/:id/trazabilidad", consultar(req => trazabilidadInventarioAdmin(req.params.id, req.query)));
// No expone rutas de escritura ni reutiliza permisos de bodega.
export default router;
