import assert from "node:assert/strict";
import { calcularCamposRegistroTerreno } from "../utils/calculosRegistroTerreno";

const casos = [
  {
    "tipo": "junta_lineal_espuma",
    "cantidad": 1.5,
    "holgura": 5,
    "acc": 2,
    "ais": 1.3,
    "rep": 0,
    "piso": "1",
    "factor": 2.5,
    "ponderada": 7.5,
    "final": 7.5
  },
  {
    "tipo": "junta_lineal_espuma",
    "cantidad": 1.5,
    "holgura": 5,
    "acc": 2,
    "ais": 1.3,
    "rep": 1,
    "piso": "1",
    "factor": 2.5,
    "ponderada": 7.5,
    "final": 8.5
  },
  {
    "tipo": "junta_lineal_espuma",
    "cantidad": 1.5,
    "holgura": 5,
    "acc": 2,
    "ais": 1.3,
    "rep": 1,
    "piso": "-1",
    "factor": 2.5,
    "ponderada": 8.25,
    "final": 8.25
  },
  {
    "tipo": "junta_lineal_espuma",
    "cantidad": 2,
    "holgura": 2,
    "acc": 1,
    "ais": 1,
    "rep": 0,
    "piso": "1",
    "factor": 1,
    "ponderada": 2,
    "final": 2
  },
  {
    "tipo": "junta_lineal_espuma",
    "cantidad": 2,
    "holgura": 3,
    "acc": 1,
    "ais": 1,
    "rep": 0,
    "piso": "1",
    "factor": 1.5,
    "ponderada": 3,
    "final": 3
  },
  {
    "tipo": "junta_lineal_espuma",
    "cantidad": 2,
    "holgura": 4,
    "acc": 1,
    "ais": 1,
    "rep": 0,
    "piso": "1",
    "factor": 2,
    "ponderada": 4,
    "final": 4
  },
  {
    "tipo": "junta_lineal_espuma",
    "cantidad": 2.75,
    "holgura": 0,
    "acc": 0,
    "ais": 2,
    "rep": 0,
    "piso": "1",
    "factor": 1,
    "ponderada": 2.75,
    "final": 2.75
  },
  {
    "tipo": "tabiqueria",
    "cantidad": 3,
    "holgura": 4,
    "acc": 2,
    "ais": 1.3,
    "rep": 0,
    "piso": "1",
    "factor": 1.2,
    "ponderada": 7.2,
    "final": 7.2
  },
  {
    "tipo": "tabiqueria",
    "cantidad": 3,
    "holgura": 4,
    "acc": 2,
    "ais": 1.3,
    "rep": 1,
    "piso": "1",
    "factor": 1.2,
    "ponderada": 7.2,
    "final": 8.2
  },
  {
    "tipo": "tabiqueria",
    "cantidad": 3,
    "holgura": 4,
    "acc": 2,
    "ais": 1.3,
    "rep": 1,
    "piso": "-1",
    "factor": 1.2,
    "ponderada": 7.92,
    "final": 7.92
  },
  {
    "tipo": "tabiqueria",
    "cantidad": 3,
    "holgura": 0,
    "acc": 0,
    "ais": 2,
    "rep": 0,
    "piso": "1",
    "factor": 1,
    "ponderada": 3,
    "final": 3
  },
  {
    "tipo": "sello_cortafuego",
    "cantidad": 3,
    "holgura": 4,
    "acc": 2,
    "ais": 1.3,
    "rep": 1,
    "piso": "1",
    "factor": 1.2,
    "ponderada": 7.2,
    "final": 10.36
  },
  {
    "tipo": "sello_cortafuego",
    "cantidad": 3,
    "holgura": 4,
    "acc": 2,
    "ais": 1.3,
    "rep": 1,
    "piso": "-1",
    "factor": 1.2,
    "ponderada": 7.92,
    "final": 10.296
  }
];
for (const [i, c] of casos.entries()) {
  test(`regla ${i + 1}: ${c.tipo}, piso ${c.piso}, reparación ${c.rep}`, () => {
    const r = calcularCamposRegistroTerreno({
      tipoRegistro: c.tipo,
      cantidad_sellos: c.tipo === "junta_lineal_espuma" ? 0 : c.cantidad,
      metros_lineales: c.tipo === "junta_lineal_espuma" ? c.cantidad : null,
      holgura: c.holgura, accesibilidad: c.acc, aislacion: c.ais,
      reparacion_tabique: c.rep, piso: c.piso,
    });
    assert.ok(Math.abs(r.factor_por_holguras - c.factor) < 1e-9);
    assert.ok(Math.abs(r.cantidad_sellos_con_factores - c.ponderada) < 1e-9);
    assert.ok(Math.abs(r.cantidad_final - c.final) < 1e-9);
    assert.equal(r.aislacion_normalizada, c.ais);
    assert.equal(r.cantidad_sellos_aislacion, c.ais);
    assert.equal(r.reparacion_tabique_normalizada, c.rep);
  });
}
for (const tipo of ["junta_lineal_espuma", "tabiqueria"]) {
  test(`${tipo}: factores por obra y aislación informativa`, () => {
    const r = calcularCamposRegistroTerreno({
      tipoRegistro: tipo, cantidad_sellos: 2, metros_lineales: 2,
      holgura: 3, accesibilidad: 2, aislacion: true, reparacion_tabique: false, piso: "1",
      tramosHolgura: [{ holguraMax: 3, factor: 2.3 }],
      factoresAccesibilidad: [{ nivel: 2, factor: 1.7 }],
      factoresAislacion: [{ aplica: true, factor: 1.9 }, { aplica: false, factor: 1 }],
    });
    assert.ok(Math.abs(r.cantidad_final - 7.82) < 1e-9);
    assert.equal(r.aislacion_normalizada, 1.9);
    assert.equal(r.cantidad_sellos_aislacion, 1.9);
  });
}
test("juntas exige metros, nunca usa el contador de sellos", () => {
  assert.throws(() => calcularCamposRegistroTerreno({
    tipoRegistro: "junta_lineal_espuma", cantidad_sellos: 99, holgura: 2,
    accesibilidad: 1, aislacion: 1, reparacion_tabique: 0, piso: "1",
  }), /CANTIDAD/);
});
test("separación fuera de escala se rechaza", () => {
  assert.throws(() => calcularCamposRegistroTerreno({
    tipoRegistro: "junta_lineal_espuma", cantidad_sellos: 0, metros_lineales: 2,
    holgura: 6, accesibilidad: 1, aislacion: 1, reparacion_tabique: 0, piso: "1",
  }), /HOLGURA/);
});

