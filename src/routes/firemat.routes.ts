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
import { checkRole, verifyAppToken } from "../middlewares/auth.middleware";

const router = Router();
const rolesFiremat = checkRole("vendedor_firemat", "bodeguero", "visualizador_firemat");
const soloBodeguero = checkRole("bodeguero");

router.use(verifyAppToken, rolesFiremat);
router.get("/categorias", getCategoriasFiremat);
router.get("/productos", getProductosFiremat);
router.post("/productos", soloBodeguero, createProductoFiremat);
router.put("/productos/:id", soloBodeguero, updateProductoFiremat);
router.get("/inventario", getInventarioFiremat);
router.get("/inventario/codigo/:codigo", soloBodeguero, getProductoPorCodigoBarraFiremat);
router.post("/inventario/codigos", soloBodeguero, asociarCodigoBarraFiremat);
router.post("/inventario/recepciones", soloBodeguero, createRecepcionEscaneoFiremat);
router.patch("/inventario/:productoId", soloBodeguero, updateInventarioFiremat);

export default router;
