import { Router } from "express";
import { getItemizadoOpciones } from "../controllers/itemizadoOpciones.controller";
import { verifyAppToken } from "../middlewares/auth.middleware";

const router = Router();

router.get("/", verifyAppToken, getItemizadoOpciones);

export default router;
