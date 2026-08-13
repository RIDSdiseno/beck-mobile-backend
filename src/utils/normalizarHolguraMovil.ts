const HOLGURAS_SELECTOR_HEREDADO = new Map<number, number>([
  [0, 0],
  [1, 2],
  [1.2, 4],
  [1.4, 6],
  [1.8, 10],
]);

export function normalizarHolguraMovil(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return value;

  const parsed = Number.parseFloat(String(value).trim().replace(",", "."));
  if (!Number.isFinite(parsed)) return value;

  return HOLGURAS_SELECTOR_HEREDADO.get(parsed) ?? value;
}
