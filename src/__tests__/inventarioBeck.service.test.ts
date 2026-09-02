import { parseLineasInventario } from "../services/inventarioBeck.service";

describe("inventario BECK móvil", () => {
  it("normaliza una línea válida", () => {
    expect(parseLineasInventario([
      { tipoItem: "epp", itemId: " item-1 ", cantidad: 2 },
    ])).toEqual([
      { tipoItem: "epp", itemId: "item-1", cantidad: 2 },
    ]);
  });

  it("rechaza cantidades inválidas", () => {
    expect(() => parseLineasInventario([
      { tipoItem: "implemento", itemId: "item-1", cantidad: 0 },
    ])).toThrow("cantidad debe ser mayor a cero");
  });

  it("impide asignar más de una unidad de una herramienta", () => {
    expect(() => parseLineasInventario([
      { tipoItem: "herramienta", itemId: "tool-1", cantidad: 2 },
    ])).toThrow("herramientas se asignan de una en una");
  });

  it("impide repetir el mismo item", () => {
    expect(() => parseLineasInventario([
      { tipoItem: "epp", itemId: "item-1", cantidad: 1 },
      { tipoItem: "epp", itemId: "item-1", cantidad: 1 },
    ])).toThrow("No repitas el mismo item");
  });
});
