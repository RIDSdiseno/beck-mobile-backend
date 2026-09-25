import { resolveEstadoAislacionDesdeFactor } from "./calculosRegistroTerreno";

export type PresentacionClientePdf = {
  accesibilidadTexto: string | null;
  aislacionAplica?: boolean | null;
};
export type CampoClientePdf = { label: string; value: string; amplio?: boolean };

export function aislacionClientePdf(value: unknown, estado?: boolean | null): string {
  const aplica = estado ?? resolveEstadoAislacionDesdeFactor(value);
  if (aplica != null) return aplica ? "Aplica" : "No aplica";
  // Mismo fallback visual que getAislacionLabel de la app; nunca modifica factores.
  const factor = Number(value);
  if (factor === 0 || factor === 1) return "No aplica";
  return Number.isFinite(factor) && factor > 1 ? "Aplica" : "—";
}

export function reparacionClientePdf(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Aplica" : "No aplica";
  const text = String(value).trim().toLowerCase();
  if (["aplica", "sí", "si", "true"].includes(text)) return "Aplica";
  if (["no aplica", "false"].includes(text)) return "No aplica";
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) ? (number >= 1 ? "Aplica" : "No aplica") : "—";
}

export function camposClientePdf(registro: any, visibles?: Set<string>, presentacion?: PresentacionClientePdf) {
  const general: CampoClientePdf[] = [];
  const tecnicos: CampoClientePdf[] = [];
  const add = (target: CampoClientePdf[], campo: string, label: string, value: unknown, amplio = false) => {
    if (visibles && !visibles.has(campo)) return;
    if (value == null || value === "") return; // FieldRow en el detalle tampoco muestra valores vacíos.
    target.push({ label, value: String(value), amplio });
  };
  add(general, "codigoBeck", "Código BECK", registro.codigo_beck || `REG-${registro.id.slice(0, 6).toUpperCase()}`);
  const fecha = registro.fecha instanceof Date ? registro.fecha.toISOString() : registro.fecha;
  if (fecha) add(general, "fechaEjecucionSello", "Fecha", new Intl.DateTimeFormat("es-CL", {
    day: "2-digit", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${String(fecha).slice(0, 10)}T00:00:00Z`)));
  add(general, "diaSemana", "Día semana", registro.dia_semana);
  add(general, "folio", "Folio", registro.folio);
  add(tecnicos, "itemizadoBeck", "Material", registro.descripcion_material, true);
  add(tecnicos, "recinto", "Recinto", registro.recinto);
  add(tecnicos, "modulo", "Módulo", registro.modulo);
  add(tecnicos, "piso", "Piso", registro.piso);
  add(tecnicos, "eje_numerico", "Eje numérico", registro.eje_numerico);
  add(tecnicos, "eje_alfabetico", "Eje alfabético", registro.eje_alfabetico);
  const junta = registro.tipo_registro === "junta_lineal_espuma";
  if (!junta) add(tecnicos, "numeroSello", "N° de sello", registro.numero_sello);
  add(tecnicos, "cantidadSellos", junta ? "Longitud (m)" : "Cantidad de sellos (Sin Factor)", junta ? registro.metros_lineales : registro.cantidad_sellos);
  add(tecnicos, "cantidad_final", "Cantidad Final (Con Factor)", registro.cantidad_final);
  add(tecnicos, "nombreSellador", "Responsable", registro.nombre_sellador);
  add(tecnicos, "holgura", "Holgura (cm)", registro.holgura);
  add(tecnicos, "factor_por_holguras", "Factor holgura", registro.factor_por_holguras);
  add(tecnicos, "accesibilidad", "Accesibilidad", presentacion?.accesibilidadTexto ?? "—", true);
  add(tecnicos, "cantidad_sellos_con_factores", "Sellos con factores", registro.cantidad_sellos_con_factores);
  add(tecnicos, "aislacion", "Aislación", aislacionClientePdf(registro.aislacion, presentacion?.aislacionAplica));
  add(tecnicos, "cantidad_sellos_aislacion", "Sellos aislación", registro.cantidad_sellos_aislacion);
  add(tecnicos, "reparacion_tabique", "Reparación tabique", reparacionClientePdf(registro.reparacion_tabique));
  add(tecnicos, "itemizadoBeck", "Itemizado BECK", registro.itemizado_beck, String(registro.itemizado_beck ?? "").length > 80);
  add(tecnicos, "dimensiones", "Dimensiones", registro.dimensiones);
  add(tecnicos, "itemizadoMandante", "Itemizado mandante", registro.itemizado_mandante, String(registro.itemizado_mandante ?? "").length > 80);
  return { general, tecnicos };
}
