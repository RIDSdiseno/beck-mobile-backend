CREATE TABLE IF NOT EXISTS "ProductoCodigoBarra" (
  "id" SERIAL PRIMARY KEY,
  "codigo" VARCHAR(100) NOT NULL UNIQUE,
  "productoId" INTEGER NOT NULL REFERENCES "Producto"("id") ON DELETE CASCADE,
  "unidadesPorEscaneo" INTEGER NOT NULL CHECK ("unidadesPorEscaneo" > 0),
  "descripcion" VARCHAR(150),
  "activo" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ProductoCodigoBarra_productoId_idx"
  ON "ProductoCodigoBarra"("productoId");

CREATE TABLE IF NOT EXISTS "RecepcionEscaneo" (
  "id" VARCHAR(64) PRIMARY KEY,
  "usuarioId" VARCHAR(100) NOT NULL,
  "motivo" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "RecepcionEscaneoDetalle" (
  "id" SERIAL PRIMARY KEY,
  "recepcionId" VARCHAR(64) NOT NULL REFERENCES "RecepcionEscaneo"("id") ON DELETE CASCADE,
  "productoId" INTEGER NOT NULL REFERENCES "Producto"("id"),
  "codigo" VARCHAR(100) NOT NULL,
  "cantidadEscaneos" INTEGER NOT NULL CHECK ("cantidadEscaneos" > 0),
  "unidadesPorEscaneo" INTEGER NOT NULL CHECK ("unidadesPorEscaneo" > 0),
  "unidadesIngresadas" INTEGER NOT NULL CHECK ("unidadesIngresadas" > 0),
  "stockAnterior" INTEGER NOT NULL,
  "stockNuevo" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "RecepcionEscaneoDetalle_recepcionId_idx"
  ON "RecepcionEscaneoDetalle"("recepcionId");

CREATE INDEX IF NOT EXISTS "RecepcionEscaneoDetalle_productoId_idx"
  ON "RecepcionEscaneoDetalle"("productoId");

-- Etiquetas verificadas con las fotografías entregadas por Firemat.
UPDATE "Producto"
   SET "cantidadCaja" = '12'
 WHERE sku = '66652'
   AND COALESCE(NULLIF(BTRIM("cantidadCaja"), ''), '1') = '1';

INSERT INTO "ProductoCodigoBarra" (codigo, "productoId", "unidadesPorEscaneo", descripcion)
SELECT seed.codigo, p.id, seed.unidades, seed.descripcion
  FROM (VALUES
    ('10021449660911', '66091', 1,  'Caja de 1 unidad'),
    ('10021449666524', '66652', 12, 'Caja de 12 unidades'),
    ('10021449660157', '66015', 12, 'Caja de 12 unidades')
  ) AS seed(codigo, sku, unidades, descripcion)
  JOIN "Producto" p ON p.sku = seed.sku
ON CONFLICT (codigo) DO NOTHING;
