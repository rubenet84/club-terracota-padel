
import re

from app.application.ports import JugadorRepository
from app.application.errors import DuplicatePhoneError
from app.application.schemas import JugadorCreate, JugadorUpdate


class JugadorUseCases:
    def __init__(self, repository: JugadorRepository):
        self.repository = repository

    def listar(self):
        return self.repository.listar()

    def listar_inactivos(self):
        return self.repository.listar_inactivos()

    def crear(self, datos: JugadorCreate):
        return self.repository.crear(datos)

    def actualizar(self, jugador_id: str, datos: JugadorUpdate):
        return self.repository.actualizar(jugador_id, datos)

    def desactivar(self, jugador_id: str):
        return self.repository.desactivar(jugador_id)

    def reactivar(self, jugador_id: str):
        return self.repository.reactivar(jugador_id)

    def eliminar(self, jugador_id: str):
        return self.repository.eliminar(jugador_id)

    def crear_lote(self, jugadores: list[JugadorCreate]):
        telefonos = [re.sub(r"\D", "", jugador.telefono) for jugador in jugadores]
        if len(telefonos) != len(set(telefonos)):
            raise DuplicatePhoneError("La importación contiene teléfonos duplicados")

        return self.repository.crear_lote(jugadores)
