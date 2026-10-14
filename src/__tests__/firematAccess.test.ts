import type { Request, Response } from "express";
import { permitirFiremat } from "../middlewares/firematAccess.middleware";

describe("Acceso móvil a Firemat", () => {
  test.each([
    ["administrador", "beck", true, true],
    ["administrador", "firemat", false, false],
    ["bodeguero", "firemat", true, true],
    ["vendedor_firemat", "firemat", true, false],
    ["visualizador_firemat", "firemat", true, false],
    ["terreno", "beck", false, false],
    ["supervisor", "beck", false, false],
    ["ingenieria", "beck", false, false],
    ["cliente", "beck", false, false],
  ])("%s de %s conserva los permisos correspondientes", (rol, empresa, lectura, gestion) => {
    const user = { id: "usuario-original", rol, empresa };
    const req = { user } as Request;
    for (const [soloGestion, permitido] of [[false, lectura], [true, gestion]]) {
      const next = jest.fn();
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      permitirFiremat(soloGestion)(req, res as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(permitido ? 1 : 0);
      if (!permitido) expect(res.status).toHaveBeenCalledWith(403);
      expect(req.user).toBe(user);
    }
  });
  test("no autoriza sin usuario", () => {
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    permitirFiremat()({} as Request, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
