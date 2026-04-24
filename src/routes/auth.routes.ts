import { Router } from "express";
import { microsoftLogin } from "../controllers/auth.controller";

const router = Router();

router.post("/microsoft", microsoftLogin);

export default router;