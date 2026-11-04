-- Ejecutar en Supabase SQL Editor después de 00 y 01.
-- Estas funciones son invocables solo desde el backend con service_role.

CREATE OR REPLACE FUNCTION public.club_eliminar_jugador(p_jugador_id text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_contacto_id public.contactos.id%TYPE;
BEGIN
    SELECT contacto_id INTO v_contacto_id
    FROM public.fichas_jugadores
    WHERE id::text = p_jugador_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se ha encontrado el jugador' USING ERRCODE = 'P0002';
    END IF;

    DELETE FROM public.disponibilidades WHERE jugador_id::text = p_jugador_id;
    DELETE FROM public.fichas_jugadores WHERE id::text = p_jugador_id;
    DELETE FROM public.contactos c
    WHERE c.id = v_contacto_id
      AND NOT EXISTS (
          SELECT 1 FROM public.fichas_jugadores f WHERE f.contacto_id = c.id
      );

    RETURN jsonb_build_object('id', p_jugador_id, 'eliminado', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.club_vaciar_jugadores_prueba()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_jugador_ids text[];
    v_contacto_ids text[];
BEGIN
    SELECT coalesce(array_agg(id::text), ARRAY[]::text[]),
           coalesce(array_agg(contacto_id::text), ARRAY[]::text[])
    INTO v_jugador_ids, v_contacto_ids
    FROM public.fichas_jugadores;

    DELETE FROM public.disponibilidades
    WHERE jugador_id::text = ANY(v_jugador_ids);
    DELETE FROM public.fichas_jugadores
    WHERE id::text = ANY(v_jugador_ids);
    DELETE FROM public.contactos c
    WHERE c.id::text = ANY(v_contacto_ids)
      AND NOT EXISTS (
          SELECT 1 FROM public.fichas_jugadores f WHERE f.contacto_id = c.id
      );

    RETURN jsonb_build_object('eliminados', cardinality(v_jugador_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.club_eliminar_jugador(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.club_vaciar_jugadores_prueba() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_eliminar_jugador(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.club_vaciar_jugadores_prueba() TO service_role;
