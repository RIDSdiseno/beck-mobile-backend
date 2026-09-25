import { resolveAccesibilidadFactor, type FactorAccesibilidadNivel } from "./calculosRegistroTerreno";

const DESCRIPCIONES: Record<number, string> = {
  0: "No aplica",
  1: "Accesibilidad normal",
  2: "Cielos Americanos o estructurado",
  3: "Cielo duro y gateras",
};

/** Presentación del nivel guardado con el factor vigente, sin modificar el registro. */
export function describirAccesibilidad(nivel: unknown, factores: FactorAccesibilidadNivel[]) {
  if (nivel === null || nivel === undefined || nivel === "") return null;
  const numero = Number(nivel);
  const descripcion = DESCRIPCIONES[numero];
  if (!descripcion) return "Accesibilidad no identificada";
  const factor = resolveAccesibilidadFactor(numero, factores);
  if (!Number.isFinite(factor) || factor <= 0) return `${descripcion} - Factor no disponible`;
  const textoFactor = Number.isInteger(factor) ? factor.toFixed(1) : String(factor);
  return `${descripcion} - Factor ${textoFactor}`;
}
