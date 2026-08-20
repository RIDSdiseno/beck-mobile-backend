import { NextFunction, Request, Response } from "express";
import { registrarActividadAdministrador, type ModuloActividadApp } from "../services/actividadApp.service";

type JsonBody = { data?: unknown; message?: unknown } | undefined;

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function responseEntityId(body: JsonBody, path: string) {
  const data = body?.data;
  if (data && !Array.isArray(data) && typeof data === "object" && "id" in data) {
    const value = String((data as { id?: unknown }).id ?? "");
    if (UUID_PATTERN.test(value)) return value;
  }
  return path.match(UUID_PATTERN)?.[0] ?? null;
}

function classifyAction(method: string, path: string): {
  modulo: ModuloActividadApp;
  accion: string;
  descripcion: string;
  entidadTipo: string;
} {
  if (path.startsWith("/api/ingenieria")) {
    if (path.endsWith("/validar")) return { modulo: "ingenieria", accion: "REGISTRO_VALIDADO", descripcion: "Validó un registro en Ingeniería", entidadTipo: "registro" };
    if (path.endsWith("/rechazar")) return { modulo: "ingenieria", accion: "REGISTRO_RECHAZADO", descripcion: "Rechazó un registro en Ingeniería", entidadTipo: "registro" };
    if (path.endsWith("/iniciar-revision")) return { modulo: "ingenieria", accion: "REVISION_INICIADA", descripcion: "Inició la revisión de un registro", entidadTipo: "registro" };
    if (path.includes("control-inspeccion")) return { modulo: "ingenieria", accion: "CONTROL_INSPECCION_ACTUALIZADO", descripcion: "Actualizó un control de inspección", entidadTipo: "registro" };
    if (path.endsWith("/inspeccion")) return { modulo: "ingenieria", accion: "INSPECCION_ACTUALIZADA", descripcion: "Actualizó el estado de inspección de un registro", entidadTipo: "registro" };
    return { modulo: "ingenieria", accion: "REGISTRO_ACTUALIZADO", descripcion: "Actualizó un registro desde Ingeniería", entidadTipo: "registro" };
  }

  if (path.startsWith("/api/jefeobra")) {
    return { modulo: "supervisor", accion: "CONTROL_CORREGIDO", descripcion: "Actualizó una corrección de control de inspección", entidadTipo: "registro" };
  }

  if (path.startsWith("/api/registros")) {
    if (method === "POST" && path === "/api/registros") return { modulo: "operario", accion: "REGISTRO_CREADO", descripcion: "Creó un registro desde el módulo Operario", entidadTipo: "registro" };
    if (method === "DELETE") return { modulo: "operario", accion: "REGISTRO_ELIMINADO", descripcion: "Eliminó un registro pendiente", entidadTipo: "registro" };
    if (path.endsWith("/enviar-ingenieria")) return { modulo: "supervisor", accion: "REGISTRO_ENVIADO_INGENIERIA", descripcion: "Envió un registro a Ingeniería", entidadTipo: "registro" };
    if (path.endsWith("/enviar-tecnico")) return { modulo: "supervisor", accion: "REGISTRO_DEVUELTO_OPERARIO", descripcion: "Envió una corrección al Operario", entidadTipo: "registro" };
    if (path.endsWith("/reenviar-tecnico")) return { modulo: "operario", accion: "CORRECCION_REENVIADA", descripcion: "Reenvió una corrección al Supervisor", entidadTipo: "registro" };
    if (path.endsWith("/observaciones")) return { modulo: "supervisor", accion: "OBSERVACIONES_ACTUALIZADAS", descripcion: "Actualizó las observaciones de un registro", entidadTipo: "registro" };
    if (path.endsWith("/fotos")) return { modulo: "operario", accion: "FOTOGRAFIAS_ACTUALIZADAS", descripcion: "Actualizó las fotografías de un registro", entidadTipo: "registro" };
    return { modulo: "supervisor", accion: "REGISTRO_ACTUALIZADO", descripcion: "Actualizó un registro", entidadTipo: "registro" };
  }

  return { modulo: "administracion", accion: "ACCION_ADMINISTRATIVA", descripcion: "Realizó una acción administrativa", entidadTipo: "entidad" };
}

export function captureAdminActivity(req: Request, res: Response, next: NextFunction) {
  let jsonBody: JsonBody;
  const originalJson = res.json.bind(res);
  res.json = ((body: JsonBody) => {
    jsonBody = body;
    return originalJson(body);
  }) as Response["json"];

  res.on("finish", () => {
    if (
      req.user?.rol !== "administrador" ||
      !MUTATING_METHODS.has(req.method) ||
      res.statusCode < 200 ||
      res.statusCode >= 400
    ) return;

    const path = req.originalUrl.split("?")[0];
    const classification = classifyAction(req.method, path);
    const entidadId = responseEntityId(jsonBody, path);

    void registrarActividadAdministrador({
      usuarioId: req.user.id,
      ...classification,
      entidadId,
      metodo: req.method,
      ruta: path,
      datos: {
        requestId: String(res.locals.requestId || ""),
        status: res.statusCode,
      },
    }).catch((error) => {
      console.error("ADMIN_ACTIVITY_LOG_ERROR", {
        requestId: res.locals.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });

  next();
}
