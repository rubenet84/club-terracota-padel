-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Conserva la columna `tipo` existente (habitual/puntual) y añade la modalidad
-- del horario que utilizaba el prototipo anterior (fijo/rotativo/mañanas...).

ALTER TABLE public.disponibilidades
ADD COLUMN IF NOT EXISTS modalidad_horario TEXT NOT NULL DEFAULT 'fijo';

DO $$
BEGIN
    ALTER TABLE public.disponibilidades
    ADD CONSTRAINT disponibilidades_modalidad_horario_check
    CHECK (modalidad_horario IN ('fijo', 'rotativo', 'mananas', 'tardes', 'noches'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
