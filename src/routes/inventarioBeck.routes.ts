import { Router } from "express";
import { listarConsumos, solicitarConsumo, resolverConsumo, ConsumoError } from "../services/consumosInventario.service";

import {
  getDisponibleSupervisor,
  getEntregadosSupervisor,
  getHistorialMiEquipo,
  getInventarioPorCodigo,
  getMiEquipo,
  getObrasInventarioSupervisor,
  getOperariosInventario,
  getTrazabilidad,
  getTrazabilidadItem,
  postConfirmarRecepcion,
  postDevolverABodega,
  postRecibirDevolucion,
  postSolicitarDevolucion,
  postAsignacionInventario,
} from "../controllers/inventarioBeck.controller";
import { checkRole, verifyAppToken } from "../middlewares/auth.middleware";

const router = Router();

router.use(verifyAppToken);
const consumoAction = (fn: (req: import("express").Request) => Promise<unknown>) => async (req: import("express").Request, res: import("express").Response) => {
  try { return res.json({ success: true, data: await fn(req) }); }
  catch (e) { return res.status(e instanceof ConsumoError ? e.status : 500).json({ success: false, error: e instanceof ConsumoError ? e.message : "No se pudo procesar el consumo." }); }
};
router.get("/operario/consumos", checkRole("terreno"), consumoAction(req => listarConsumos("operario", req.user!.id, req.query)));
router.get("/supervisor/consumos", checkRole("jefeobra"), consumoAction(req => listarConsumos("supervisor", req.user!.id, req.query)));
router.post("/operario/asignaciones/:id/consumo", checkRole("terreno"), consumoAction(req => solicitarConsumo(req.user!.id, req.params.id, req.body ?? {})));
router.post("/supervisor/consumos/:id/resolver", checkRole("jefeobra"), consumoAction(req => resolverConsumo(req.user!.id, req.params.id, req.body?.confirmar, req.body?.motivo)));
router.get("/supervisor/obras", checkRole("jefeobra"), getObrasInventarioSupervisor);
router.get("/supervisor/codigo/:codigo", checkRole("jefeobra"), getInventarioPorCodigo);
router.get("/supervisor/disponible", checkRole("jefeobra"), getDisponibleSupervisor);
router.get("/supervisor/entregados", checkRole("jefeobra"), getEntregadosSupervisor);
router.get("/supervisor/operarios", checkRole("jefeobra"), getOperariosInventario);
router.post("/supervisor/asignaciones", checkRole("jefeobra"), postAsignacionInventario);
router.post("/supervisor/asignaciones/:id/recibir-devolucion", checkRole("jefeobra"), postRecibirDevolucion);
router.post("/supervisor/devoluciones-bodega", checkRole("jefeobra"), postDevolverABodega);
router.get("/supervisor/trazabilidad-item", checkRole("jefeobra"), getTrazabilidadItem);
router.get("/operario/asignaciones", checkRole("terreno"), getMiEquipo);
router.get("/operario/historial", checkRole("terreno"), getHistorialMiEquipo);
router.post("/operario/asignaciones/:id/confirmar-recepcion", checkRole("terreno"), postConfirmarRecepcion);
router.post("/operario/asignaciones/:id/solicitar-devolucion", checkRole("terreno"), postSolicitarDevolucion);
router.get("/asignaciones/:id/trazabilidad", checkRole("jefeobra", "terreno"), getTrazabilidad);

export default router;
