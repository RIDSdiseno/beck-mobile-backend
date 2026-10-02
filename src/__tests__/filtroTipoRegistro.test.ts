import type { Response } from "express";
import { leerFiltroTipoRegistro } from "../utils/filtroTipoRegistro";

function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}

test.each([undefined, "", "todos"])("%s conserva la consulta sin restricción de tipo", (value) => {
  const res = response();
  expect(leerFiltroTipoRegistro(value, res)).toBeUndefined();
  expect(res.status).not.toHaveBeenCalled();
});
test.each(["sello_cortafuego", "junta_lineal_espuma", "tabiqueria"])("acepta %s", (value) => {
  expect(leerFiltroTipoRegistro(value, response())).toBe(value);
});
test.each(["otro", ["tabiqueria"], { equals: "tabiqueria" }, 1])( "rechaza el filtro inválido %j", (value) => {
  const res = response();
  expect(leerFiltroTipoRegistro(value, res)).toBe(false);
  expect(res.status).toHaveBeenCalledWith(400);
});
