import { prisma } from "../config/prisma";

export async function getMisObrasByUser(userId: string, rol: string) {
  if (rol === "administrador") {
    return prisma.obras.findMany({
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        nombre: true,
        codigo: true,
        descripcion: true,
        estado: true,
      },
    });
  }

  const asignaciones = await prisma.usuarios_obras.findMany({
    where: {
      usuario_id: userId,
    },
    include: {
      obras: {
        select: {
          id: true,
          nombre: true,
          codigo: true,
          descripcion: true,
          estado: true,
        },
      },
    },
    orderBy: {
      asignado_en: "desc",
    },
  });

  return asignaciones.map((item) => item.obras);
}