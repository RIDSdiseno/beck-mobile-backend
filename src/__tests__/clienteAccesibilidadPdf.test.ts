import PDFDocument from "pdfkit";

jest.mock("../config/prisma", () => ({ prisma: {} }));
jest.mock("../controllers/ingenieria.controller", () => ({ findRegistroWithDetails: jest.fn() }));
jest.mock("../services/cloudinary.service", () => ({ getPrivateDownloadUrl: jest.fn() }));

import { generateRegistroPdfBuffer } from "../controllers/registroPdf.controller";
import { describirAccesibilidad } from "../utils/accesibilidadPresentacion";

const registro = {
  id: "registro-1", tipo_registro: "sello_cortafuego", cantidad_sellos: 2,
  accesibilidad: 2, fecha: new Date("2026-09-25T00:00:00Z"), estado: "validado",
  obras: { nombre: "Obra de prueba" }, fotos: [],
};
const firma = { pathData: "M 10 10 L 40 40", canvasWidth: 100, canvasHeight: 100, firmadoPor: "Cliente de prueba" };

afterEach(() => jest.restoreAllMocks());

test("el PDF firmado incluye la descripción con el factor personalizado", async () => {
  const text = jest.spyOn(PDFDocument.prototype, "text");
  const accesibilidadTexto = describirAccesibilidad(2, [{ nivel: 2, factor: 1.25 }]);
  const pdf = await generateRegistroPdfBuffer(registro, firma, new Set(["accesibilidad"]), { accesibilidadTexto });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  const textos = text.mock.calls.map((args) => args[0]);
  expect(textos).toContain("Accesibilidad:");
  expect(textos).toContain("Cielos Americanos o estructurado - Factor 1.25");
  expect(textos).toContain("VALIDACIÓN DEL CLIENTE");
  expect(registro.accesibilidad).toBe(2);
});

test("el PDF firmado no muestra el campo ni su descripción si está oculto", async () => {
  const text = jest.spyOn(PDFDocument.prototype, "text");
  const accesibilidadTexto = "Cielos Americanos o estructurado - Factor 1.25";
  await generateRegistroPdfBuffer(registro, firma, new Set(["numeroSello"]), { accesibilidadTexto });
  const textos = text.mock.calls.map((args) => args[0]);
  expect(textos).not.toContain("Accesibilidad:");
  expect(textos).not.toContain(accesibilidadTexto);
  expect(textos).toContain("VALIDACIÓN DEL CLIENTE");
});

test("el PDF firmado conserva No aplica como factor neutral", async () => {
  const text = jest.spyOn(PDFDocument.prototype, "text");
  await generateRegistroPdfBuffer({ ...registro, accesibilidad: 0 }, firma, new Set(["accesibilidad"]), {
    accesibilidadTexto: describirAccesibilidad(0, [{ nivel: 1, factor: 4 }]),
  });
  expect(text.mock.calls.map((args) => args[0])).toContain("No aplica - Factor 1.0");
});
