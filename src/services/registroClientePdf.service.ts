import { camposClientePdf, type CampoClientePdf, type PresentacionClientePdf } from "../utils/clientePdfPresentacion";

export interface FirmaClientePdf {
  pathData: string;
  canvasWidth: number;
  canvasHeight: number;
  firmadoPor?: string;
  firmadoAt?: Date | string;
}

// Plantilla exclusiva del PDF firmado por cliente. Los PDF técnicos sin firma
// conservan su plantilla; no se alteran cálculos, estados ni registros históricos.
export function renderRegistroClientePdf(doc: PDFKit.PDFDocument, registro: any, images: Buffer[], firma: FirmaClientePdf,
  sello: Buffer | null, visibles?: Set<string>, presentacion?: PresentacionClientePdf) {
  const margin = 40, width = doc.page.width - margin * 2, bottom = doc.page.height - margin - 18;
  const dark = "#111827", muted = "#64748b", yellow = "#f5c400";
  const folio = `REG-${registro.id.slice(0, 6).toUpperCase()}`;
  let y = margin, page = 0;
  const font = (bold = false, size = 9) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
  const header = () => {
    page++;
    doc.rect(0, 0, doc.page.width, 4).fill(yellow);
    font(true, 16).fillColor(dark).text("BECK Soluciones", margin, 24, { width, lineBreak: false });
    font(true, 9).text(folio, margin, 29, { width, align: "right", lineBreak: false });
    const tipo = registro.tipo_registro === "junta_lineal_espuma" ? "Junta lineal espuma" : "Sello cortafuego";
    font(false, 8).fillColor(muted).text(page === 1 ? `${tipo} · Firmado por cliente` : "REGISTRO FIRMADO · CONTINUACIÓN", margin, 45, { width, lineBreak: false });
    // Información contextual de la obra; los datos configurables van en la grilla.
    const obra = [registro.obras?.nombre, registro.obras?.codigo].filter(Boolean).join(" · ");
    font(true, 10).fillColor(dark).text(obra, margin, 61, { width });
    y = Math.max(77, doc.y + 8);
    doc.moveTo(margin, y).lineTo(margin + width, y).lineWidth(1).strokeColor(yellow).stroke();
    y += 8;
  };
  const footer = () => {
    font(false, 7).fillColor(muted).text(`${folio} · Validación del cliente`, margin, bottom + 8, { width, lineBreak: false });
    font(false, 7).text(`Página ${page}`, margin, bottom + 8, { width, align: "right", lineBreak: false });
  };
  const nextPage = () => { footer(); doc.addPage(); header(); };
  const ensure = (height: number) => { if (y + height > bottom) nextPage(); };
  const section = (title: string, firstHeight = 28) => {
    ensure(23 + firstHeight);
    doc.roundedRect(margin, y, width, 18, 3).fill(dark);
    font(true, 8).fillColor("white").text(title, margin + 8, y + 5, { width: width - 16, lineBreak: false });
    y += 23;
  };

  // Fragmenta únicamente textos excepcionalmente largos, sin truncar datos.
  const splitText = (text: string, maxWidth: number, maxHeight: number, size = 9) => {
    font(false, size);
    if (doc.heightOfString(text, { width: maxWidth }) <= maxHeight) return [text, ""];
    let low = 1, high = text.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (doc.heightOfString(text.slice(0, mid), { width: maxWidth }) <= maxHeight) low = mid;
      else high = mid - 1;
    }
    const space = text.lastIndexOf(" ", low);
    const end = space > low / 2 ? space : low;
    return [text.slice(0, end), text.slice(end).trimStart()];
  };
  const grid = (fields: CampoClientePdf[]) => {
    const rows: CampoClientePdf[][] = [];
    let row: CampoClientePdf[] = [];
    for (const field of fields) {
      if (field.amplio) { if (row.length) rows.push(row); rows.push([field]); row = []; }
      else { row.push(field); if (row.length === 3) { rows.push(row); row = []; } }
    }
    if (row.length) rows.push(row);
    for (const cells of rows) {
      const cellWidth = cells[0].amplio ? width : width / 3;
      let remaining = cells.map(c => c.value);
      do {
        ensure(40);
        const labels = cells.map(c => { font(true, 7); return doc.heightOfString(`${c.label}:`, { width: cellWidth - 14 }); });
        const labelHeight = Math.max(...labels);
        const available = bottom - y - labelHeight - 9;
        const chunks = remaining.map(t => splitText(t, cellWidth - 14, available));
        font(false, 9);
        const height = Math.max(27, labelHeight + 9 + Math.max(...chunks.map(([t]) => doc.heightOfString(t, { width: cellWidth - 14 }))));
        cells.forEach((c, i) => {
          const x = margin + i * cellWidth;
          font(true, 7).fillColor(muted).text(`${c.label}:`, x + 7, y + 3, { width: cellWidth - 14 });
          font(false, 9).fillColor(dark).text(chunks[i][0], x + 7, y + 5 + labelHeight, { width: cellWidth - 14 });
        });
        y += height;
        doc.moveTo(margin, y - 2).lineTo(margin + width, y - 2).lineWidth(0.4).strokeColor("#e2e8f0").stroke();
        remaining = chunks.map(c => c[1]);
        if (remaining.some(Boolean)) nextPage();
      } while (remaining.some(Boolean));
    }
    y += 4;
  };

  header();
  const fields = camposClientePdf(registro, visibles, presentacion);
  if (fields.general.length) { section("INFORMACIÓN GENERAL"); grid(fields.general); }
  if (fields.tecnicos.length) { section("DATOS TÉCNICOS"); grid(fields.tecnicos); }
  if (registro.observaciones) { section("OBSERVACIONES"); grid([{ label: "Observaciones", value: String(registro.observaciones), amplio: true }]); }

  // La firma y el sello están contenidos en un único recuadro blanco.
  font(true, 8);
  const signer = firma.firmadoPor || "Cliente";
  const signerHeight = doc.heightOfString(signer, { width: width - 170 });
  const signatureHeight = 131 + Math.max(0, signerHeight - 10);
  if (!visibles || visibles.has("foto")) {
    // Tamaño adaptable para que un registro normal y su firma compartan A4.
    const photoRows = Math.ceil(images.length / 3);
    const available = bottom - y - signatureHeight - 36;
    const photoHeight = Math.max(85, Math.min(135, photoRows ? (available - 23) / photoRows - 16 : 85));
    section("EVIDENCIA FOTOGRÁFICA", images.length ? photoHeight + 16 : 22);
    if (!images.length) {
      font(false, 8).fillColor(muted).text("Sin fotos asociadas.", margin + 7, y, { width });
      y += 22;
    }
    for (let start = 0; start < images.length; start += 3) {
      ensure(photoHeight + 16);
      const group = images.slice(start, start + 3), gap = 8;
      const imageWidth = (width - gap * (group.length - 1)) / group.length;
      group.forEach((buffer, i) => {
        const x = margin + i * (imageWidth + gap);
        doc.roundedRect(x, y, imageWidth, photoHeight, 4).lineWidth(0.5).strokeColor("#cbd5e1").stroke();
        try { doc.image(buffer, x + 4, y + 4, { fit: [imageWidth - 8, photoHeight - 8], align: "center", valign: "center" }); }
        catch { throw new Error("Una fotografía del registro no se puede incluir en el PDF. Revisa el archivo antes de firmar."); }
        font(false, 7).fillColor(muted).text(`Fotografía ${start + i + 1}`, x, y + photoHeight + 3, { width: imageWidth, align: "center", lineBreak: false });
      });
      y += photoHeight + 16;
    }
    y += 6;
  }
  ensure(signatureHeight + 8);
  y += 4;
  doc.roundedRect(margin, y, width, signatureHeight, 6).fillAndStroke("#ffffff", "#cbd5e1");
  doc.moveTo(margin + 12, y + 25).lineTo(margin + width - 12, y + 25).strokeColor(yellow).lineWidth(1).stroke();
  font(true, 9).fillColor(dark).text("VALIDACIÓN DEL CLIENTE", margin + 12, y + 9, { width: width - 24, lineBreak: false });
  font(false, 7).fillColor(muted).text("Firmado por:", margin + 12, y + 32, { width: width - 170, lineBreak: false });
  font(true, 8).fillColor(dark).text(signer, margin + 12, y + 42, { width: width - 170 });
  const signedAt = firma.firmadoAt ? new Intl.DateTimeFormat("es-CL", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago",
  }).format(new Date(firma.firmadoAt)) : "—";
  font(false, 7).fillColor(muted).text(`Fecha de firma: ${signedAt}`, margin + 12, y + 46 + signerHeight, { width: width - 170, lineBreak: false });
  const sigX = margin + 12, sigY = y + 58 + signerHeight, sigW = width - 150, sigH = signatureHeight - (sigY - y) - 19;
  const scale = Math.min(sigW / firma.canvasWidth, sigH / firma.canvasHeight);
  doc.save();
  try {
    doc.rect(sigX, sigY, sigW, sigH).clip()
      .translate(sigX + (sigW - firma.canvasWidth * scale) / 2, sigY + (sigH - firma.canvasHeight * scale) / 2)
      .scale(scale).path(firma.pathData).lineWidth(1.3 / scale).lineCap("round").lineJoin("round").strokeColor(dark).stroke();
  } finally { doc.restore(); }
  font(false, 7).fillColor(muted).text("Firma del cliente", sigX, y + signatureHeight - 13, { width: sigW, align: "center", lineBreak: false });
  if (sello) {
    try { doc.image(sello, margin + width - 115, y + 32, { fit: [94, 82], align: "center", valign: "center" }); }
    catch { /* Un sello no disponible no altera la firma del cliente. */ }
  }
  y += signatureHeight;
  doc.y = y;
  footer();
}
