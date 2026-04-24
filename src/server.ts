import app from "./app";
import { env } from "./config/env";

app.listen(env.port, () => {
  console.log(`Backend móvil corriendo en http://localhost:${env.port}`);
});