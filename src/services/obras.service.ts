import { prisma } from "../config/prisma";
import { EstadoObra } from "@prisma/client";

const ESTADOS_VISIBLES_TERRENO: EstadoObra[] = [
  EstadoObra.activa,
  EstadoObra.pausada,
];

function canViewAvailableObras(rol: string) {
  return rol === "terreno" || rol === "jefeobra";
}

const obraSelect = {
  id: true,
  nombre: true,
  codigo: true,
  descripcion: true,
  estado: true,
};

export async function getMisObrasByUser(userId: string, rol: string) {
  if (canViewAvailableObras(rol)) {
    return prisma.obras.findMany({
      where: {
        estado: {
          in: ESTADOS_VISIBLES_TERRENO,
        },
      },
      orderBy: { created_at: "desc" },
      select: obraSelect,
    });
  }

  if (rol === "administrador") {
    return prisma.obras.findMany({
      orderBy: { created_at: "desc" },
      select: obraSelect,
    });
  }

  const asignaciones = await prisma.usuarios_obras.findMany({
    where: {
      usuario_id: userId,
    },
    include: {
      obras: {
        select: obraSelect,
      },
    },
    orderBy: {
      asignado_en: "desc",
    },
  });

  return asignaciones.map((item: any) => item.obras);
}
