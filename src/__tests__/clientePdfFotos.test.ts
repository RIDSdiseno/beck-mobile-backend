import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
jest.mock("../config/prisma", () => ({ prisma: {} }));
jest.mock("../controllers/ingenieria.controller", () => ({ findRegistroWithDetails: jest.fn() }));
jest.mock("../services/cloudinary.service", () => ({ getPrivateDownloadUrl: jest.fn() }));
import { generateRegistroPdfBuffer } from "../controllers/registroPdf.controller";

const registro = { id: "abcdef-prueba", fecha: new Date("2026-09-25T00:00:00Z"), foto_url: "https://example.test/foto.jpg", fotos_urls: ["https://example.test/foto.jpg"], fotos: [] };
const firma = { pathData: "M 1 1 L 20 20", canvasWidth: 100, canvasHeight: 100 };
afterEach(() => jest.restoreAllMocks());
test("incluye la fotografía antigua sin duplicarla con fotos_urls", async () => {
  const buffer = fs.readFileSync(path.join(process.cwd(), "assets", "sello-beck.png"));
  const fetch = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, arrayBuffer: async () => buffer } as unknown as Response);
  const image = jest.spyOn(PDFDocument.prototype, "image");
  await generateRegistroPdfBuffer(registro, firma, new Set(["foto"]));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(image).toHaveBeenCalledTimes(2); // Una foto y un sello.
});
test("no descarga fotografías ocultas en la configuración de cliente", async () => {
  const fetch = jest.spyOn(global, "fetch");
  await generateRegistroPdfBuffer(registro, firma, new Set());
  expect(fetch).not.toHaveBeenCalled();
});
test("no genera un firmado incompleto cuando no se puede descargar la fotografía", async () => {
  jest.spyOn(global, "fetch").mockResolvedValue({ ok: false } as Response);
  await expect(generateRegistroPdfBuffer(registro, firma, new Set(["foto"])))
    .rejects.toThrow("No se pudieron cargar todas las fotografías");
});
