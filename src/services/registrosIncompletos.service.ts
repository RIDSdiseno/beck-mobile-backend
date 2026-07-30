import { prisma } from "../config/prisma";

const UNA_HORA_MS = 60 * 60 * 1000;
const INTERVALO_LIMPIEZA_MS = 15 * 60 * 1000;

export async function eliminarRegistroIncompleto(
  registroId: string,
  usuarioId: string,
) {
  const result = await prisma.registros_terreno.deleteMany({
    where: {
      id: registroId,
      usuario_id: usuarioId,
      carga_completa: false,
    },
  });

  return result.count === 1;
}

export async function limpiarRegistrosIncompletosAbandonados(
  ahora = new Date(),
) {
  const limite = new Date(ahora.getTime() - UNA_HORA_MS);

  const result = await prisma.registros_terreno.deleteMany({
    where: {
      carga_completa: false,
      created_at: {
        lt: limite,
      },
    },
  });

  if (result.count > 0) {
    console.info("REGISTROS_INCOMPLETOS_ELIMINADOS", {
      cantidad: result.count,
      anterioresA: limite.toISOString(),
    });
  }

  return result.count;
}

export function iniciarLimpiezaRegistrosIncompletos() {
  void limpiarRegistrosIncompletosAbandonados().catch((error) => {
    console.error("LIMPIEZA_REGISTROS_INCOMPLETOS_ERROR:", error);
  });

  const timer = setInterval(() => {
    void limpiarRegistrosIncompletosAbandonados().catch((error) => {
      console.error("LIMPIEZA_REGISTROS_INCOMPLETOS_ERROR:", error);
    });
  }, INTERVALO_LIMPIEZA_MS);

  timer.unref();
  return timer;
}
