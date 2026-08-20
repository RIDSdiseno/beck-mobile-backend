import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

export type ModuloActividadApp = "operario" | "supervisor" | "ingenieria" | "administracion";

export async function registrarActividadAdministrador(input: {
  usuarioId: string;
  modulo: ModuloActividadApp;
  accion: string;
  descripcion: string;
  metodo: string;
  ruta: string;
  entidadTipo?: string | null;
  entidadId?: string | null;
  datos?: Prisma.InputJsonValue;
}) {
  return prisma.actividad_app.create({
    data: {
      usuario_id: input.usuarioId,
      modulo: input.modulo,
      accion: input.accion,
      descripcion: input.descripcion,
      metodo: input.metodo,
      ruta: input.ruta,
      entidad_tipo: input.entidadTipo || null,
      entidad_id: input.entidadId || null,
      datos: input.datos,
    },
  });
}
