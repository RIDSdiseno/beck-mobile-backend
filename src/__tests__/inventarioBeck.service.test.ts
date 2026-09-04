import { parseLineasInventario, separarSubSkus } from "../services/inventarioBeck.service";

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

  it("acepta un Sub-SKU para asignar exactamente una unidad", () => {
    expect(parseLineasInventario([
      { tipoItem: "epp", itemId: " item-1 ", cantidad: 1, subSku: " 900001-2 " },
    ])).toEqual([
      { tipoItem: "epp", itemId: "item-1", cantidad: 1, subSku: "900001-2" },
    ]);
  });

  it("impide asignar varias unidades indicando un Sub-SKU", () => {
    expect(() => parseLineasInventario([
      { tipoItem: "epp", itemId: "item-1", cantidad: 2, subSku: "900001-2" },
    ])).toThrow("código unitario solo permite asignar una unidad");
  });

  it("separa exactamente el Sub-SKU escaneado aunque esté al medio del lote", () => {
    expect(separarSubSkus(["900001-1", "900001-2", "900001-3"], 1, "900001-2")).toEqual({
      seleccionados: ["900001-2"],
      restantes: ["900001-1", "900001-3"],
    });
  });

  it("conserva los códigos restantes al dividir un lote por cantidad", () => {
    expect(separarSubSkus(["900001-1", "900001-2", "900001-3"], 2)).toEqual({
      seleccionados: ["900001-1", "900001-2"],
      restantes: ["900001-3"],
    });
  });
});
