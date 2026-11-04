# Notas de implementación

- El proyecto original era un HTML autocontenido con `localStorage`; se conserva una copia en `docs/prototipo_original.html`.
- La nueva interfaz se sirve desde FastAPI y ya no lee ni escribe `localStorage`.
- Los nombres de las tablas y columnas corresponden al esquema acordado previamente.
- Antes de probar la aplicación con Supabase, ejecutar en orden `sql/00_ajuste_disponibilidades.sql`, `sql/01_hardening_transacciones.sql`, `sql/02_eliminar_jugadores.sql` y `sql/03_retirar_vaciado_masivo.sql`.
- El `.env` local contiene credenciales privadas y debe permanecer excluido del control de versiones. No incluyas valores reales en documentación, registros ni capturas.


## Formulario de jugadores (actualización)
- El formulario permite añadir varias disponibilidades independientes por jugador.
- Cada disponibilidad guarda día, hora de inicio/fin, modalidad fija/rotativa y tipo habitual/puntual.
- Las disponibilidades puntuales requieren `fecha_especifica`; las habituales la dejan a NULL.
- Se incluyen `lado_preferido` y `busca_partidas` en la ficha del jugador.
- La migración de hardening es necesaria aunque esas columnas ya existan: crea las RPC transaccionales, restringe el acceso de tablas y protege los teléfonos duplicados.
