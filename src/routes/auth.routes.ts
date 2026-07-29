import { Router } from "express";
import rateLimit from "express-rate-limit";
import { emailLogin } from "../controllers/auth.controller";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Demasiados intentos. Intenta de nuevo en 15 minutos." },
});

router.post("/email", authLimiter, emailLogin);

export default router;
