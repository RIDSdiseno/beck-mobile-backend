import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { env } from "./config/env";
import authRoutes from "./routes/auth.routes";
import clienteRoutes from "./routes/cliente.routes";
import ingenieriaRoutes from "./routes/ingenieria.routes";
import itemizadoOpcionesRoutes from "./routes/itemizadoOpciones.routes";
import jefeobraRoutes from "./routes/jefeobra.routes";
import obrasRoutes from "./routes/obras.routes";
import registrosRoutes from "./routes/registros.routes";


const app = express();

app.disable("x-powered-by");
if (env.trustProxy !== "false") {
  const parsedTrustProxy = Number(env.trustProxy);
  app.set(
    "trust proxy",
    Number.isInteger(parsedTrustProxy) ? parsedTrustProxy : env.trustProxy,
  );
}
app.use(helmet());
app.use((req, res, next) => {
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
});
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: "Demasiadas solicitudes. Intenta nuevamente en unos minutos.",
      code: "RATE_LIMITED",
    },
  }),
);

if (env.corsOrigin !== "none") {
  app.use(
    cors({
      origin:
        env.corsOrigin === "*"
          ? "*"
          : env.corsOrigin.split(",").map((origin) => origin.trim()),
    })
  );
}
app.use(express.json({ limit: "256kb" }));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "beck-mobile-backend",
    message: "Backend móvil corriendo",
  });
});

app.use("/api/mobile/auth", authRoutes);
app.use("/api/cliente", clienteRoutes);
app.use("/api/ingenieria", ingenieriaRoutes);
app.use("/api/itemizado-opciones", itemizadoOpcionesRoutes);
app.use("/api/jefeobra", jefeobraRoutes);
app.use("/api/obras", obrasRoutes);
app.use("/api/registros", registrosRoutes);

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: "Ruta no encontrada",
    code: "NOT_FOUND",
  });
});

app.use(
  (
    error: Error & { type?: string; status?: number },
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({
        success: false,
        error: "El cuerpo de la solicitud no contiene JSON válido",
        code: "INVALID_JSON",
      });
    }

    console.error("UNHANDLED_REQUEST_ERROR", {
      requestId: res.locals.requestId,
      message: error.message,
    });
    return res.status(error.status || 500).json({
      success: false,
      error: "Error interno del servidor",
      code: "INTERNAL_ERROR",
    });
  },
);

export default app;
