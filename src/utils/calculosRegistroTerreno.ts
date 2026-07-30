export interface TramoHolgura {
  holguraMax: number;
  factor: number;
}

export interface CalcRegistroInput {
  cantidad_sellos: number;
  holgura: number;
  accesibilidad: unknown;
  aislacion: unknown;
  reparacion_tabique: unknown;
  piso: string;
  tipoRegistro: string;
  tramosHolgura?: TramoHolgura[];
}

export interface CalcRegistroResult {
  factor_por_holguras: number;
  cantidad_sellos_con_factores: number;
  cantidad_sellos_aislacion: number;
  cantidad_final: number;
  aislacion_normalizada: number;
  reparacion_tabique_normalizada: number;
}

const TRAMOS_HOLGURA_JUNTA_LINEAL: TramoHolgura[] = [
  { holguraMax: 2, factor: 1 },
  { holguraMax: 3, factor: 1.5 },
  { holguraMax: 4, factor: 2 },
  { holguraMax: 5, factor: 2.5 },
];

const TRAMOS_HOLGURA_GENERICO: TramoHolgura[] = [
  { holguraMax: 2, factor: 1 },
  { holguraMax: 4, factor: 1.2 },
  { holguraMax: 6, factor: 1.4 },
  { holguraMax: 10, factor: 1.8 },
];

export function getTramosHolguraPorDefecto(
  tipoRegistro: string
): TramoHolgura[] {
  return tipoRegistro === "junta_lineal_espuma"
    ? TRAMOS_HOLGURA_JUNTA_LINEAL
    : TRAMOS_HOLGURA_GENERICO;
}

function resolveHolguraFactor(
  holgura: number,
  tramos: TramoHolgura[]
): number {
  const ordenados = [...tramos].sort((a, b) => a.holguraMax - b.holguraMax);

  for (const tramo of ordenados) {
    if (holgura <= tramo.holguraMax) return tramo.factor;
  }

  throw new Error("CORREGIR HOLGURA");
}

function resolveAccesibilidadFactor(accesibilidad: unknown): number {
  if (accesibilidad === null || accesibilidad === undefined) return 1;
  if (typeof accesibilidad === "number" && Number.isFinite(accesibilidad)) {
    return accesibilidad;
  }

  const value = String(accesibilidad).trim();
  const parsed = Number.parseFloat(value.replace(",", "."));
  if (Number.isFinite(parsed)) return parsed;

  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");

  if (normalized === "normal") return 1;
  if (normalized.includes("cielo") && normalized.includes("duro")) return 3;
  if (
    normalized.includes("cielo") &&
    (normalized.includes("americano") || normalized.includes("estructurado"))
  ) {
    return 2;
  }
  if (normalized.includes("gateras")) return 3;
  return 1;
}

function resolveAislacionFactor(aislacion: unknown): number {
  if (aislacion === null || aislacion === undefined || aislacion === "") return 1;
  if (typeof aislacion === "boolean") return aislacion ? 1.3 : 1;
  if (typeof aislacion === "number") return aislacion;

  const value = String(aislacion).trim();
  const parsed = Number.parseFloat(value.replace(",", "."));
  if (Number.isFinite(parsed)) return parsed;

  const normalized = value
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");

  return normalized === "APLICA" || normalized === "SI" ? 1.3 : 1;
}

function resolveReparacionTabique(reparacion: unknown): boolean {
  if (
    reparacion === null ||
    reparacion === undefined ||
    reparacion === ""
  ) {
    return false;
  }
  if (typeof reparacion === "boolean") return reparacion;
  if (typeof reparacion === "number") return reparacion >= 1;

  const value = String(reparacion).trim();
  const parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed)) return parsed >= 1;

  const normalized = value
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");

  return normalized === "APLICA" || normalized === "SI";
}

export function calcularCamposRegistroTerreno(
  input: CalcRegistroInput
): CalcRegistroResult {
  const tramos =
    input.tramosHolgura ?? getTramosHolguraPorDefecto(input.tipoRegistro);
  const factor_por_holguras = resolveHolguraFactor(input.holgura, tramos);
  const accesibilidadFactor = resolveAccesibilidadFactor(input.accesibilidad);
  const aislacion_normalizada = resolveAislacionFactor(input.aislacion);
  const aplicaReparacion = resolveReparacionTabique(input.reparacion_tabique);
  const esSotano = input.piso === "-1";

  const cantidad_sellos_con_factores = esSotano
    ? input.cantidad_sellos *
      factor_por_holguras *
      accesibilidadFactor *
      1.1
    : input.cantidad_sellos *
      factor_por_holguras *
      accesibilidadFactor;
  const cantidad_sellos_aislacion = aislacion_normalizada;
  const base = cantidad_sellos_con_factores * aislacion_normalizada;
  const cantidad_final = esSotano
    ? base
    : aplicaReparacion
      ? base + 1
      : base;

  return {
    factor_por_holguras,
    cantidad_sellos_con_factores,
    cantidad_sellos_aislacion,
    cantidad_final,
    aislacion_normalizada,
    reparacion_tabique_normalizada: aplicaReparacion ? 1 : 0,
  };
}
