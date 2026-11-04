-- Ejecutar en Supabase SQL Editor después de revisar duplicados.
-- Las llamadas RPC realizan cada operación dentro de una transacción PostgreSQL.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.contactos
        WHERE length(regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g')) >= 9
        GROUP BY regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g')
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Hay teléfonos duplicados normalizados en contactos. Resuélvelos antes de ejecutar esta migración.';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS contactos_telefono_normalizado_uidx
ON public.contactos (
    regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g')
)
WHERE length(regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g')) >= 9;

CREATE INDEX IF NOT EXISTS fichas_jugadores_activo_contacto_idx
ON public.fichas_jugadores (activo, contacto_id);

CREATE INDEX IF NOT EXISTS disponibilidades_jugador_estado_idx
ON public.disponibilidades (jugador_id, estado);

-- La importación de candidatos admite conocer el día sin conocer aún las horas.
ALTER TABLE public.disponibilidades ALTER COLUMN hora_inicio DROP NOT NULL;
ALTER TABLE public.disponibilidades ALTER COLUMN hora_fin DROP NOT NULL;

-- El cliente web nunca debe consultar directamente estas tablas. La API usa
-- exclusivamente la clave service_role desde el servidor.
ALTER TABLE public.contactos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fichas_jugadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disponibilidades ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.contactos, public.fichas_jugadores, public.disponibilidades
FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.contactos, public.fichas_jugadores, public.disponibilidades
TO service_role;

CREATE OR REPLACE FUNCTION public.club_crear_jugador(p_jugador jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_contacto_id public.contactos.id%TYPE;
    v_jugador_id public.fichas_jugadores.id%TYPE;
    v_disponibilidad jsonb;
BEGIN
    INSERT INTO public.contactos
        (nombre, telefono, correo_electronico, estado, observaciones)
    VALUES
        (p_jugador->>'nombre', p_jugador->>'telefono',
         nullif(p_jugador->>'correo_electronico', ''), 'jugador',
         nullif(p_jugador->>'observaciones', ''))
    RETURNING id INTO v_contacto_id;

    INSERT INTO public.fichas_jugadores
        (contacto_id, nivel, estado_nivel, lado_preferido, busca_partidas, observaciones, activo)
    VALUES
        (v_contacto_id, nullif(p_jugador->>'nivel', '')::numeric,
         CASE WHEN nullif(p_jugador->>'nivel', '') IS NULL THEN 'pendiente' ELSE 'declarado' END,
         coalesce(p_jugador->>'lado_preferido', 'indiferente'),
         coalesce((p_jugador->>'busca_partidas')::boolean, true),
         nullif(p_jugador->>'observaciones', ''), true)
    RETURNING id INTO v_jugador_id;

    FOR v_disponibilidad IN
        SELECT value FROM jsonb_array_elements(coalesce(p_jugador->'disponibilidades', '[]'::jsonb))
    LOOP
        INSERT INTO public.disponibilidades
            (jugador_id, dia_semana, hora_inicio, hora_fin, tipo,
             fecha_especifica, estado, modalidad_horario)
        VALUES
            (v_jugador_id, (v_disponibilidad->>'dia_semana')::integer,
             nullif(v_disponibilidad->>'hora_inicio', '')::time,
             nullif(v_disponibilidad->>'hora_fin', '')::time,
             v_disponibilidad->>'tipo',
             nullif(v_disponibilidad->>'fecha_especifica', '')::date,
             'pendiente', coalesce(v_disponibilidad->>'modalidad_horario', 'fijo'));
    END LOOP;

    RETURN jsonb_build_object('id', v_jugador_id, 'contacto_id', v_contacto_id,
                              'nombre', p_jugador->>'nombre');
END;
$$;

CREATE OR REPLACE FUNCTION public.club_crear_jugadores(p_jugadores jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_resultado jsonb;
BEGIN
    IF jsonb_typeof(p_jugadores) <> 'array'
       OR jsonb_array_length(p_jugadores) < 1
       OR jsonb_array_length(p_jugadores) > 100 THEN
        RAISE EXCEPTION 'El lote debe contener entre 1 y 100 jugadores.' USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(jsonb_agg(public.club_crear_jugador(value)), '[]'::jsonb)
    INTO v_resultado
    FROM jsonb_array_elements(p_jugadores);

    RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.club_actualizar_jugador(p_jugador_id text, p_jugador jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_contacto_id public.contactos.id%TYPE;
    v_disponibilidad jsonb;
BEGIN
    SELECT contacto_id INTO v_contacto_id
    FROM public.fichas_jugadores
    WHERE id::text = p_jugador_id AND activo = true
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se ha encontrado el jugador' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.contactos
    SET nombre = p_jugador->>'nombre',
        telefono = p_jugador->>'telefono',
        correo_electronico = nullif(p_jugador->>'correo_electronico', ''),
        estado = 'jugador',
        observaciones = nullif(p_jugador->>'observaciones', '')
    WHERE id = v_contacto_id;

    UPDATE public.fichas_jugadores
    SET nivel = nullif(p_jugador->>'nivel', '')::numeric,
        estado_nivel = CASE WHEN nullif(p_jugador->>'nivel', '') IS NULL THEN 'pendiente' ELSE 'declarado' END,
        lado_preferido = coalesce(p_jugador->>'lado_preferido', 'indiferente'),
        busca_partidas = coalesce((p_jugador->>'busca_partidas')::boolean, true),
        observaciones = nullif(p_jugador->>'observaciones', '')
    WHERE id::text = p_jugador_id;

    DELETE FROM public.disponibilidades
    WHERE jugador_id::text = p_jugador_id AND estado <> 'no_vigente';

    FOR v_disponibilidad IN
        SELECT value FROM jsonb_array_elements(coalesce(p_jugador->'disponibilidades', '[]'::jsonb))
    LOOP
        INSERT INTO public.disponibilidades
            (jugador_id, dia_semana, hora_inicio, hora_fin, tipo,
             fecha_especifica, estado, modalidad_horario)
        VALUES
            ((SELECT id FROM public.fichas_jugadores WHERE id::text = p_jugador_id),
             (v_disponibilidad->>'dia_semana')::integer,
             nullif(v_disponibilidad->>'hora_inicio', '')::time,
             nullif(v_disponibilidad->>'hora_fin', '')::time,
             v_disponibilidad->>'tipo',
             nullif(v_disponibilidad->>'fecha_especifica', '')::date,
             'pendiente', coalesce(v_disponibilidad->>'modalidad_horario', 'fijo'));
    END LOOP;

    RETURN jsonb_build_object('id', p_jugador_id, 'contacto_id', v_contacto_id,
                              'nombre', p_jugador->>'nombre');
END;
$$;

CREATE OR REPLACE FUNCTION public.club_establecer_estado_jugador(p_jugador_id text, p_activo boolean)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_contacto_id public.contactos.id%TYPE;
BEGIN
    SELECT contacto_id INTO v_contacto_id
    FROM public.fichas_jugadores
    WHERE id::text = p_jugador_id AND activo IS DISTINCT FROM p_activo
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se ha encontrado el jugador en ese estado' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.fichas_jugadores SET activo = p_activo WHERE id::text = p_jugador_id;
    UPDATE public.contactos SET estado = CASE WHEN p_activo THEN 'jugador' ELSE 'inactivo' END
    WHERE id = v_contacto_id;

    RETURN jsonb_build_object('id', p_jugador_id,
                              CASE WHEN p_activo THEN 'reactivado' ELSE 'desactivado' END, true);
END;
$$;

REVOKE ALL ON FUNCTION public.club_crear_jugador(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.club_crear_jugadores(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.club_actualizar_jugador(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.club_establecer_estado_jugador(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_crear_jugador(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.club_crear_jugadores(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.club_actualizar_jugador(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.club_establecer_estado_jugador(text, boolean) TO service_role;
