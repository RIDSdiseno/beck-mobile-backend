import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { renderRegistroClientePdf } from "../services/registroClientePdf.service";

const image = fs.readFileSync(path.join(process.cwd(), "assets", "sello-beck.png"));
const firma = { pathData: "M 10 10 L 50 20 L 70 40", canvasWidth: 300, canvasHeight: 220, firmadoPor: "Cliente de prueba", firmadoAt: "2026-09-25T18:00:00Z" };
const registro = {
  id: "a57f1e-prueba", tipo_registro: "sello_cortafuego", codigo_beck: "1-112", obras: { nombre: "PRUEBA RIDS", codigo: "65" },
  fecha: new Date("2026-08-18T00:00:00Z"), dia_semana: "Miércoles", folio: "12", descripcion_material: "Conduit de 160 mm",
  itemizado_beck: "Conduit de 160 mm", itemizado_mandante: "Mandante 1", dimensiones: "60 mm", recinto: "No hay", modulo: "No aplica",
  piso: "2", eje_numerico: "2", eje_alfabetico: "A", numero_sello: "0002", cantidad_sellos: 2, cantidad_final: 2,
  nombre_sellador: "Operario de prueba", holgura: 2, factor_por_holguras: 1, cantidad_sellos_con_factores: 2,
  aislacion: 1, cantidad_sellos_aislacion: 1, reparacion_tabique: 0, observaciones: "60",
};
const presentacion = { accesibilidadTexto: "Accesibilidad normal - Factor 1.0", aislacionAplica: false };

function render(data = registro, photos = [image], visible?: Set<string>) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  doc.on("data", () => {});
  let pages = 1;
  doc.on("pageAdded", () => pages++);
  renderRegistroClientePdf(doc, data, photos, firma, image, visible, presentacion);
  doc.end();
  return pages;
}
afterEach(() => jest.restoreAllMocks());
test("un registro completo con foto y firma cabe en una sola página A4", () => {
  expect(render()).toBe(1);
});
test("firma y sello comparten un recuadro blanco y el sello queda dentro de sus límites", () => {
  const rect = jest.spyOn(PDFDocument.prototype, "roundedRect");
  const images = jest.spyOn(PDFDocument.prototype, "image");
  const fill = jest.spyOn(PDFDocument.prototype, "fillAndStroke");
  render();
  const [x, y, width, height] = rect.mock.calls[rect.mock.calls.length - 1] as number[];
  const [, stampX, stampY, options] = images.mock.calls[images.mock.calls.length - 1] as [Buffer, number, number, { fit: number[] }];
  expect(stampX).toBeGreaterThan(x);
  expect(stampY).toBeGreaterThan(y);
  expect(stampX + options.fit[0]).toBeLessThan(x + width);
  expect(stampY + options.fit[1]).toBeLessThan(y + height);
  expect(fill).toHaveBeenCalledWith("#ffffff", "#cbd5e1");
});
test("muchas fotos o texto largo generan continuaciones sin perder datos ni duplicar la firma", () => {
  const text = jest.spyOn(PDFDocument.prototype, "text");
  const longText = `${"Detalle largo de instalación. ".repeat(200)} FINAL DEL TEXTO`;
  expect(render({ ...registro, observaciones: longText }, Array(12).fill(image))).toBeGreaterThan(1);
  const values = text.mock.calls.map(args => String(args[0]));
  expect(values.join(" ")).toContain("FINAL DEL TEXTO");
  expect(values.filter(t => t === "VALIDACIÓN DEL CLIENTE")).toHaveLength(1);
  expect(values.filter(t => /^Fotografía \d+$/.test(t))).toHaveLength(12);
});
test("campos y fotos ocultos no se dibujan", () => {
  const images = jest.spyOn(PDFDocument.prototype, "image");
  const text = jest.spyOn(PDFDocument.prototype, "text");
  render(registro, [image], new Set(["numeroSello"]));
  expect(images).toHaveBeenCalledTimes(1); // Únicamente sello institucional.
  const values = text.mock.calls.map(args => args[0]);
  expect(values).not.toContain("EVIDENCIA FOTOGRÁFICA");
  expect(values).not.toContain("Aislación:");
  expect(values).not.toContain("Eje numérico:");
  expect(values).toContain("0002");
});
