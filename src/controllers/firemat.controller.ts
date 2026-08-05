import { Request, Response } from "express";
import { getFirematPool, withFirematTransaction } from "../config/firematDb";

type ProductoRow = {
  id: number;
  nombre: string;
  sku: string | null;
  descripcion: string | null;
  categoria: string;
  categoriaId: number;
  precio: number;
  precioUsd: number | null;
  precioSugerido: number | null;
  disponibilidad: string | null;
  formato: string | null;
  cantidadCaja: string | null;
  stock: number;
  stockReservado: number;
  minStock: number;
  ubicacion: string | null;
  criticidad: string;
  activo: boolean;
  imagen: string | null;
  stockInicial: number | null;
  entradas: number | null;
  salidas: number | null;
  fechaUltimaEntrada: Date | null;
  fechaUltimaSalida: Date | null;
  createdAt: Date;
};

const PRODUCT_SELECT = `
  SELECT p.id, p.nombre, p.sku, p.descripcion,
         c.nombre AS categoria, p."categoriaId",
         p.precio, p."precioUsd", p."precioSugerido",
         p.disponibilidad, p.formato, p."cantidadCaja",
         p.stock, p."stockReservado", p."minStock", p.ubicacion,
         p.criticidad, p.activo, p.imagen, p."stockInicial",
         p.entradas, p.salidas, p."fechaUltimaEntrada",
         p."fechaUltimaSalida", p."createdAt"
    FROM "Producto" p
    JOIN "Categoria" c ON c.id = p."categoriaId"
`;

function parsePositiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function toProductoDto(row: ProductoRow) {
  const stockDisponible = row.stock - row.stockReservado;
  const estadoStock =
    stockDisponible <= 0
      ? "SIN_STOCK"
      : stockDisponible <= row.minStock
        ? "BAJO_STOCK"
        : "OK";

  return {
    ...row,
    stockActual: row.stock,
    stockMinimo: row.minStock,
    stockDisponible,
    estadoStock,
    alertaStockBajo: estadoStock !== "OK",
  };
}

function firematError(res: Response, error: unknown, message: string) {
  const configurationError =
    error instanceof Error && error.message === "FIREMAT_DATABASE_URL_NOT_CONFIGURED";
  if (configurationError) {
    return res.status(503).json({
      success: false,
      error: "La conexión Firemat no está configurada",
      code: "FIREMAT_NOT_CONFIGURED",
    });
  }
  console.error(message, error);
  return res.status(500).json({ success: false, error: message });
}

export async function getCategoriasFiremat(_req: Request, res: Response) {
  try {
    const result = await getFirematPool().query<{ id: number; nombre: string }>(
      `SELECT id, nombre FROM "Categoria" ORDER BY nombre ASC`,
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return firematError(res, error, "No se pudieron obtener las categorías Firemat");
  }
}

export async function getProductosFiremat(req: Request, res: Response) {
  try {
    const values: unknown[] = [];
    const filters: string[] = [];
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (query) {
      values.push(`%${query}%`);
      filters.push(`(p.nombre ILIKE $${values.length} OR p.sku ILIKE $${values.length} OR p.descripcion ILIKE $${values.length})`);
    }
    if (req.query.activo === "true" || req.query.activo === "false") {
      values.push(req.query.activo === "true");
      filters.push(`p.activo = $${values.length}`);
    }
    const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
    const result = await getFirematPool().query<ProductoRow>(
      `${PRODUCT_SELECT}${where} ORDER BY p."createdAt" DESC`,
      values,
    );
    return res.json({
      success: true,
      total: result.rows.length,
      data: result.rows.map(toProductoDto),
    });
  } catch (error) {
    return firematError(res, error, "No se pudieron obtener los productos Firemat");
  }
}

export async function createProductoFiremat(req: Request, res: Response) {
  try {
    const nombre = typeof req.body?.nombre === "string" ? req.body.nombre.trim() : "";
    const sku = typeof req.body?.sku === "string" ? req.body.sku.trim() : "";
    const categoriaId = parsePositiveId(req.body?.categoriaId);
    const precio = Number(req.body?.precio ?? 0);
    const stockInicial = parseNonNegativeInteger(req.body?.stockInicial ?? 0);
    const stockMinimo = parseNonNegativeInteger(req.body?.stockMinimo ?? 0);

    if (!nombre || !sku || !categoriaId) {
      return res.status(400).json({ success: false, error: "Nombre, SKU y categoría son obligatorios" });
    }
    if (!Number.isFinite(precio) || precio < 0 || stockInicial === null || stockMinimo === null) {
      return res.status(400).json({ success: false, error: "Precio y stock deben ser valores válidos" });
    }
    const precioUsd = req.body.precioUsd === undefined || req.body.precioUsd === null
      ? null
      : Number(req.body.precioUsd);
    const precioSugerido = req.body.precioSugerido === undefined || req.body.precioSugerido === null
      ? null
      : Number(req.body.precioSugerido);
    if (
      (precioUsd !== null && (!Number.isFinite(precioUsd) || precioUsd < 0)) ||
      (precioSugerido !== null && (!Number.isFinite(precioSugerido) || precioSugerido < 0))
    ) {
      return res.status(400).json({ success: false, error: "Los precios deben ser mayores o iguales a cero" });
    }
    const criticidad = typeof req.body.criticidad === "string" ? req.body.criticidad.trim() : "Media";
    if (!["Baja", "Media", "Alta"].includes(criticidad)) {
      return res.status(400).json({ success: false, error: "La criticidad no es válida" });
    }

    const row = await withFirematTransaction(async (client) => {
      const categoria = await client.query(`SELECT id FROM "Categoria" WHERE id = $1`, [categoriaId]);
      if (categoria.rowCount !== 1) throw new Error("CATEGORY_NOT_FOUND");
      const created = await client.query<{ id: number }>(
        `INSERT INTO "Producto"
          (nombre, sku, descripcion, "categoriaId", precio, stock, "stockInicial", entradas, "fechaUltimaEntrada",
           "minStock", ubicacion, criticidad, activo, disponibilidad, formato, "cantidadCaja",
           "precioUsd", "precioSugerido", "stockReservado", "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$6,$6,CASE WHEN $6 > 0 THEN NOW() ELSE NULL END,$7,$8,$9,$10,$11,$12,$13,$14,$15,0,NOW())
         RETURNING id`,
        [
          nombre,
          sku,
          typeof req.body.descripcion === "string" ? req.body.descripcion.trim() || null : null,
          categoriaId,
          precio,
          stockInicial,
          stockMinimo,
          typeof req.body.ubicacion === "string" ? req.body.ubicacion.trim() || null : null,
          criticidad,
          req.body.activo !== false,
          typeof req.body.disponibilidad === "string" ? req.body.disponibilidad.trim() || null : null,
          typeof req.body.formato === "string" ? req.body.formato.trim() || null : null,
          typeof req.body.cantidadCaja === "string" ? req.body.cantidadCaja.trim() || null : null,
          precioUsd,
          precioSugerido,
        ],
      );
      const id = created.rows[0].id;
      if (stockInicial > 0) {
        await client.query(
          `INSERT INTO "Movimiento" (tipo, cantidad, "stockAnterior", "stockNuevo", motivo, "productoId", "createdAt")
           VALUES ('ENTRADA_INICIAL',$1,0,$1,'Creación de producto desde app móvil',$2,NOW())`,
          [stockInicial, id],
        );
      }
      const product = await client.query<ProductoRow>(`${PRODUCT_SELECT} WHERE p.id = $1`, [id]);
      return product.rows[0];
    });
    return res.status(201).json({ success: true, data: toProductoDto(row) });
  } catch (error: any) {
    if (error?.code === "23505") return res.status(409).json({ success: false, error: "El SKU ya está en uso" });
    if (error instanceof Error && error.message === "CATEGORY_NOT_FOUND") {
      return res.status(400).json({ success: false, error: "La categoría no existe" });
    }
    return firematError(res, error, "No se pudo crear el producto Firemat");
  }
}

export async function updateProductoFiremat(req: Request, res: Response) {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: "ID inválido" });
    if ("stock" in (req.body || {}) || "stockActual" in (req.body || {})) {
      return res.status(400).json({
        success: false,
        error: "El stock sólo puede modificarse desde el módulo Inventario",
      });
    }
    const allowed = new Map<string, string>([
      ["nombre", "nombre"], ["sku", "sku"], ["descripcion", "descripcion"],
      ["categoriaId", "categoriaId"], ["precio", "precio"], ["stockMinimo", "minStock"],
      ["ubicacion", "ubicacion"], ["criticidad", "criticidad"], ["activo", "activo"],
      ["disponibilidad", "disponibilidad"], ["formato", "formato"],
      ["cantidadCaja", "cantidadCaja"], ["precioUsd", "precioUsd"],
      ["precioSugerido", "precioSugerido"],
    ]);
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [input, column] of allowed) {
      if (req.body?.[input] === undefined) continue;
      let value = req.body[input];
      if (input === "nombre" || input === "sku") {
        if (typeof value !== "string" || !value.trim()) {
          return res.status(400).json({ success: false, error: `${input} es obligatorio` });
        }
      }
      if (input === "categoriaId") {
        value = parsePositiveId(value);
        if (value === null) return res.status(400).json({ success: false, error: "La categoría no es válida" });
      }
      if (input === "stockMinimo") {
        value = parseNonNegativeInteger(value);
        if (value === null) return res.status(400).json({ success: false, error: "El stock mínimo no es válido" });
      }
      if (["precio", "precioUsd", "precioSugerido"].includes(input)) {
        value = value === null ? null : Number(value);
        if (value !== null && (!Number.isFinite(value) || Number(value) < 0)) {
          return res.status(400).json({ success: false, error: `${input} no es válido` });
        }
      }
      if (input === "criticidad" && !["Baja", "Media", "Alta"].includes(String(value))) {
        return res.status(400).json({ success: false, error: "La criticidad no es válida" });
      }
      if (input === "activo" && typeof value !== "boolean") {
        return res.status(400).json({ success: false, error: "El estado activo no es válido" });
      }
      if (typeof value === "string") value = value.trim() || null;
      values.push(value);
      assignments.push(`"${column}" = $${values.length}`);
    }
    if (!assignments.length) return res.status(400).json({ success: false, error: "No hay cambios para guardar" });
    values.push(id);
    const updated = await getFirematPool().query(
      `UPDATE "Producto" SET ${assignments.join(", ")} WHERE id = $${values.length} RETURNING id`,
      values,
    );
    if (updated.rowCount !== 1) return res.status(404).json({ success: false, error: "Producto no encontrado" });
    const product = await getFirematPool().query<ProductoRow>(`${PRODUCT_SELECT} WHERE p.id = $1`, [id]);
    return res.json({ success: true, data: toProductoDto(product.rows[0]) });
  } catch (error: any) {
    if (error?.code === "23505") return res.status(409).json({ success: false, error: "El SKU ya está en uso" });
    return firematError(res, error, "No se pudo actualizar el producto Firemat");
  }
}

export async function getInventarioFiremat(req: Request, res: Response) {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const values: unknown[] = [];
    let where = "";
    if (query) {
      values.push(`%${query}%`);
      where = ` WHERE (p.nombre ILIKE $1 OR p.sku ILIKE $1 OR p.descripcion ILIKE $1)`;
    }
    const result = await getFirematPool().query<ProductoRow>(
      `${PRODUCT_SELECT}${where} ORDER BY p.nombre ASC`,
      values,
    );
    let data = result.rows.map(toProductoDto);
    if (req.query.bajoStock === "true") data = data.filter((item) => item.alertaStockBajo);
    data.sort((a, b) => Number(b.alertaStockBajo) - Number(a.alertaStockBajo) || a.nombre.localeCompare(b.nombre));
    return res.json({
      success: true,
      data,
      resumen: {
        totalProductos: data.length,
        productosActivos: data.filter((item) => item.activo).length,
        productosInactivos: data.filter((item) => !item.activo).length,
        productosSinStock: data.filter((item) => item.estadoStock === "SIN_STOCK").length,
        productosBajoStock: data.filter((item) => item.estadoStock === "BAJO_STOCK").length,
        stockTotal: data.reduce((sum, item) => sum + item.stock, 0),
        stockReservadoTotal: data.reduce((sum, item) => sum + item.stockReservado, 0),
        stockDisponibleTotal: data.reduce((sum, item) => sum + item.stockDisponible, 0),
      },
    });
  } catch (error) {
    return firematError(res, error, "No se pudo obtener el inventario Firemat");
  }
}

export async function updateInventarioFiremat(req: Request, res: Response) {
  try {
    const productoId = parsePositiveId(req.params.productoId);
    const stockNuevo = parseNonNegativeInteger(req.body?.stockNuevo);
    if (!productoId || stockNuevo === null) {
      return res.status(400).json({ success: false, error: "Producto y stock nuevo deben ser válidos" });
    }
    const result = await withFirematTransaction(async (client) => {
      const current = await client.query<{ stock: number }>(
        `SELECT stock FROM "Producto" WHERE id = $1 FOR UPDATE`,
        [productoId],
      );
      if (current.rowCount !== 1) return null;
      const stockAnterior = current.rows[0].stock;
      await client.query(
        `UPDATE "Producto" SET stock = $1, ubicacion = COALESCE($2, ubicacion), activo = COALESCE($3, activo) WHERE id = $4`,
        [
          stockNuevo,
          typeof req.body.ubicacion === "string" ? req.body.ubicacion.trim() || null : null,
          typeof req.body.activo === "boolean" ? req.body.activo : null,
          productoId,
        ],
      );
      await client.query(
        `INSERT INTO "Movimiento" (tipo, cantidad, "stockAnterior", "stockNuevo", motivo, "productoId", "createdAt")
         VALUES ('AJUSTE_MANUAL',$1,$2,$3,$4,$5,NOW())`,
        [
          Math.abs(stockNuevo - stockAnterior),
          stockAnterior,
          stockNuevo,
          typeof req.body.motivo === "string" ? req.body.motivo.trim() || "Ajuste desde app móvil" : "Ajuste desde app móvil",
          productoId,
        ],
      );
      const product = await client.query<ProductoRow>(`${PRODUCT_SELECT} WHERE p.id = $1`, [productoId]);
      return product.rows[0];
    });
    if (!result) return res.status(404).json({ success: false, error: "Producto no encontrado" });
    return res.json({ success: true, data: toProductoDto(result) });
  } catch (error) {
    return firematError(res, error, "No se pudo actualizar el inventario Firemat");
  }
}
