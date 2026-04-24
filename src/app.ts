import cors from "cors";
import express from "express";
import authRoutes from "./routes/auth.routes";
import obrasRoutes from "./routes/obras.routes";


const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "beck-mobile-backend",
    message: "Backend móvil corriendo",
  });
});

app.use("/api/mobile/auth", authRoutes);
app.use("/api/obras", obrasRoutes);


export default app;