export type EmpresaApp = "beck" | "firemat";

export const ROLES_BECK_APP = new Set([
  "administrador",
  "terreno",
  "jefeobra",
  "ingenieria",
  "cliente",
]);

export const ROLES_FIREMAT_APP = new Set([
  "vendedor_firemat",
  "bodeguero",
  "visualizador_firemat",
]);

export function normalizarEmpresa(value: unknown): EmpresaApp | null {
  return value === "beck" || value === "firemat" ? value : null;
}

export function obtenerEmpresaUsuario(email: string, rol: string): EmpresaApp | null {
  const dominio = email.toLowerCase().trim().split("@")[1] || "";

  if (ROLES_FIREMAT_APP.has(rol)) {
    return dominio === "firemat.cl" ? "firemat" : null;
  }

  if (ROLES_BECK_APP.has(rol)) {
    // Los clientes externos pertenecen siempre al portal Beck. Los roles
    // internos deben usar el dominio corporativo Beck.
    if (rol === "cliente") return "beck";
    return dominio === "becksoluciones.cl" ? "beck" : null;
  }

  return null;
}

export function esRolFiremat(rol: string | undefined): boolean {
  return Boolean(rol && ROLES_FIREMAT_APP.has(rol));
}
