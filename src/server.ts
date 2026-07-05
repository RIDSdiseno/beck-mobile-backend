import app from "./app";
import { env } from "./config/env";

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED_REJECTION:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT_EXCEPTION:", error);
  process.exit(1);
});

app.listen(env.port, () => {
  console.log(`Backend móvil corriendo en http://localhost:${env.port}`);
});