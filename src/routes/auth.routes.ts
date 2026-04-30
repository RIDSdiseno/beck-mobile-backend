import { Router } from "express";
import { emailLogin, microsoftLogin } from "../controllers/auth.controller";

const router = Router();

router.post("/microsoft", microsoftLogin);
router.post("/email", emailLogin);

export default router;
