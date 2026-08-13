import { normalizarHolguraMovil } from "../utils/normalizarHolguraMovil";

describe("normalizarHolguraMovil", () => {
  it.each([
    ["1", 2],
    ["1.2", 4],
    ["1,4", 6],
    [1.8, 10],
    [0, 0],
  ])("convierte el valor heredado %p al límite %p cm", (entrada, esperado) => {
    expect(normalizarHolguraMovil(entrada)).toBe(esperado);
  });

  it.each([2, 4, 6, 10])("conserva el límite actual %p cm", (entrada) => {
    expect(normalizarHolguraMovil(entrada)).toBe(entrada);
  });

  it("deja los valores inválidos para que el validador los rechace", () => {
    expect(normalizarHolguraMovil("sin medida")).toBe("sin medida");
  });
});
