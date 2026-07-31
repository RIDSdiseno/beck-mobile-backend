import { prisma } from "../config/prisma";

export type RolConfiguracionRegistro =
  | "trabajador"
  | "jefeobra"
  | "cliente"
  | "ingenieria";
export type ColorCampoRegistro = "verde" | "azul" | "rojo";

export type CampoRegistroConfig = {
  campo: string;
  appCampo: string;
  color: ColorCampoRegistro;
};

export type CampoRegistroEfectivo = CampoRegistroConfig & {
  configurable: boolean;
  visible: boolean;
};

const CAMPOS_JEFEOBRA: CampoRegistroConfig[] = [
  { campo: "tipo_registro", appCampo: "tipoRegistro", color: "verde" },
  { campo: "codigoBeck", appCampo: "codigoBeck", color: "verde" },
  { campo: "itemizadoBeck", appCampo: "itemizadoBeck", color: "verde" },
  { campo: "itemizadoMandante", appCampo: "itemizadoMandante", color: "azul" },
  { campo: "fechaEjecucionSello", appCampo: "fechaEjecucionSello", color: "verde" },
  { campo: "diaSemana", appCampo: "diaSemana", color: "verde" },
  { campo: "piso", appCampo: "piso", color: "verde" },
  { campo: "eje_alfabetico", appCampo: "ejeAlfabetico", color: "azul" },
  { campo: "eje_numerico", appCampo: "ejeNumerico", color: "azul" },
  { campo: "nombreSellador", appCampo: "nombreSellador", color: "verde" },
  { campo: "foto", appCampo: "foto", color: "verde" },
  { campo: "recinto", appCampo: "recinto", color: "azul" },
  { campo: "modulo", appCampo: "modulo", color: "azul" },
  { campo: "numeroSello", appCampo: "numeroSello", color: "verde" },
  { campo: "cantidadSellos", appCampo: "cantidadSellos", color: "verde" },
  { campo: "metros_lineales", appCampo: "metrosLineales", color: "verde" },
  { campo: "holgura", appCampo: "holgura", color: "azul" },
  { campo: "factor_por_holguras", appCampo: "factorPorHolguras", color: "azul" },
  { campo: "accesibilidad", appCampo: "cieloModular", color: "azul" },
  { campo: "cantidad_sellos_con_factores", appCampo: "cantidadSellosConFactores", color: "rojo" },
  { campo: "aislacion", appCampo: "aislacion", color: "azul" },
  { campo: "cantidad_sellos_aislacion", appCampo: "cantidadSellosAislacion", color: "rojo" },
  { campo: "reparacion_tabique", appCampo: "reparacionTabique", color: "azul" },
  { campo: "cantidad_final", appCampo: "cantidadFinal", color: "rojo" },
  { campo: "observaciones", appCampo: "observaciones", color: "verde" },
  { campo: "folio", appCampo: "folio", color: "azul" },
];

const CAMPOS_ROJOS_TRABAJADOR = new Set([
  "codigoBeck",
  "itemizadoMandante",
  "factor_por_holguras",
  "cantidad_sellos_con_factores",
  "cantidad_sellos_aislacion",
  "cantidad_final",
  "folio",
]);

const CAMPOS_TRABAJADOR: CampoRegistroConfig[] = CAMPOS_JEFEOBRA.map(
  (campo) => ({
    ...campo,
    color: CAMPOS_ROJOS_TRABAJADOR.has(campo.campo)
      ? "rojo"
      : campo.color,
  }),
);

const CAMPOS_CLIENTE: CampoRegistroConfig[] = [
  { campo: "codigoBeck", appCampo: "codigoBeck", color: "azul" },
  { campo: "itemizadoBeck", appCampo: "itemizadoBeck", color: "azul" },
  { campo: "itemizadoMandante", appCampo: "itemizadoMandante", color: "azul" },
  { campo: "fechaEjecucionSello", appCampo: "fechaEjecucionSello", color: "azul" },
  { campo: "diaSemana", appCampo: "diaSemana", color: "azul" },
  { campo: "piso", appCampo: "piso", color: "azul" },
  { campo: "eje_alfabetico", appCampo: "ejeAlfabetico", color: "azul" },
  { campo: "eje_numerico", appCampo: "ejeNumerico", color: "azul" },
  { campo: "nombreSellador", appCampo: "nombreSellador", color: "azul" },
  { campo: "foto", appCampo: "foto", color: "azul" },
  { campo: "recinto", appCampo: "recinto", color: "azul" },
  { campo: "modulo", appCampo: "modulo", color: "azul" },
  { campo: "numeroSello", appCampo: "numeroSello", color: "verde" },
  { campo: "cantidadSellos", appCampo: "cantidadSellos", color: "azul" },
  { campo: "holgura", appCampo: "holgura", color: "azul" },
  { campo: "factor_por_holguras", appCampo: "factorPorHolguras", color: "azul" },
  { campo: "accesibilidad", appCampo: "cieloModular", color: "azul" },
  { campo: "cantidad_sellos_con_factores", appCampo: "cantidadSellosConFactores", color: "azul" },
  { campo: "aislacion", appCampo: "aislacion", color: "azul" },
  { campo: "cantidad_sellos_aislacion", appCampo: "cantidadSellosAislacion", color: "azul" },
  { campo: "reparacion_tabique", appCampo: "reparacionTabique", color: "azul" },
  { campo: "cantidad_final", appCampo: "cantidadFinal", color: "azul" },
  { campo: "folio", appCampo: "folio", color: "azul" },
];

const CAMPOS_INGENIERIA: CampoRegistroConfig[] = [
  ...CAMPOS_JEFEOBRA.map(
    (campo): CampoRegistroConfig => ({ ...campo, color: "verde" }),
  ),
  { campo: "rendimientoSellosEsperadoDiario", appCampo: "rendimientoSellosEsperadoDiario", color: "rojo" },
  { campo: "rendimientoReparacionEsperadoDiario", appCampo: "rendimientoReparacionEsperadoDiario", color: "verde" },
  { campo: "rendimientoIndividual", appCampo: "rendimientoIndividual", color: "verde" },
];

export const CAMPOS_REGISTRO_POR_ROL: Record<
  RolConfiguracionRegistro,
  CampoRegistroConfig[]
> = {
  jefeobra: CAMPOS_JEFEOBRA,
  trabajador: CAMPOS_TRABAJADOR,
  cliente: CAMPOS_CLIENTE,
  ingenieria: CAMPOS_INGENIERIA,
};

export function normalizarRolConfiguracion(
  rol: string | undefined,
): RolConfiguracionRegistro | null {
  if (rol === "terreno") return "trabajador";
  if (rol === "jefeobra" || rol === "cliente" || rol === "ingenieria") {
    return rol;
  }
  return null;
}

export async function obtenerConfiguracionRegistro(
  obraId: string,
  rol: RolConfiguracionRegistro,
): Promise<CampoRegistroEfectivo[]> {
  const catalogo = CAMPOS_REGISTRO_POR_ROL[rol];
  const configuracion = await prisma.configuracion_campos_registro.findMany({
    where: {
      obra_id: obraId,
      rol,
      campo: { in: catalogo.map((campo) => campo.campo) },
    },
    select: { campo: true, visible: true },
  });
  const configuracionPorCampo = new Map(
    configuracion.map((campo) => [campo.campo, campo.visible]),
  );

  return catalogo.map((campo) => ({
    ...campo,
    configurable: campo.color === "azul",
    visible:
      campo.color === "verde"
        ? true
        : campo.color === "rojo"
          ? false
          : configuracionPorCampo.get(campo.campo) ?? true,
  }));
}

export function crearMapaVisibilidad(configuracion: CampoRegistroEfectivo[]) {
  return new Map(configuracion.map((campo) => [campo.campo, campo.visible]));
}
