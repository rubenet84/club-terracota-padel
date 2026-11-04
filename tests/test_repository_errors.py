import pytest
from postgrest.exceptions import APIError

from app.application.errors import DuplicatePhoneError
from app.infrastructure.supabase_repository import SupabaseJugadorRepository


class RaisingRpc:
    def __init__(self, error):
        self.error = error

    def execute(self):
        raise self.error


class RaisingClient:
    def __init__(self, error):
        self.error = error

    def rpc(self, name, params):
        return RaisingRpc(self.error)


@pytest.mark.parametrize(
    "error",
    [
        APIError({
            "message": 'duplicate key value violates unique constraint "uq_contactos_telefono"',
            "code": "23505",
            "details": "Key (regexp_replace(telefono, '[^0-9]'::text))=(600123456) already exists.",
        }),
        APIError({
            "message": 'duplicate key value violates unique constraint "contactos_telefono_normalizado_uidx"',
            "code": "23505",
            "details": None,
        }),
    ],
)
def test_maps_known_phone_unique_constraints(error):
    repository = SupabaseJugadorRepository(RaisingClient(error))
    with pytest.raises(DuplicatePhoneError, match="Ya existe un contacto"):
        repository._rpc("club_crear_jugadores", {})


def test_does_not_misreport_unrelated_unique_constraint_as_phone_duplicate():
    error = APIError({
        "message": 'duplicate key value violates unique constraint "fichas_id_unique"',
        "code": "23505",
        "details": "Key (id)=(123) already exists.",
    })
    repository = SupabaseJugadorRepository(RaisingClient(error))
    with pytest.raises(APIError):
        repository._rpc("club_crear_jugadores", {})
