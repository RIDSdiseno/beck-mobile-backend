export function normalizeFirematBarcode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, "").trim().toUpperCase();
  return normalized.length >= 3 && normalized.length <= 100 ? normalized : null;
}

export function calculateGtinCheckDigit(body: string): number | null {
  if (!/^\d+$/.test(body)) return null;

  const sum = [...body]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);

  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(value: string): boolean {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false;
  return calculateGtinCheckDigit(value.slice(0, -1)) === Number(value[value.length - 1]);
}

/**
 * Las etiquetas RectorSeal observadas codifican el SKU Firemat de cinco
 * dígitos después del prefijo de empresa 0021449 dentro de un GTIN-14.
 * Esto sólo se usa para sugerir un producto; la asociación se confirma y
 * persiste antes de modificar inventario.
 */
export function extractRectorSealSku(value: string): string | null {
  const match = value.match(/^[1-8]0021449(\d{5})\d$/);
  return match?.[1] ?? null;
}

export function parseUnitsPerBox(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
