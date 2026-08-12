import { Router } from "express";
import {
  createProductoFiremat,
  getCategoriasFiremat,
  getInventarioFiremat,
  getProductosFiremat,
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
router.patch("/inventario/:productoId", soloBodeguero, updateInventarioFiremat);

export default router;
