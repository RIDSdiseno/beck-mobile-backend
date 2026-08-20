CREATE TABLE IF NOT EXISTS actividad_app (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo VARCHAR(50) NOT NULL,
  accion VARCHAR(100) NOT NULL,
  entidad_tipo VARCHAR(50),
  entidad_id UUID,
  descripcion VARCHAR(500) NOT NULL,
  metodo VARCHAR(10) NOT NULL,
  ruta VARCHAR(255) NOT NULL,
  datos JSONB,
  created_at TIMESTAMP(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS actividad_app_usuario_created_at_idx
  ON actividad_app (usuario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS actividad_app_modulo_idx
  ON actividad_app (modulo);
CREATE INDEX IF NOT EXISTS actividad_app_accion_idx
  ON actividad_app (accion);
CREATE INDEX IF NOT EXISTS actividad_app_entidad_id_idx
  ON actividad_app (entidad_id);
CREATE INDEX IF NOT EXISTS actividad_app_created_at_idx
  ON actividad_app (created_at DESC);
