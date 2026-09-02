import { Request, Response } from "express";

import {
  asignarInventarioAOperario,
  buscarInventarioPorCodigo,
  confirmarRecepcionOperario,
  devolverInventarioABodega,
  InventarioBeckError,
  listarAsignacionesOperario,
  listarDisponibleSupervisor,
  listarEntregadosSupervisor,
  listarHistorialInventarioOperario,
  listarObrasInventarioSupervisor,
  listarOperariosObra,
  listarTrazabilidadAsignacion,
  listarTrazabilidadItemSupervisor,
  recibirDevolucionSupervisor,
  solicitarDevolucionOperario,
} from "../services/inventarioBeck.service";

function responderError(res: Response, error: unknown, fallback: string) {
  if (error instanceof InventarioBeckError) {
    return res.status(error.status).json({ success: false, error: error.message });
  }
  return res.status(500).json({ success: false, error: fallback });
}

export async function getObrasInventarioSupervisor(req: Request, res: Response) {
  try {
    const data = await listarObrasInventarioSupervisor(req.user!.id);
    return res.json({ success: true, data });
  } catch (error) {
    console.error("GET OBRAS INVENTARIO SUPERVISOR ERROR:", error);
    return responderError(res, error, "No se pudieron obtener las obras del inventario.");
  }
}

export async function getDisponibleSupervisor(req: Request, res: Response) {
  try {
    const obraId = typeof req.query.obraId === "string" ? req.query.obraId : "";
    if (!obraId) return res.status(400).json({ success: false, error: "Falta obraId." });
    const data = await listarDisponibleSupervisor(req.user!.id, obraId);
    return res.json({ success: true, data });
  } catch (error) {
    console.error("GET INVENTARIO DISPONIBLE SUPERVISOR ERROR:", error);
    return responderError(res, error, "No se pudo obtener el inventario disponible.");
  }
}

export async function getEntregadosSupervisor(req: Request, res: Response) {
  try {
    const obraId = typeof req.query.obraId === "string" ? req.query.obraId : "";
    if (!obraId) return res.status(400).json({ success: false, error: "Falta obraId." });
    const data = await listarEntregadosSupervisor(req.user!.id, obraId);
    return res.json({ success: true, data });
  } catch (error) {
    console.error("GET INVENTARIO ENTREGADO SUPERVISOR ERROR:", error);
    return responderError(res, error, "No se pudieron obtener las entregas.");
  }
}

export async function getOperariosInventario(req: Request, res: Response) {
  try {
    const obraId = typeof req.query.obraId === "string" ? req.query.obraId : "";
    if (!obraId) return res.status(400).json({ success: false, error: "Falta obraId." });
    const data = await listarOperariosObra(req.user!.id, obraId);
    return res.json({ success: true, data });
  } catch (error) {
    console.error("GET OPERARIOS INVENTARIO ERROR:", error);
    return responderError(res, error, "No se pudieron obtener los operarios.");
  }
}

export async function postAsignacionInventario(req: Request, res: Response) {
  try {
    const data = await asignarInventarioAOperario({
      supervisorId: req.user!.id,
      obraId: req.body?.obraId,
      trabajadorId: req.body?.trabajadorId,
      lineas: req.body?.lineas,
      observacion: req.body?.observacion,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error("POST ASIGNACION INVENTARIO ERROR:", error);
    return responderError(res, error, "No se pudo registrar la asignación.");
  }
}

export async function getMiEquipo(req: Request, res: Response) {
  try {
    const data = await listarAsignacionesOperario(req.user!.id);
    return res.json({ success: true, data });
  } catch (error) {
    console.error("GET MI EQUIPO ERROR:", error);
    return responderError(res, error, "No se pudo obtener tu equipo asignado.");
  }
}

export async function postConfirmarRecepcion(req: Request, res: Response) {
  try {
    const data = await confirmarRecepcionOperario(req.user!.id, String(req.params.id || ""));
    return res.json({ success: true, data });
  } catch (error) {
    console.error("CONFIRMAR RECEPCION INVENTARIO ERROR:", error);
    return responderError(res, error, "No se pudo confirmar la recepción.");
  }
}

export async function postSolicitarDevolucion(req: Request, res: Response) {
  try {
    const data = await solicitarDevolucionOperario(
      req.user!.id,
      String(req.params.id || ""),
      req.body?.motivo,
    );
    return res.json({ success: true, data });
  } catch (error) {
    console.error("SOLICITAR DEVOLUCION INVENTARIO ERROR:", error);
    return responderError(res, error, "No se pudo solicitar la devolución.");
  }
}

export async function postRecibirDevolucion(req: Request, res: Response) {
  try {
    const data = await recibirDevolucionSupervisor(req.user!.id, String(req.params.id || ""));
    return res.json({ success: true, data });
  } catch (error) {
    console.error("RECIBIR DEVOLUCION INVENTARIO ERROR:", error);
    return responderError(res, error, "No se pudo recibir la devolución.");
  }
}

export async function postDevolverABodega(req: Request, res: Response) {
  try {
    const data = await devolverInventarioABodega({
      supervisorId: req.user!.id,
      obraId: req.body?.obraId,
      tipoItem: req.body?.tipoItem,
      itemId: req.body?.itemId,
      cantidad: req.body?.cantidad,
      motivo: req.body?.motivo,
    });
    return res.json({ success: true, data });
  } catch (error) {
    console.error("DEVOLVER INVENTARIO A BODEGA ERROR:", error);
    return responderError(res, error, "No se pudo devolver el inventario a bodega.");
  }
}

export async function getTrazabilidad(req: Request, res: Response) {
  try {
    const rol = req.user!.rol;
    if (rol !== "jefeobra" && rol !== "terreno") {
      return res.status(403).json({ success: false, error: "No tienes acceso a esta trazabilidad." });
    }
    const data = await listarTrazabilidadAsignacion(
      req.user!.id,
      rol,
      String(req.params.id || ""),
    );
    return res.json({ success: true, data });
  } catch (error) {
    console.error("GET TRAZABILIDAD INVENTARIO ERROR:", error);
    return responderError(res, error, "No se pudo obtener la trazabilidad.");
  }
}

export async function getHistorialMiEquipo(req: Request, res: Response) {
  try {
    const data = await listarHistorialInventarioOperario(req.user!.id);
    return res.json({ success: true, data });
  } catch (error) {
    console.error("GET HISTORIAL MI EQUIPO ERROR:", error);
    return responderError(res, error, "No se pudo obtener el historial del inventario.");
  }
}

export async function getTrazabilidadItem(req: Request, res: Response) {
  try {
    const data = await listarTrazabilidadItemSupervisor(
      req.user!.id,
      typeof req.query.obraId === "string" ? req.query.obraId : "",
      typeof req.query.tipoItem === "string" ? req.query.tipoItem : "",
      typeof req.query.itemId === "string" ? req.query.itemId : "",
    );
    return res.json({ success: true, data });
  } catch (error) {
    console.error("GET TRAZABILIDAD ITEM INVENTARIO ERROR:", error);
    return responderError(res, error, "No se pudo obtener la trazabilidad del artículo.");
  }
}

export async function getInventarioPorCodigo(req: Request, res: Response) {
  try {
    const data = await buscarInventarioPorCodigo(req.user!.id, req.params.codigo);
    return res.json({ success: true, data });
  } catch (error) {
    console.error("GET INVENTARIO POR CODIGO ERROR:", error);
    return responderError(res, error, "No se pudo consultar el código de barras.");
  }
}
