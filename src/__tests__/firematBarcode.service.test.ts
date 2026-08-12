import {
  calculateGtinCheckDigit,
  extractRectorSealSku,
  isValidGtin,
  normalizeFirematBarcode,
  parseUnitsPerBox,
} from "../services/firematBarcode.service";

describe("firematBarcode.service", () => {
  it.each([
    ["10021449660911", "66091"],
    ["10021449666524", "66652"],
    ["10021449660157", "66015"],
  ])("extrae el SKU RectorSeal de %s", (barcode, sku) => {
    expect(isValidGtin(barcode)).toBe(true);
    expect(extractRectorSealSku(barcode)).toBe(sku);
  });

  it("no propone SKU para un GTIN ajeno o inválido", () => {
    expect(extractRectorSealSku("10000000660911")).toBeNull();
    expect(isValidGtin("10021449660912")).toBe(false);
  });

  it("calcula el dígito verificador", () => {
    expect(calculateGtinCheckDigit("1002144966091")).toBe(1);
  });

  it("normaliza lecturas y cantidades", () => {
    expect(normalizeFirematBarcode(" 1 0021449 66091 1 ")).toBe("10021449660911");
    expect(parseUnitsPerBox("12")).toBe(12);
    expect(parseUnitsPerBox("15kg")).toBeNull();
    expect(parseUnitsPerBox(0)).toBeNull();
  });
});
