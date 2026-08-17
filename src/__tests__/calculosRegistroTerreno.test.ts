import {
  calcularCamposRegistroTerreno,
  getTramosHolguraPorDefecto,
  resolveEstadoAislacionDesdeFactor,
} from "../utils/calculosRegistroTerreno";

describe("calcularCamposRegistroTerreno", () => {
  it("calcula los seis campos con accesibilidad y reparación", () => {
    expect(
      calcularCamposRegistroTerreno({
        cantidad_sellos: 3,
        holgura: 1.2,
        accesibilidad: 2,
        aislacion: 1,
        reparacion_tabique: 1,
        piso: "1",
        tipoRegistro: "sello_cortafuego",
      })
    ).toEqual({
      factor_por_holguras: 1,
      cantidad_sellos_con_factores: 6,
      aislacion_normalizada: 1,
      cantidad_sellos_aislacion: 1,
      reparacion_tabique_normalizada: 1,
      cantidad_final: 7,
    });
  });

  it("aplica aislación y el factor especial de sótano sin sumar reparación", () => {
    const result = calcularCamposRegistroTerreno({
      cantidad_sellos: 2,
      holgura: 3,
      accesibilidad: 2,
      aislacion: "APLICA",
      reparacion_tabique: "SI",
      piso: "-1",
      tipoRegistro: "sello_cortafuego",
    });

    expect(result.factor_por_holguras).toBe(1.2);
    expect(result.cantidad_sellos_con_factores).toBeCloseTo(5.28);
    expect(result.aislacion_normalizada).toBe(1.3);
    expect(result.cantidad_sellos_aislacion).toBe(1.3);
    expect(result.reparacion_tabique_normalizada).toBe(1);
    expect(result.cantidad_final).toBeCloseTo(6.864);
  });

  it("respeta los tramos personalizados de la obra", () => {
    const result = calcularCamposRegistroTerreno({
      cantidad_sellos: 4,
      holgura: 2.5,
      accesibilidad: 1,
      aislacion: null,
      reparacion_tabique: null,
      piso: "2",
      tipoRegistro: "sello_cortafuego",
      tramosHolgura: [
        { holguraMax: 2, factor: 1 },
        { holguraMax: 3, factor: 1.75 },
      ],
    });

    expect(result.factor_por_holguras).toBe(1.75);
    expect(result.cantidad_sellos_con_factores).toBe(7);
    expect(result.cantidad_final).toBe(7);
  });

  it("resuelve accesibilidad y aislación con los factores de la obra", () => {
    const result = calcularCamposRegistroTerreno({
      cantidad_sellos: 2,
      holgura: 4,
      accesibilidad: 2,
      aislacion: true,
      reparacion_tabique: false,
      piso: "1",
      tipoRegistro: "sello_cortafuego",
      factoresAccesibilidad: [
        { nivel: 1, factor: 1 },
        { nivel: 2, factor: 1.5 },
        { nivel: 3, factor: 2.25 },
      ],
      factoresAislacion: [
        { aplica: true, factor: 1.4 },
        { aplica: false, factor: 1 },
      ],
    });

    expect(result.factor_por_holguras).toBe(1.2);
    expect(result.cantidad_sellos_con_factores).toBeCloseTo(3.6);
    expect(result.aislacion_normalizada).toBe(1.4);
    expect(result.cantidad_final).toBeCloseTo(5.04);
  });

  it("usa factor neutro cuando holgura y accesibilidad no aplican", () => {
    const result = calcularCamposRegistroTerreno({
      cantidad_sellos: 3,
      holgura: 0,
      accesibilidad: 0,
      aislacion: false,
      reparacion_tabique: false,
      piso: "1",
      tipoRegistro: "sello_cortafuego",
      tramosHolgura: [
        { holguraMax: 2, factor: 1.7 },
        { holguraMax: 4, factor: 2 },
      ],
      factoresAccesibilidad: [
        { nivel: 1, factor: 1.4 },
        { nivel: 2, factor: 2 },
        { nivel: 3, factor: 3 },
      ],
      factoresAislacion: [
        { aplica: true, factor: 1.3 },
        { aplica: false, factor: 1 },
      ],
    });

    expect(result.factor_por_holguras).toBe(1);
    expect(result.cantidad_sellos_con_factores).toBe(3);
    expect(result.cantidad_final).toBe(3);
  });

  it("recupera el estado de aislación desde los factores efectivos", () => {
    const factores = [
      { aplica: true, factor: 1.45 },
      { aplica: false, factor: 1.05 },
    ];

    expect(resolveEstadoAislacionDesdeFactor(1.45, factores)).toBe(true);
    expect(resolveEstadoAislacionDesdeFactor(1.05, factores)).toBe(false);
    expect(resolveEstadoAislacionDesdeFactor(2, factores)).toBeNull();
  });

  it("mantiene la tabla oficial por defecto", () => {
    expect(getTramosHolguraPorDefecto("sello_cortafuego")).toEqual([
      { holguraMax: 2, factor: 1 },
      { holguraMax: 4, factor: 1.2 },
      { holguraMax: 6, factor: 1.4 },
      { holguraMax: 10, factor: 1.8 },
    ]);
  });

  it("rechaza holguras fuera de los tramos", () => {
    expect(() =>
      calcularCamposRegistroTerreno({
        cantidad_sellos: 1,
        holgura: 11,
        accesibilidad: 1,
        aislacion: 1,
        reparacion_tabique: 0,
        piso: "1",
        tipoRegistro: "sello_cortafuego",
      })
    ).toThrow("CORREGIR HOLGURA");
  });
});
