import { Request, Response } from "express";
import PDFDocument from "pdfkit";
import { findRegistroWithDetails } from "./ingenieria.controller";

// ── Constantes de layout ────────────────────────────────────────────────────────

const PDF_MARGIN    = 40;
const PDF_W         = 595;
const PDF_CONTENT_W = PDF_W - PDF_MARGIN * 2;

const BECK_YELLOW = "#f5c400";
const BECK_DARK   = "#111827";
const TEXT_DARK   = "#1e293b";
const TEXT_MUTED  = "#64748b";

// ── Helpers ─────────────────────────────────────────────────────────────────────

const formatDate = (fecha: Date | string): string =>
  new Intl.DateTimeFormat("es-CL", {
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(typeof fecha === "string" ? new Date(fecha) : fecha);

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function pdfHRule(doc: PDFKit.PDFDocument, color = "#e2e8f0"): void {
  doc.strokeColor(color).lineWidth(0.5)
    .moveTo(PDF_MARGIN, doc.y)
    .lineTo(PDF_W - PDF_MARGIN, doc.y)
    .stroke();
  doc.y += 6;
}

function pdfSectionHeader(doc: PDFKit.PDFDocument, title: string): void {
  doc.y += 4;
  const y = doc.y;
  doc.rect(PDF_MARGIN, y, PDF_CONTENT_W, 18).fill(BECK_DARK);
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff")
    .text(title, PDF_MARGIN + 8, y + 5, { width: PDF_CONTENT_W - 16, lineBreak: false });
  doc.y = y + 18 + 7;
}

function pdfFieldRow(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string | number | null | undefined,
): void {
  const y      = doc.y;
  const labelW = 145;
  const valW   = PDF_CONTENT_W - labelW;
  const valStr = value == null || value === "" ? "-" : String(value);

  doc.font("Helvetica-Bold").fontSize(9).fillColor(TEXT_MUTED)
    .text(label, PDF_MARGIN, y, { width: labelW, lineBreak: false });
  doc.font("Helvetica").fontSize(9).fillColor(TEXT_DARK)
    .text(valStr, PDF_MARGIN + labelW, y, { width: valW });

  if (doc.y < y + 13) doc.y = y + 13;
}

// ── Controlador ──────────────────────────────────────────────────────────────────

/**
 * GET /api/ingenieria/registros/:id/pdf
 * Genera el PDF del registro. Solo disponible para estado "validado".
 */
export async function descargarRegistroPdf(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;

    const registro = await findRegistroWithDetails(id);

    if (!registro) {
      res.status(404).json({ success: false, error: "Registro no encontrado" });
      return;
    }

    if (registro.estado !== "validado") {
      res.status(403).json({ success: false, error: "El PDF solo está disponible para registros validados" });
      return;
    }

    // URLs de fotos: prioridad tabla fotos, fallback array de columna
    const fotoUrls: string[] =
      registro.fotos.length > 0
        ? registro.fotos.map((f) => f.url)
        : (Array.isArray(registro.fotos_urls) ? registro.fotos_urls : []);

    const imageBuffers = await Promise.all(fotoUrls.map(fetchImageBuffer));
    const validImages  = imageBuffers.filter((b): b is Buffer => b !== null);

    const esJunta        = registro.tipo_registro === "junta_lineal_espuma";
    const codigoRegistro = registro.codigo_beck ?? `REG-${registro.id.slice(0, 6).toUpperCase()}`;
    const tituloTipo     = esJunta ? "Registro de Junta Lineal Espuma" : "Registro de Sello Cortafuego";
    const cantLabel      = esJunta ? "Longitud ejecutada (m)" : "Cantidad de sellos";
    const cantValor      = esJunta
      ? (registro.metros_lineales != null ? String(registro.metros_lineales) : "-")
      : String(registro.cantidad_sellos);

    // ── Abrir documento ─────────────────────────────────────────────────────────
    const doc = new PDFDocument({ size: "A4", margin: PDF_MARGIN });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${codigoRegistro}.pdf"`);
    doc.pipe(res);

    // ══════════════════════════════════════════════════════════════
    // ENCABEZADO
    // ══════════════════════════════════════════════════════════════

    doc.rect(0, 0, PDF_W, 5).fill(BECK_YELLOW);
    doc.y = 14;
    const headerY = doc.y;

    doc.font("Helvetica-Bold").fontSize(15).fillColor(BECK_DARK)
      .text("BECK Soluciones", PDF_MARGIN, headerY, { lineBreak: false });
    doc.font("Helvetica").fontSize(9).fillColor(TEXT_MUTED)
      .text("Informe Técnico de Registro", PDF_MARGIN, headerY + 20, { lineBreak: false });

    const genDate = new Intl.DateTimeFormat("es-CL", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date());
    doc.font("Helvetica").fontSize(8).fillColor("#94a3b8")
      .text(`Generado: ${genDate}`, PDF_MARGIN, headerY + 32, {
        width: PDF_CONTENT_W, align: "right", lineBreak: false,
      });

    doc.y = headerY + 50;
    doc.rect(PDF_MARGIN, doc.y, PDF_CONTENT_W, 1.5).fill(BECK_YELLOW);
    doc.y += 10;

    // ── Título y badge de estado ────────────────────────────────────────────────

    doc.font("Helvetica-Bold").fontSize(14).fillColor(BECK_DARK).text(tituloTipo);
    doc.y += 3;
    doc.font("Helvetica").fontSize(10).fillColor(TEXT_MUTED)
      .text(`Código: ${codigoRegistro}   ·   Fecha ejecución: ${formatDate(registro.fecha)}`);
    doc.y += 8;

    const badgeY = doc.y;
    doc.rect(PDF_MARGIN, badgeY, 90, 15).fill("#16a34a");
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#ffffff")
      .text("VALIDADO", PDF_MARGIN + 5, badgeY + 4, { width: 80, lineBreak: false });
    doc.y = badgeY + 22;

    pdfHRule(doc);

    // ══════════════════════════════════════════════════════════════
    // INFORMACIÓN GENERAL
    // ══════════════════════════════════════════════════════════════

    pdfSectionHeader(doc, "INFORMACIÓN GENERAL");
    pdfFieldRow(doc, "Código BECK:",   codigoRegistro);
    pdfFieldRow(doc, "Obra:",          `${registro.obras?.nombre ?? "-"}${registro.obras?.codigo ? ` (${registro.obras.codigo})` : ""}`);
    pdfFieldRow(doc, "Cliente:",       registro.obras?.cliente ?? "-");
    pdfFieldRow(doc, "Ejecutado por:", registro.usuarios?.nombre ?? "-");
    pdfFieldRow(doc, "Día semana:",    registro.dia_semana);
    pdfFieldRow(doc, "Folio:",         registro.folio);

    pdfHRule(doc);

    // ══════════════════════════════════════════════════════════════
    // DATOS TÉCNICOS
    // ══════════════════════════════════════════════════════════════

    pdfSectionHeader(doc, "DATOS TÉCNICOS");
    pdfFieldRow(doc, "Descripción material:",     registro.descripcion_material);
    pdfFieldRow(doc, "Recinto:",                  registro.recinto);
    pdfFieldRow(doc, "Módulo / Edificio:",        registro.modulo);
    pdfFieldRow(doc, "Piso:",                     registro.piso);
    pdfFieldRow(doc, "Eje alfabético:",           registro.eje_alfabetico);
    pdfFieldRow(doc, "Eje numérico:",             registro.eje_numerico);
    if (!esJunta) {
      pdfFieldRow(doc, "N° de sello:", registro.numero_sello);
    }
    pdfFieldRow(doc, `${cantLabel}:`,            cantValor);
    pdfFieldRow(doc, "Sellador / Cuadrilla:",     registro.nombre_sellador);
    pdfFieldRow(doc, "Holgura (cm):",            registro.holgura != null ? registro.holgura.toString() : "-");
    pdfFieldRow(doc, "Factor por holguras:",     registro.factor_por_holguras != null ? registro.factor_por_holguras.toString() : "-");
    pdfFieldRow(doc, "Accesibilidad:",           registro.accesibilidad);
    pdfFieldRow(doc, "Sellos con factores:",     registro.cantidad_sellos_con_factores != null ? registro.cantidad_sellos_con_factores.toString() : "-");
    pdfFieldRow(doc, "Aislación:",              registro.aislacion != null ? registro.aislacion.toString() : "-");
    pdfFieldRow(doc, "Sellos aislación:",       registro.cantidad_sellos_aislacion != null ? registro.cantidad_sellos_aislacion.toString() : "-");
    pdfFieldRow(doc, "Reparación tabique:",     registro.reparacion_tabique != null ? registro.reparacion_tabique.toString() : "-");
    pdfFieldRow(doc, "Cantidad final:",         registro.cantidad_final != null ? registro.cantidad_final.toString() : "-");

    pdfHRule(doc);

    // ══════════════════════════════════════════════════════════════
    // OBSERVACIONES
    // ══════════════════════════════════════════════════════════════

    pdfSectionHeader(doc, "OBSERVACIONES");
    doc.font("Helvetica").fontSize(9).fillColor(TEXT_DARK)
      .text(registro.observaciones || "Sin observaciones.", PDF_MARGIN, doc.y, { width: PDF_CONTENT_W });
    doc.y += 6;

    pdfHRule(doc);

    // ══════════════════════════════════════════════════════════════
    // FOTOGRAFÍAS
    // ══════════════════════════════════════════════════════════════

    pdfSectionHeader(doc, "FOTOGRAFÍAS DE REGISTRO");

    if (validImages.length === 0) {
      doc.font("Helvetica").fontSize(9).fillColor("#94a3b8")
        .text("Sin fotos asociadas.", PDF_MARGIN, doc.y);
    } else {
      const imgW = Math.floor((PDF_CONTENT_W - 10) / 2);
      const imgH = 175;
      const gap  = 10;
      let rowY   = doc.y + 4;
      let colIdx = 0;

      validImages.forEach((buf, imgIndex) => {
        if (colIdx === 0 && rowY + imgH > 800) {
          doc.addPage();
          rowY = PDF_MARGIN;
        }

        const isAlone = colIdx === 0 && imgIndex === validImages.length - 1;
        const imgX    = isAlone
          ? PDF_MARGIN + (PDF_CONTENT_W - imgW) / 2
          : PDF_MARGIN + colIdx * (imgW + gap);

        try { doc.image(buf, imgX, rowY, { fit: [imgW, imgH] }); } catch { /* imagen no procesable */ }

        colIdx++;
        if (colIdx >= 2) { colIdx = 0; rowY += imgH + 10; }
      });

      doc.y = rowY + (colIdx > 0 ? imgH : 0) + 12;
    }

    doc.end();
  } catch (error) {
    console.error("Error al generar PDF de registro:", error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Error al generar el PDF" });
    } else {
      res.end();
    }
  }
}
