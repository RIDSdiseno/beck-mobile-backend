import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { getMisObrasByUser } from "../services/obras.service";

type RolConfiguracionRegistro = "trabajador" | "jefeobra";
type ColorCampoRegistro = "verde" | "azul" | "rojo";

type CampoRegistroConfig = {
  campo: string;
  appCampo: string;
  color: ColorCampoRegistro;
};

const CAMPOS_REGISTRO_JEFEOBRA: CampoRegistroConfig[] = [
  { campo: "tipo_registro", appCampo: "tipoRegistro", color: "verde" },
  { campo: "codigoBeck", appCampo: "codigoBeck", color: "verde" },
  { campo: "itemizadoBeck", appCampo: "itemizadoBeck", color: "verde" },
  { campo: "itemizadoMandante", appCampo: "itemizadoMandante", color: "verde" },
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
  {
    campo: "cantidad_sellos_con_factores",
    appCampo: "cantidadSellosConFactores",
    color: "azul",
  },
  { campo: "aislacion", appCampo: "aislacion", color: "azul" },
  {
    campo: "cantidad_sellos_aislacion",
    appCampo: "cantidadSellosAislacion",
    color: "azul",
  },
  { campo: "reparacion_tabique", appCampo: "reparacionTabique", color: "azul" },
  { campo: "cantidad_final", appCampo: "cantidadFinal", color: "azul" },
  { campo: "observaciones", appCampo: "observaciones", color: "verde" },
  { campo: "folio", appCampo: "folio", color: "azul" },
];

const CAMPOS_REGISTRO_TRABAJADOR: CampoRegistroConfig[] =
  CAMPOS_REGISTRO_JEFEOBRA.map((campo) => {
    const camposRojos = new Set([
      "codigoBeck",
      "itemizadoMandante",
      "factor_por_holguras",
      "cantidad_sellos_con_factores",
      "cantidad_sellos_aislacion",
      "cantidad_final",
      "folio",
    ]);

    return {
      ...campo,
      color: camposRojos.has(campo.campo) ? "rojo" : campo.color,
    };
  });

const CAMPOS_REGISTRO_POR_ROL: Record<
  RolConfiguracionRegistro,
  CampoRegistroConfig[]
> = {
  jefeobra: CAMPOS_REGISTRO_JEFEOBRA,
  trabajador: CAMPOS_REGISTRO_TRABAJADOR,
};

export async function getMisObras(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const rol = req.user?.rol;

    if (!userId || !rol) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    const obras = await getMisObrasByUser(userId, rol);

    return res.json({
      success: true,
      data: obras,
    });
  } catch (error) {
    console.error("GET MIS OBRAS ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudieron obtener las obras disponibles",
    });
  }
}

export async function getConfiguracionRegistro(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const rol = req.user?.rol;
    const obraId = typeof req.params.id === "string" ? req.params.id : "";

    if (!userId || !rol) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    if (!obraId) {
      return res.status(400).json({
        success: false,
        error: "Falta id de la obra",
      });
    }

    if (rol !== "terreno" && rol !== "jefeobra") {
      return res.status(403).json({
        success: false,
        error: "Tu rol no utiliza configuracion de registro movil",
      });
    }

    const obrasDisponibles = await getMisObrasByUser(userId, rol);
    if (!obrasDisponibles.some((obra) => obra.id === obraId)) {
      return res.status(403).json({
        success: false,
        error: "No tienes acceso a la configuracion de esta obra",
      });
    }

    const rolConfiguracion: RolConfiguracionRegistro =
      rol === "terreno" ? "trabajador" : "jefeobra";
    const catalogo = CAMPOS_REGISTRO_POR_ROL[rolConfiguracion];
    const camposCatalogo = catalogo.map((campo) => campo.campo);

    const configuracion = await prisma.configuracion_campos_registro.findMany({
      where: {
        obra_id: obraId,
        rol: rolConfiguracion,
        campo: { in: camposCatalogo },
      },
      select: {
        campo: true,
        visible: true,
      },
    });
    const configuracionPorCampo = new Map(
      configuracion.map((campo) => [campo.campo, campo.visible]),
    );

    return res.json({
      success: true,
      data: catalogo.map((campo) => ({
        campo: campo.appCampo,
        campoOrigen: campo.campo,
        color: campo.color,
        configurable: campo.color === "azul",
        visible:
          campo.color === "verde"
            ? true
            : campo.color === "rojo"
              ? false
              : configuracionPorCampo.get(campo.campo) ?? true,
      })),
    });
  } catch (error) {
    console.error("GET CONFIGURACION REGISTRO ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudo obtener la configuracion del registro",
    });
  }
}
