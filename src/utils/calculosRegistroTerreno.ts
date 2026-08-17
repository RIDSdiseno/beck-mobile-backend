export interface TramoHolgura {
  holguraMax: number;
  factor: number;
}

export interface FactorAccesibilidadNivel {
  nivel: number;
  factor: number;
}

export interface FactorAislacionEstado {
  aplica: boolean;
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
  factoresAccesibilidad?: FactorAccesibilidadNivel[];
  factoresAislacion?: FactorAislacionEstado[];
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
  if (holgura === 0) return 1;

  const ordenados = [...tramos].sort((a, b) => a.holguraMax - b.holguraMax);

  for (const tramo of ordenados) {
    if (holgura <= tramo.holguraMax) return tramo.factor;
  }

  throw new Error("CORREGIR HOLGURA");
}

export function getFactoresAccesibilidadPorDefecto(): FactorAccesibilidadNivel[] {
  return [1, 2, 3].map((nivel) => ({ nivel, factor: nivel }));
}

function buscarFactorAccesibilidad(
  nivel: number,
  factores: FactorAccesibilidadNivel[],
): number {
  return factores.find((item) => item.nivel === nivel)?.factor ?? nivel;
}

export function resolveAccesibilidadFactor(
  accesibilidad: unknown,
  factoresAccesibilidad?: FactorAccesibilidadNivel[],
): number {
  const factores =
    factoresAccesibilidad ?? getFactoresAccesibilidadPorDefecto();
  const esNivel = (value: number) =>
    Number.isInteger(value) && value >= 1 && value <= 3;

  if (accesibilidad === null || accesibilidad === undefined) {
    return buscarFactorAccesibilidad(1, factores);
  }
  if (typeof accesibilidad === "number" && Number.isFinite(accesibilidad)) {
    if (accesibilidad === 0) return 1;
    return esNivel(accesibilidad)
      ? buscarFactorAccesibilidad(accesibilidad, factores)
      : accesibilidad;
  }

  const value = String(accesibilidad).trim();
  const parsed = Number.parseFloat(value.replace(",", "."));
  if (Number.isFinite(parsed)) {
    if (parsed === 0) return 1;
    return esNivel(parsed)
      ? buscarFactorAccesibilidad(parsed, factores)
      : parsed;
  }

  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");

  if (normalized === "no aplica") return 1;
  if (normalized === "normal") return buscarFactorAccesibilidad(1, factores);
  if (normalized.includes("cielo") && normalized.includes("duro")) {
    return buscarFactorAccesibilidad(3, factores);
  }
  if (
    normalized.includes("cielo") &&
    (normalized.includes("americano") || normalized.includes("estructurado"))
  ) {
    return buscarFactorAccesibilidad(2, factores);
  }
  if (normalized.includes("gateras")) {
    return buscarFactorAccesibilidad(3, factores);
  }
  return buscarFactorAccesibilidad(1, factores);
}

export function getFactoresAislacionPorDefecto(): FactorAislacionEstado[] {
  return [
    { aplica: true, factor: 1.3 },
    { aplica: false, factor: 1 },
  ];
}

function buscarFactorAislacion(
  aplica: boolean,
  factores: FactorAislacionEstado[],
): number {
  return (
    factores.find((item) => item.aplica === aplica)?.factor ??
    (aplica ? 1.3 : 1)
  );
}

export function resolveAislacionFactor(
  aislacion: unknown,
  factoresAislacion?: FactorAislacionEstado[],
): number {
  const factores = factoresAislacion ?? getFactoresAislacionPorDefecto();
  if (aislacion === null || aislacion === undefined || aislacion === "") {
    return buscarFactorAislacion(false, factores);
  }
  if (typeof aislacion === "boolean") {
    return buscarFactorAislacion(aislacion, factores);
  }
  if (typeof aislacion === "number") return aislacion;

  const value = String(aislacion).trim();
  const parsed = Number.parseFloat(value.replace(",", "."));
  if (Number.isFinite(parsed)) return parsed;

  const normalized = value
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");

  return buscarFactorAislacion(
    normalized === "APLICA" || normalized === "SI",
    factores,
  );
}

export function resolveEstadoAislacionDesdeFactor(
  factorInput: unknown,
  factoresAislacion?: FactorAislacionEstado[],
): boolean | null {
  const factor = Number(factorInput);
  if (!Number.isFinite(factor)) return null;

  const factores = factoresAislacion ?? getFactoresAislacionPorDefecto();
  const aplica = factores.find((item) => Math.abs(item.factor - factor) < 0.005);
  const coincidencias = factores.filter(
    (item) => Math.abs(item.factor - factor) < 0.005,
  );
  return coincidencias.length === 1 ? aplica?.aplica ?? null : null;
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
  const accesibilidadFactor = resolveAccesibilidadFactor(
    input.accesibilidad,
    input.factoresAccesibilidad,
  );
  const aislacion_normalizada = resolveAislacionFactor(
    input.aislacion,
    input.factoresAislacion,
  );
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
