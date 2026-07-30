import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import {
  calcularCamposRegistroTerreno,
  getTramosHolguraPorDefecto,
  type CalcRegistroInput,
  type CalcRegistroResult,
  type TramoHolgura,
} from "../utils/calculosRegistroTerreno";

type FactorHolguraRow = {
  holgura_max: Prisma.Decimal;
  factor: Prisma.Decimal;
};

export async function getTramosHolguraObra(
  obraId: string,
  tipoRegistro: string
): Promise<TramoHolgura[]> {
  const rows = await prisma.$queryRaw<FactorHolguraRow[]>(Prisma.sql`
    SELECT holgura_max, factor
    FROM factor_holgura_tramos
    WHERE obra_id = ${obraId}::uuid
      AND tipo_registro = ${tipoRegistro}
    ORDER BY orden ASC
  `);

  if (rows.length === 0) {
    return getTramosHolguraPorDefecto(tipoRegistro);
  }

  return rows.map((row) => ({
    holguraMax: Number(row.holgura_max),
    factor: Number(row.factor),
  }));
}

export async function calcularCamposConConfiguracion(
  obraId: string,
  input: Omit<CalcRegistroInput, "tramosHolgura">
): Promise<CalcRegistroResult> {
  const tramosHolgura = await getTramosHolguraObra(
    obraId,
    input.tipoRegistro
  );

  return calcularCamposRegistroTerreno({
    ...input,
    tramosHolgura,
  });
}
