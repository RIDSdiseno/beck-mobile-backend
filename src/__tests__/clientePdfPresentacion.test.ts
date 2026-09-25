import { aislacionClientePdf, camposClientePdf, reparacionClientePdf } from "../utils/clientePdfPresentacion";

const registro = {
  id: "a57f1e-prueba", codigo_beck: "1-112", fecha: new Date("2026-08-18T00:00:00Z"),
  descripcion_material: "Descripción distinta", itemizado_beck: "Itemizado seleccionado", dimensiones: "60 mm",
  itemizado_mandante: "MAND-10", nombre_sellador: "Operario de la obra", usuarios: { nombre: "Usuario creador distinto" },
  eje_numerico: "2-4", eje_alfabetico: "A-C", cantidad_sellos: 2, cantidad_final: 0,
  aislacion: 1, reparacion_tabique: 0, holgura: 0,
};
test("presenta los mismos valores de aplica/no aplica del detalle, sin alterar cálculos", () => {
  expect(aislacionClientePdf(1, false)).toBe("No aplica");
  expect(aislacionClientePdf(1.3, true)).toBe("Aplica");
  expect(aislacionClientePdf(0.8, true)).toBe("Aplica");
  expect(aislacionClientePdf(1.7, false)).toBe("No aplica");
  expect(reparacionClientePdf(0)).toBe("No aplica");
  expect(reparacionClientePdf(1)).toBe("Aplica");
  expect(reparacionClientePdf(null)).toBe("—");
  expect(reparacionClientePdf("No aplica")).toBe("No aplica");
});
test("mantiene material, itemizado, dimensiones y ejes independientes; no sustituye el responsable", () => {
  const before = JSON.stringify(registro);
  const fields = camposClientePdf(registro);
  const values = Object.fromEntries(fields.tecnicos.map(f => [f.label, f.value]));
  expect(values).toMatchObject({
    Material: "Descripción distinta", "Itemizado BECK": "Itemizado seleccionado", Dimensiones: "60 mm",
    "Itemizado mandante": "MAND-10", "Eje numérico": "2-4", "Eje alfabético": "A-C",
    Responsable: "Operario de la obra", "Cantidad de sellos (Sin Factor)": "2", "Cantidad Final (Con Factor)": "0",
    Aislación: "No aplica", "Reparación tabique": "No aplica", "Holgura (cm)": "0",
  });
  expect(fields.general.find(f => f.label === "Fecha")?.value).toBe("18 de agosto de 2026");
  expect(JSON.stringify(registro)).toBe(before);
});
test("oculta cada campo según la configuración del cliente de la obra, incluido cada eje", () => {
  const fields = camposClientePdf(registro, new Set(["eje_numerico", "aislacion"]), { accesibilidadTexto: "Secreto", aislacionAplica: false });
  expect(fields.general).toEqual([]);
  expect(fields.tecnicos).toEqual([
    { label: "Eje numérico", value: "2-4", amplio: false },
    { label: "Aislación", value: "No aplica", amplio: false },
  ]);
  expect(camposClientePdf(registro, new Set()).tecnicos).toEqual([]);
});
test("junta lineal muestra longitud, no número ni cantidad de sellos", () => {
  const fields = camposClientePdf({ ...registro, tipo_registro: "junta_lineal_espuma", metros_lineales: 12.5, numero_sello: "99" });
  expect(fields.tecnicos).toContainEqual({ label: "Longitud (m)", value: "12.5", amplio: false });
  expect(fields.tecnicos.some(f => f.label === "N° de sello")).toBe(false);
});
