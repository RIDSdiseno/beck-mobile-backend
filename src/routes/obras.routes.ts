import { Router } from "express";
import { getMisObras } from "../controllers/obras.controller";
import { verifyAppToken } from "../middlewares/auth.middleware";

const router = Router();

router.get("/mis-obras", verifyAppToken, getMisObras);

export default router;