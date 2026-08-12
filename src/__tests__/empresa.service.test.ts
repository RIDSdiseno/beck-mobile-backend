import {
  normalizarEmpresa,
  obtenerEmpresaUsuario,
} from "../services/empresa.service";

describe("separación de empresa móvil", () => {
  it("asigna roles corporativos Beck sólo al dominio Beck", () => {
    expect(obtenerEmpresaUsuario("tecnico@becksoluciones.cl", "terreno")).toBe("beck");
    expect(obtenerEmpresaUsuario("tecnico@firemat.cl", "terreno")).toBeNull();
  });

  it("asigna roles Firemat sólo al dominio Firemat", () => {
    expect(obtenerEmpresaUsuario("bodega@firemat.cl", "bodeguero")).toBe("firemat");
    expect(obtenerEmpresaUsuario("bodega@becksoluciones.cl", "bodeguero")).toBeNull();
  });

  it("mantiene clientes externos dentro del portal Beck", () => {
    expect(obtenerEmpresaUsuario("cliente@mandante.cl", "cliente")).toBe("beck");
  });

  it("sólo normaliza empresas conocidas", () => {
    expect(normalizarEmpresa("beck")).toBe("beck");
    expect(normalizarEmpresa("firemat")).toBe("firemat");
    expect(normalizarEmpresa("otra")).toBeNull();
  });
});
