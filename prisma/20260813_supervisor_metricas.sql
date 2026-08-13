ALTER TABLE "registros_terreno"
  ADD COLUMN IF NOT EXISTS "enviado_ingenieria_at" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "enviado_ingenieria_por_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'registros_terreno_enviado_ingenieria_por_id_fkey'
  ) THEN
    ALTER TABLE "registros_terreno"
      ADD CONSTRAINT "registros_terreno_enviado_ingenieria_por_id_fkey"
      FOREIGN KEY ("enviado_ingenieria_por_id")
      REFERENCES "usuarios"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "registros_terreno_enviado_ingenieria_por_id_idx"
  ON "registros_terreno"("enviado_ingenieria_por_id");

CREATE INDEX IF NOT EXISTS "registros_terreno_enviado_ingenieria_at_idx"
  ON "registros_terreno"("enviado_ingenieria_at");
