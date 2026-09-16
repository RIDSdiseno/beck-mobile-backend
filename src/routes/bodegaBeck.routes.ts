import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { Prisma } from "@prisma/client";
import { verifyAppToken } from "../middlewares/auth.middleware";
import * as bodega from "../services/bodegaBeck.service";
import {
  buscarInventarioPorCodigo,
  InventarioBeckError,
} from "../services/inventarioBeck.service";

export function soloBodegueroFiremat(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (
    req.user?.rol !== "bodeguero" ||
    req.user.empresa !== "firemat" ||
    !req.user.email.toLowerCase().endsWith("@firemat.cl")
  ) {
    return res
      .status(403)
      .json({
        success: false,
        error: "Acceso exclusivo de bodega Firemat al inventario BECK.",
      });
  }
  next();
}
const router = Router();
router.use(verifyAppToken, soloBodegueroFiremat);
const action =
  (fn: (req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    try {
      return res.json({ success: true, data: await fn(req) });
    } catch (e) {
      if (e instanceof InventarioBeckError)
        return res.status(e.status).json({ success: false, error: e.message });
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P2002"].includes(e.code)
      )
        return res
          .status(409)
          .json({
            success: false,
            error:
              "El inventario cambió durante la operación. Reintenta la misma solicitud.",
          });
      console.error(
        "BODEGA_BECK_ERROR",
        e instanceof Error ? e.message : "Error",
      );
      return res
        .status(500)
        .json({
          success: false,
          error: "No se pudo completar la operación de bodega.",
        });
    }
  };
router.get(
  "/acceso",
  action(async () => ({ autorizado: true })),
);
router.get("/etiquetas", async (req, res) => {
  try {
    const buffer = await bodega.etiquetasBodega(req.query);
    return res
      .type("application/pdf")
      .set("Content-Disposition", 'attachment; filename="etiquetas-beck.pdf"')
      .send(buffer);
  } catch (e) {
    return res
      .status(e instanceof InventarioBeckError ? e.status : 500)
      .json({
        success: false,
        error:
          e instanceof InventarioBeckError
            ? e.message
            : "No se pudieron generar las etiquetas.",
      });
  }
});
router.get(
  "/resumen",
  action(() => bodega.resumenBodega()),
);
router.get(
  "/opciones",
  action(() => bodega.opcionesBodega()),
);
router.get(
  "/historial",
  action((req) => bodega.historialBodega(req.user!.id, req.query.page)),
);
router.get(
  "/codigo/:codigo",
  action((req) => buscarInventarioPorCodigo(req.user!.id, req.params.codigo)),
);
router.get(
  "/asignaciones",
  action((req) => bodega.listarAsignacionesBodega(req.query)),
);
router.post(
  "/asignaciones",
  action((req) => bodega.asignarDesdeBodega(req.user!.id, req.body || {})),
);
router.get(
  "/asignaciones/:id/trazabilidad",
  action((req) => bodega.trazabilidadBodega(req.params.id, req.query.page)),
);
router.post(
  "/asignaciones/:id/recibir",
  action((req) =>
    bodega.recibirBodega(req.user!.id, req.params.id, req.body?.requestId),
  ),
);
router.get(
  "/articulos/:tipo",
  action((req) =>
    bodega.listarBodega(
      req.params.tipo,
      req.query.q,
      req.query.page,
      req.query.activo,
    ),
  ),
);
router.post(
  "/articulos/:tipo",
  action((req) =>
    bodega.guardarArticulo(req.user!.id, req.params.tipo, null, req.body || {}),
  ),
);
router.put(
  "/articulos/:tipo/:id",
  action((req) =>
    bodega.guardarArticulo(
      req.user!.id,
      req.params.tipo,
      req.params.id,
      req.body || {},
    ),
  ),
);
router.post(
  "/articulos/:tipo/:id/stock",
  action((req) =>
    bodega.ajustarStock(
      req.user!.id,
      req.params.tipo,
      req.params.id,
      req.body || {},
    ),
  ),
);
router.post(
  "/articulos/:tipo/:id/sku",
  action((req) =>
    bodega.generarSkuBodega(
      req.user!.id,
      req.params.tipo,
      req.params.id,
      req.body?.requestId,
    ),
  ),
);
export default router;
