import type { Prisma } from "@prisma/client";

const CAMPOS_BUSQUEDA = [
  ["numero_sello", null],
  ["piso", "piso"],
  ["recinto", "recinto"],
  ["eje_numerico", "eje_numerico"],
  ["eje_alfabetico", "eje_alfabetico"],
  ["descripcion_material", "itemizadoBeck"],
] as const;

// Buscar antes de paginar y con la visibilidad de la obra de cada registro.
// El número de sello siempre es visible; los demás campos son configurables.
export function filtroBusquedaHistorialCliente(
  query: string,
): Prisma.registros_terrenoWhereInput {
  const search = query.trim();
  if (!search) return {};

  return {
    OR: CAMPOS_BUSQUEDA.map(([columna, campo]) => {
      const alias = columna === "numero_sello"
        ? /^sello\s+(.+)$/i.exec(search)?.[1]
        : columna === "piso"
          ? /^piso\s+(.+)$/i.exec(search)?.[1]
          : undefined;
      const coincidencia: Prisma.registros_terrenoWhereInput = {
        OR: [...new Set([search, ...(alias ? [alias.trim()] : [])])].map((term) => ({
          [columna]: { contains: term, mode: "insensitive" },
        })),
      };
      if (!campo) return coincidencia;
      return {
        AND: [
          coincidencia,
          {
            obras: {
              configuracion_campos_registro: {
                // Sin configuración propia se aplica el valor visible por defecto.
                none: { rol: "cliente", campo, visible: false },
              },
            },
          },
        ],
      };
    }),
  };
}
