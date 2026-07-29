import { prisma } from "../config/prisma";
import { EstadoObra } from "@prisma/client";

const ESTADOS_VISIBLES_TERRENO: EstadoObra[] = [
  EstadoObra.activa,
  EstadoObra.pausada,
];

function canViewAvailableObras(rol: string) {
  return rol === "terreno" || rol === "jefeobra";
}

export async function canAccessObra(userId: string, rol: string | undefined, obraId: string) {
  if (rol === "administrador" || rol === "ingenieria") return true;

  if (rol === "terreno" || rol === "jefeobra") {
    const obra = await prisma.obras.findUnique({
      where: { id: obraId },
      select: { estado: true },
    });
    return obra?.estado === EstadoObra.activa || obra?.estado === EstadoObra.pausada;
  }

  const assignment = await prisma.usuarios_obras.findUnique({
    where: {
      usuario_id_obra_id: {
        usuario_id: userId,
        obra_id: obraId,
      },
    },
    select: { id: true },
  });
  return Boolean(assignment);
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
