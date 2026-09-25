import { describirAccesibilidad } from "../utils/accesibilidadPresentacion";

const defaults = [1, 2, 3].map((nivel) => ({ nivel, factor: nivel }));

test.each([
  [1, "Accesibilidad normal - Factor 1.0"],
  [2, "Cielos Americanos o estructurado - Factor 2.0"],
  [3, "Cielo duro y gateras - Factor 3.0"],
  [0, "No aplica - Factor 1.0"],
])("describe el nivel %s con su factor efectivo", (nivel, texto) => {
  expect(describirAccesibilidad(nivel, defaults)).toBe(texto);
});

test("el nombre depende del nivel, no del valor del factor personalizado", () => {
  const factores = [{ nivel: 1, factor: 3 }, { nivel: 2, factor: 1.25 }, { nivel: 3, factor: 1.25 }];
  expect(describirAccesibilidad(1, factores)).toBe("Accesibilidad normal - Factor 3.0");
  expect(describirAccesibilidad(2, factores)).toBe("Cielos Americanos o estructurado - Factor 1.25");
  expect(describirAccesibilidad(3, factores)).toBe("Cielo duro y gateras - Factor 1.25");
  expect(describirAccesibilidad(0, factores)).toBe("No aplica - Factor 1.0");
  expect(factores[0].factor).toBe(3);
});

test("no inventa niveles cuando no hay información o el dato es desconocido", () => {
  expect(describirAccesibilidad(null, defaults)).toBeNull();
  expect(describirAccesibilidad(undefined, defaults)).toBeNull();
  expect(describirAccesibilidad("", defaults)).toBeNull();
  expect(describirAccesibilidad(5, defaults)).toBe("Accesibilidad no identificada");
});
