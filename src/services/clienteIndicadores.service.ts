import { prisma } from "../config/prisma";

/** Sellos físicos aprobados por Ingeniería, firmados o pendientes del cliente. */
export async function obtenerSellosClientePorObra(obraIds: string[]) {
  if (!obraIds.length) return new Map<string, number>();
  const grupos = await prisma.registros_terreno.groupBy({
    by: ["obra_id"],
    where: {
      obra_id: { in: obraIds },
      estado: "validado",
      tipo_registro: "sello_cortafuego",
      carga_completa: true,
      // Una corrección reemplaza al original: no contar ambas versiones.
      other_registros_terreno: { none: {} },
    },
    _sum: { cantidad_sellos: true },
  });
  return new Map(grupos.map((grupo) => [grupo.obra_id, Number(grupo._sum.cantidad_sellos ?? 0)]));
}
