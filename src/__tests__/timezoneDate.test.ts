import { getUtcRangeForLocalDate } from "../utils/timezoneDate";

describe("rango diario en la zona horaria de Chile", () => {
  it("convierte un día de invierno a sus límites UTC correctos", () => {
    const range = getUtcRangeForLocalDate("2026-08-21");

    expect(range?.start.toISOString()).toBe("2026-08-21T04:00:00.000Z");
    expect(range?.end.toISOString()).toBe("2026-08-22T04:00:00.000Z");
  });

  it("considera el horario de verano de Santiago", () => {
    const range = getUtcRangeForLocalDate("2026-12-21");

    expect(range?.start.toISOString()).toBe("2026-12-21T03:00:00.000Z");
    expect(range?.end.toISOString()).toBe("2026-12-22T03:00:00.000Z");
  });

  it("rechaza fechas inexistentes", () => {
    expect(getUtcRangeForLocalDate("2026-02-31")).toBeNull();
  });
});
