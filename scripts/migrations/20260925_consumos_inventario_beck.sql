-- Aplicar una sola vez en la base compartida durante el despliegue coordinado.
-- No ejecutar con prisma db push. No elimina ni recalcula existencias.
ALTER TYPE "EstadoAsignacionInventario" ADD VALUE IF NOT EXISTS 'consumido';
BEGIN;
CREATE TABLE IF NOT EXISTS politicas_consumo_inventario_beck (
  tipo_item "TipoInventarioBeck" NOT NULL, item_id uuid NOT NULL,
  consumible boolean NOT NULL DEFAULT false, actualizado_por_id uuid NOT NULL,
  updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tipo_item, item_id)
);
CREATE TABLE IF NOT EXISTS consumos_inventario_beck (
  id uuid PRIMARY KEY,
  asignacion_id uuid NOT NULL REFERENCES asignaciones_inventario_beck(id) ON DELETE RESTRICT,
  trabajador_id uuid NOT NULL, jefe_obra_id uuid NOT NULL, obra_id uuid NOT NULL,
  cantidad integer NOT NULL CHECK (cantidad > 0),
  sub_skus text[] NOT NULL DEFAULT '{}',
  observacion text, estado varchar(20) NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','confirmado','rechazado')),
  solicitado_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resuelto_at timestamp(6), resuelto_por_id uuid, motivo_rechazo text,
  asignacion_consumida_id uuid,
  CHECK ((estado='pendiente') = (resuelto_at IS NULL)),
  CHECK ((resuelto_at IS NULL) = (resuelto_por_id IS NULL)),
  CHECK (estado <> 'rechazado' OR (motivo_rechazo IS NOT NULL AND length(trim(motivo_rechazo)) > 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS consumo_pendiente_por_asignacion ON consumos_inventario_beck(asignacion_id) WHERE estado='pendiente';
CREATE INDEX IF NOT EXISTS consumo_supervisor_estado_fecha ON consumos_inventario_beck(jefe_obra_id,estado,solicitado_at DESC);
CREATE INDEX IF NOT EXISTS consumo_operario_fecha ON consumos_inventario_beck(trabajador_id,solicitado_at DESC);
CREATE INDEX IF NOT EXISTS consumo_obra_fecha ON consumos_inventario_beck(obra_id,solicitado_at DESC);
-- Defensa adicional para clientes antiguos: nunca liberar una asignación consumida
-- ni devolver/reasignar un lote mientras su consumo espera resolución.
CREATE OR REPLACE FUNCTION proteger_consumo_inventario_beck() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado::text = 'consumido' THEN
    RAISE EXCEPTION 'La asignación está consumida y no puede modificarse';
  END IF;
  IF EXISTS (SELECT 1 FROM consumos_inventario_beck c WHERE c.asignacion_id=OLD.id AND c.estado='pendiente') THEN
    RAISE EXCEPTION 'Hay un consumo pendiente: el supervisor debe resolverlo antes de devolver o modificar el lote';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS proteger_consumo_inventario ON asignaciones_inventario_beck;
CREATE TRIGGER proteger_consumo_inventario BEFORE UPDATE OR DELETE ON asignaciones_inventario_beck
  FOR EACH ROW EXECUTE FUNCTION proteger_consumo_inventario_beck();
COMMIT;
