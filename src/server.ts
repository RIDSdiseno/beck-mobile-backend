import app from "./app";
import { env } from "./config/env";
import { closePrismaConnection } from "./config/prisma";
import { iniciarLimpiezaRegistrosIncompletos } from "./services/registrosIncompletos.service";

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED_REJECTION:", reason);
  void shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT_EXCEPTION:", error);
  void shutdown("uncaughtException", 1);
});

const server = app.listen(env.port, () => {
  console.log(`Backend móvil corriendo en http://localhost:${env.port}`);
});
const registrosIncompletosTimer = iniciarLimpiezaRegistrosIncompletos();

let isShuttingDown = false;

async function shutdown(signal: string, exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  clearInterval(registrosIncompletosTimer);
  console.info("SHUTDOWN", { signal });

  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();

  server.close(async () => {
    try {
      await closePrismaConnection();
      clearTimeout(forceExit);
      process.exit(exitCode);
    } catch (error) {
      console.error("SHUTDOWN_ERROR:", error);
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
