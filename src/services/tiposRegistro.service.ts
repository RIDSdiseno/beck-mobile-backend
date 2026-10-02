import { prisma } from "../config/prisma";

export const TIPOS_REGISTRO_MOVIL = ["sello_cortafuego", "junta_lineal_espuma", "tabiqueria"];

// Misma regla del CRM: una obra sin tipos activos conserva el comportamiento permisivo.
export async function getTiposRegistroPermitidos(obraId: string): Promise<string[]> {
  const rows = await prisma.obra_tipos_registro.findMany({
    where: { obra_id: obraId, activo: true },
    select: { tipo_registro: true },
  });
  if (!rows.length) return [...TIPOS_REGISTRO_MOVIL];
  return TIPOS_REGISTRO_MOVIL.filter((tipo) => rows.some((row) => row.tipo_registro === tipo));
}
