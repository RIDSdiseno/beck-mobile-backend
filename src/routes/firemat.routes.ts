import { Router } from "express";
import {
  asociarCodigoBarraFiremat,
  createRecepcionEscaneoFiremat,
  createProductoFiremat,
  getCategoriasFiremat,
  getInventarioFiremat,
  getProductosFiremat,
  getProductoPorCodigoBarraFiremat,
  updateInventarioFiremat,
  updateProductoFiremat,
} from "../controllers/firemat.controller";
import { verifyAppToken } from "../middlewares/auth.middleware";
import { permitirFiremat } from "../middlewares/firematAccess.middleware";

const router = Router();
const rolesFiremat = permitirFiremat();
const gestionarInventario = permitirFiremat(true);

router.use(verifyAppToken, rolesFiremat);
router.get("/categorias", getCategoriasFiremat);
router.get("/productos", getProductosFiremat);
router.post("/productos", gestionarInventario, createProductoFiremat);
router.put("/productos/:id", gestionarInventario, updateProductoFiremat);
router.get("/inventario", getInventarioFiremat);
router.get("/inventario/codigo/:codigo", gestionarInventario, getProductoPorCodigoBarraFiremat);
router.post("/inventario/codigos", gestionarInventario, asociarCodigoBarraFiremat);
router.post("/inventario/recepciones", gestionarInventario, createRecepcionEscaneoFiremat);
router.patch("/inventario/:productoId", gestionarInventario, updateInventarioFiremat);

export default router;
