import { Router } from "express";

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
