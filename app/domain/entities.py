from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class Disponibilidad:
    dia_semana: int
    hora_inicio: str
    hora_fin: str
    modalidad_horario: str = "fijo"


@dataclass(frozen=True)
class Jugador:
    nombre: str
    telefono: str
    nivel: Optional[float]
    correo_electronico: Optional[str] = None
    dias: list[Disponibilidad] = field(default_factory=list)
    observaciones: str = ""
    lado_preferido: str = "indiferente"
    busca_partidas: bool = True
