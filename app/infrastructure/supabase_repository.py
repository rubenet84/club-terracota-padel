
from typing import Any

from supabase import Client

from app.application.errors import DuplicatePhoneError, NotFoundError
from app.application.schemas import JugadorCreate


class SupabaseJugadorRepository:
    """Adaptador de persistencia. Es el único módulo que conoce Supabase."""

    def __init__(self, client: Client):
        self.client = client

    def _fetch_all(
        self,
        table: str,
        selection: str,
        *,
        filters: tuple[tuple[str, str, Any], ...] = (),
        order_by: str | None = None,
    ) -> list[dict[str, Any]]:
        """Fetch every page explicitly instead of silently stopping at 1,000 rows."""
        page_size = 1000
        offset = 0
        rows: list[dict[str, Any]] = []
        while True:
            query = self.client.table(table).select(selection)
            for operation, column, value in filters:
                query = getattr(query, operation)(column, value)
            if order_by:
                query = query.order(order_by)
            page = query.range(offset, offset + page_size - 1).execute().data or []
            rows.extend(page)
            if len(page) < page_size:
                return rows
            offset += page_size

    @staticmethod
    def _formatear_hora(hora: str) -> str:
        """Normaliza las horas de PostgreSQL a HH:MM."""
        return hora[:5] if hora else ""

    def _listar_por_estado(self, activo: bool) -> list[dict[str, Any]]:
        contactos = self._fetch_all(
            "contactos",
            "id,nombre,telefono,correo_electronico,estado,observaciones",
            order_by="nombre",
        )

        fichas = self._fetch_all(
            "fichas_jugadores",
            "id,contacto_id,nivel,activo,observaciones,lado_preferido,busca_partidas",
            filters=(("eq", "activo", activo),),
        )

        disponibilidades = self._fetch_all(
            "disponibilidades",
            "jugador_id,dia_semana,hora_inicio,hora_fin,modalidad_horario,tipo,fecha_especifica,estado",
            filters=(("neq", "estado", "no_vigente"),),
        )

        contactos_por_id = {
            contacto["id"]: contacto
            for contacto in contactos
        }

        disponibilidad_por_jugador: dict[str, list[dict]] = {}

        for disponibilidad in disponibilidades:
            disponibilidad_por_jugador.setdefault(
                disponibilidad["jugador_id"], []
            ).append(disponibilidad)

        resultado = []

        for ficha in fichas:
            contacto = contactos_por_id.get(ficha["contacto_id"])

            if not contacto:
                continue

            franjas = sorted(
                disponibilidad_por_jugador.get(ficha["id"], []),
                key=lambda x: (
                    x.get("dia_semana", 0),
                    x.get("hora_inicio", ""),
                ),
            )

            franjas_normalizadas = [
                {
                    "dia_semana": disponibilidad["dia_semana"],
                    "hora_inicio": self._formatear_hora(
                        disponibilidad["hora_inicio"]
                    ),
                    "hora_fin": self._formatear_hora(
                        disponibilidad["hora_fin"]
                    ),
                    "modalidad_horario": disponibilidad.get(
                        "modalidad_horario", "fijo"
                    ),
                    "tipo": disponibilidad.get("tipo", "habitual"),
                    "fecha_especifica": disponibilidad.get(
                        "fecha_especifica"
                    ),
                }
                for disponibilidad in franjas
                if disponibilidad.get("dia_semana") in range(1, 8)
            ]

            resultado.append({
                "id": ficha["id"],
                "contacto_id": contacto["id"],
                "nombre": contacto["nombre"],
                "telefono": contacto["telefono"],
                "correo_electronico": (
                    contacto.get("correo_electronico") or ""
                ),
                "nivel": ficha.get("nivel"),
                "disponibilidades": franjas_normalizadas,
                "observaciones": (
                    ficha.get("observaciones")
                    or contacto.get("observaciones")
                    or ""
                ),
                "lado_preferido": (
                    ficha.get("lado_preferido") or "indiferente"
                ),
                "busca_partidas": ficha.get("busca_partidas", True),
            })

        return resultado

    def listar(self) -> list[dict[str, Any]]:
        """Lista los jugadores activos."""
        return self._listar_por_estado(True)

    def listar_inactivos(self) -> list[dict[str, Any]]:
        """Lista los jugadores desactivados."""
        return self._listar_por_estado(False)

    def _rpc(self, name: str, params: dict[str, Any]):
        try:
            return self.client.rpc(name, params).execute().data
        except Exception as exc:
            error_text = " ".join(
                str(getattr(exc, field, "") or "")
                for field in ("message", "details", "hint")
            ) + " " + str(exc)
            normalized_error = error_text.lower()
            is_unique_violation = str(getattr(exc, "code", "")) == "23505"
            is_phone_constraint = any(
                marker in normalized_error
                for marker in (
                    "contactos_telefono_normalizado_uidx",
                    "uq_contactos_telefono",
                    "regexp_replace(telefono",
                )
            )
            if is_unique_violation and is_phone_constraint:
                raise DuplicatePhoneError(
                    "Ya existe un contacto con ese teléfono"
                ) from exc
            if getattr(exc, "code", None) == "P0002":
                raise NotFoundError("No se ha encontrado el jugador") from exc
            raise

    def crear(self, datos: JugadorCreate) -> dict:
        return self._rpc("club_crear_jugador", {"p_jugador": datos.model_dump(mode="json")})

    def crear_lote(self, jugadores: list[JugadorCreate]) -> list[dict]:
        payload = [jugador.model_dump(mode="json") for jugador in jugadores]
        return self._rpc("club_crear_jugadores", {"p_jugadores": payload})

    def actualizar(
        self,
        jugador_id: str,
        datos: JugadorCreate,
    ) -> dict:
        return self._rpc(
            "club_actualizar_jugador",
            {"p_jugador_id": jugador_id, "p_jugador": datos.model_dump(mode="json")},
        )

    def desactivar(self, jugador_id: str):
        return self._rpc(
            "club_establecer_estado_jugador",
            {"p_jugador_id": jugador_id, "p_activo": False},
        )

    def reactivar(self, jugador_id: str):
        """Reactiva un jugador previamente desactivado."""

        return self._rpc(
            "club_establecer_estado_jugador",
            {"p_jugador_id": jugador_id, "p_activo": True},
        )

    def eliminar(self, jugador_id: str):
        return self._rpc(
            "club_eliminar_jugador",
            {"p_jugador_id": jugador_id},
        )
