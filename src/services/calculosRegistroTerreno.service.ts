import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import {
  calcularCamposRegistroTerreno,
  getFactoresAccesibilidadPorDefecto,
  getFactoresAislacionPorDefecto,
  getTramosHolguraPorDefecto,
  type CalcRegistroInput,
  type CalcRegistroResult,
  type FactorAccesibilidadNivel,
  type FactorAislacionEstado,
  type TramoHolgura,
} from "../utils/calculosRegistroTerreno";

type FactorHolguraRow = {
  holgura_max: Prisma.Decimal;
  factor: Prisma.Decimal;
};

type FactorAccesibilidadRow = {
  nivel: number;
  factor: Prisma.Decimal;
};

type FactorAislacionRow = {
  aplica: boolean;
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

export async function getFactoresAccesibilidadObra(
  obraId: string,
): Promise<FactorAccesibilidadNivel[]> {
  const rows = await prisma.$queryRaw<FactorAccesibilidadRow[]>(Prisma.sql`
    SELECT nivel, factor
    FROM factor_accesibilidad_obra
    WHERE obra_id = ${obraId}::uuid
    ORDER BY nivel ASC
  `);
  const defaults = getFactoresAccesibilidadPorDefecto();
  const porNivel = new Map(rows.map((row) => [row.nivel, Number(row.factor)]));

  return defaults.map((item) => ({
    nivel: item.nivel,
    factor: porNivel.get(item.nivel) ?? item.factor,
  }));
}

export async function getFactoresAislacionObra(
  obraId: string,
): Promise<FactorAislacionEstado[]> {
  const rows = await prisma.$queryRaw<FactorAislacionRow[]>(Prisma.sql`
    SELECT aplica, factor
    FROM factor_aislacion_obra
    WHERE obra_id = ${obraId}::uuid
  `);
  const defaults = getFactoresAislacionPorDefecto();
  const porEstado = new Map(
    rows.map((row) => [row.aplica, Number(row.factor)]),
  );

  return defaults.map((item) => ({
    aplica: item.aplica,
    factor: porEstado.get(item.aplica) ?? item.factor,
  }));
}

export async function calcularCamposConConfiguracion(
  obraId: string,
  input: Omit<
    CalcRegistroInput,
    "tramosHolgura" | "factoresAccesibilidad" | "factoresAislacion"
  >,
): Promise<CalcRegistroResult> {
  const [tramosHolgura, factoresAccesibilidad, factoresAislacion] =
    await Promise.all([
      getTramosHolguraObra(obraId, input.tipoRegistro),
      getFactoresAccesibilidadObra(obraId),
      getFactoresAislacionObra(obraId),
    ]);

  return calcularCamposRegistroTerreno({
    ...input,
    tramosHolgura,
    factoresAccesibilidad,
    factoresAislacion,
  });
}
