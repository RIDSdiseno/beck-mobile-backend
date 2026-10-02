import type { Response } from "express";

const TIPOS = ["sello_cortafuego", "junta_lineal_espuma", "tabiqueria"];

// Ausente/todos conserva el contrato de los clientes anteriores.
export function leerFiltroTipoRegistro(value: unknown, res: Response): string | undefined | false {
  if (value === undefined || value === "" || value === "todos") return undefined;
  if (typeof value === "string" && TIPOS.includes(value)) return value;
  res.status(400).json({ success: false, error: "Tipo de registro no válido" });
  return false;
}
