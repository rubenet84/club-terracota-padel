import re
from uuid import uuid4

import pytest
from starlette.testclient import TestClient

from app.application.errors import DuplicatePhoneError, NotFoundError
from app.application.use_cases import JugadorUseCases
from app.presentation.main import app, settings, use_cases


class FakeJugadorRepository:
    def __init__(self):
        self.players = {}

    def listar(self):
        return [player.copy() for player in self.players.values() if player["activo"]]

    def listar_inactivos(self):
        return [player.copy() for player in self.players.values() if not player["activo"]]

    def crear(self, datos):
        player = datos.model_dump(mode="json")
        normalized_phone = re.sub(r"\D", "", player["telefono"])
        if any(re.sub(r"\D", "", current["telefono"]) == normalized_phone for current in self.players.values()):
            raise DuplicatePhoneError("Ya existe un contacto con ese teléfono")
        player.update(id=str(uuid4()), activo=True)
        self.players[player["id"]] = player
        return player.copy()

    def crear_lote(self, jugadores):
        return [self.crear(jugador) for jugador in jugadores]

    def actualizar(self, jugador_id, datos):
        if jugador_id not in self.players or not self.players[jugador_id]["activo"]:
            raise NotFoundError("No se ha encontrado el jugador")
        player = datos.model_dump(mode="json")
        player.update(id=jugador_id, activo=True)
        self.players[jugador_id] = player
        return player.copy()

    def desactivar(self, jugador_id):
        return self._set_active(jugador_id, False)

    def reactivar(self, jugador_id):
        return self._set_active(jugador_id, True)

    def _set_active(self, jugador_id, active):
        if jugador_id not in self.players:
            raise NotFoundError("No se ha encontrado el jugador")
        self.players[jugador_id]["activo"] = active
        return {"id": jugador_id, "activo": active}

    def eliminar(self, jugador_id):
        if jugador_id not in self.players:
            raise NotFoundError("No se ha encontrado el jugador")
        del self.players[jugador_id]
        return {"id": jugador_id, "eliminado": True}


@pytest.fixture
def api_client():
    repository = FakeJugadorRepository()
    app.dependency_overrides[use_cases] = lambda: JugadorUseCases(repository)
    with TestClient(app) as client:
        login_page = client.get("/login")
        login_csrf = re.search(r'name="csrf_token" value="([^"]+)"', login_page.text).group(1)
        login = client.post(
            "/login",
            data={
                "username": settings.app_username,
                "password": settings.app_password.get_secret_value(),
                "csrf_token": login_csrf,
            },
            follow_redirects=False,
        )
        assert login.status_code == 303
        home = client.get("/")
        csrf = re.search(r'<meta name="csrf-token" content="([^"]+)"', home.text).group(1)
        client.headers.update({"X-CSRF-Token": csrf})
        yield client, repository
    app.dependency_overrides.clear()


def player_payload(name="Cliente Prueba", phone="612345678"):
    return {
        "nombre": name,
        "telefono": phone,
        "nivel": 3.5,
        "disponibilidades": [
            {"dia_semana": 1, "hora_inicio": "09:00", "hora_fin": "12:00"}
        ],
        "observaciones": "",
    }


def test_create_update_suspend_reactivate_and_delete_lifecycle(api_client):
    client, repository = api_client
    created = client.post("/api/jugadores", json=player_payload())
    assert created.status_code == 201
    player_id = created.json()["id"]
    assert len(client.get("/api/jugadores").json()) == 1

    updated = player_payload(name="Cliente Actualizado", phone="612345679")
    response = client.put(f"/api/jugadores/{player_id}", json=updated)
    assert response.status_code == 200
    assert response.json()["nombre"] == "Cliente Actualizado"

    suspended = client.delete(f"/api/jugadores/{player_id}")
    assert suspended.status_code == 200
    assert client.get("/api/jugadores").json() == []
    assert client.get("/api/jugadores/inactivos").json()[0]["id"] == player_id

    reactivated = client.post(f"/api/jugadores/{player_id}/reactivar")
    assert reactivated.status_code == 200
    assert len(client.get("/api/jugadores").json()) == 1

    deleted = client.delete(f"/api/jugadores/{player_id}/permanente")
    assert deleted.status_code == 200
    assert deleted.json()["eliminado"] is True
    assert repository.players == {}


def test_batch_creation_and_validation(api_client):
    client, _ = api_client
    response = client.post(
        "/api/jugadores/lote",
        json=[player_payload("Cliente Uno", "612345671"), player_payload("Cliente Dos", "612345672")],
    )
    assert response.status_code == 201
    assert len(response.json()) == 2
    assert len(client.get("/api/jugadores").json()) == 2

    invalid = client.post("/api/jugadores", json=player_payload(phone="123"))
    assert invalid.status_code == 422


def test_level_is_required_by_create_and_batch_endpoints(api_client):
    client, _ = api_client
    payload = player_payload()
    payload.pop("nivel")
    single = client.post("/api/jugadores", json=payload)
    batch = client.post("/api/jugadores/lote", json=[payload])
    assert single.status_code == 422
    assert batch.status_code == 422
    for response in (single, batch):
        level_error = next(error for error in response.json()["detail"] if error["loc"][-1] == "nivel")
        assert "obligatorio" in level_error["msg"].lower()


def test_batch_accepts_one_player_with_multiple_availabilities(api_client):
    client, _ = api_client
    payload = player_payload()
    payload["nivel"] = 3.25
    payload["disponibilidades"] = [
        {"dia_semana": 1, "hora_inicio": "10:00", "hora_fin": "12:00", "modalidad_horario": "fijo"},
        {"dia_semana": 3, "hora_inicio": "10:00", "hora_fin": "12:00", "modalidad_horario": "fijo"},
    ]
    response = client.post("/api/jugadores/lote", json=[payload])
    assert response.status_code == 201
    assert len(response.json()) == 1
    assert len(response.json()[0]["disponibilidades"]) == 2
    assert response.json()[0]["nivel"] == 3.25


def test_duplicate_phone_returns_conflict_instead_of_gateway_error(api_client):
    client, _ = api_client
    assert client.post("/api/jugadores", json=player_payload()).status_code == 201
    duplicate = client.post("/api/jugadores", json=player_payload(name="Otro Cliente"))
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Ya existe un contacto con ese teléfono"


def test_player_mutations_return_not_found_for_unknown_ids(api_client):
    client, _ = api_client
    assert client.put("/api/jugadores/missing", json=player_payload()).status_code == 404
    assert client.delete("/api/jugadores/missing").status_code == 404
    assert client.delete("/api/jugadores/missing/permanente").status_code == 404
    assert client.post("/api/jugadores/missing/reactivar").status_code == 404
