
import re
import unicodedata
from datetime import date
from typing import Literal, Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)


ModalidadHorario = Literal["fijo", "rotativo"]
TipoDisponibilidad = Literal["habitual", "puntual"]
PATRON_NOMBRE = re.compile(r"^[^\W\d_]+(?:[ .’'-][^\W\d_]+)*$", re.UNICODE)
PATRON_CORREO = re.compile(
    r"^(?=.{1,64}@)[A-Za-z0-9]+(?:[._+-][A-Za-z0-9]+)*@"
    r"(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+"
    r"[A-Za-z]{2,63}$"
)

DiaSemana = Literal[1, 2, 3, 4, 5, 6, 7]


class DisponibilidadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dia_semana: DiaSemana
    hora_inicio: Optional[str] = None
    hora_fin: Optional[str] = None
    modalidad_horario: ModalidadHorario = "fijo"
    tipo: TipoDisponibilidad = "habitual"
    fecha_especifica: Optional[date] = None

    @field_validator("hora_inicio", "hora_fin")
    @classmethod
    def validar_hora(cls, value: Optional[str]) -> Optional[str]:
        if value is None or value == "":
            return None
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
            raise ValueError("La hora debe tener formato HH:MM")
        return value

    @model_validator(mode="after")
    def validar_intervalo_y_fecha(self):
        if (self.hora_inicio is None) != (self.hora_fin is None):
            raise ValueError("Indica ambas horas o deja ambas vacías")

        if self.hora_inicio is not None and self.hora_inicio >= self.hora_fin:
            raise ValueError(
                "La hora de fin debe ser posterior a la de inicio"
            )

        if self.tipo == "puntual" and self.fecha_especifica is None:
            raise ValueError(
                "La disponibilidad puntual requiere una fecha específica"
            )

        if self.tipo == "habitual" and self.fecha_especifica is not None:
            raise ValueError(
                "Una disponibilidad habitual no debe tener fecha específica"
            )

        return self


class JugadorCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nombre: str = Field(min_length=2, max_length=120)
    telefono: str = Field(min_length=9, max_length=25)
    correo_electronico: Optional[EmailStr] = Field(default=None, max_length=254)
    nivel: float = Field(ge=1, le=5, strict=True)

    disponibilidades: list[DisponibilidadIn] = Field(
        default_factory=list,
        max_length=28,
    )

    observaciones: str = Field(default="", max_length=2000)

    lado_preferido: Literal[
        "derecha",
        "reves",
        "indiferente",
    ] = "indiferente"

    busca_partidas: bool = True

    @field_validator("nombre", "telefono")
    @classmethod
    def limpiar_texto(cls, value: str) -> str:
        return value.strip()

    @field_validator("nombre")
    @classmethod
    def validar_nombre_no_vacio(cls, value: str) -> str:
        value = unicodedata.normalize("NFC", " ".join(value.split()))
        if len(value) < 2:
            raise ValueError("El nombre debe tener al menos 2 caracteres")
        if not PATRON_NOMBRE.fullmatch(value):
            raise ValueError(
                "Usa solo letras, espacios, puntos, apóstrofos o guiones en el nombre"
            )
        return value

    @field_validator("correo_electronico", mode="before")
    @classmethod
    def normalizar_correo_vacio(cls, value):
        if value is None:
            return None
        value = str(value).strip()
        if not value:
            return None
        if not PATRON_CORREO.fullmatch(value):
            raise ValueError("Formato de correo electrónico no válido")
        return value

    @field_validator("telefono")
    @classmethod
    def validar_telefono(cls, value: str) -> str:
        if not re.fullmatch(r"\+?[0-9](?:[0-9().\-\s]*[0-9])", value):
            raise ValueError("Formato de teléfono no válido")

        digits = re.sub(r"\D", "", value)

        if not 9 <= len(digits) <= 15 or value.count("+") > 1:
            raise ValueError(
                "Introduce un teléfono válido de entre 9 y 15 dígitos"
            )

        if value.count("(") != value.count(")") or value.find(")") < value.find("("):
            raise ValueError("Revisa los paréntesis del teléfono")

        return value

    @field_validator("nivel")
    @classmethod
    def validar_incremento_nivel(cls, value):
        if abs(value * 4 - round(value * 4)) > 1e-6:
            raise ValueError(
                "El nivel debe avanzar en intervalos de 0,25"
            )

        return value

    @model_validator(mode="after")
    def validar_disponibilidades_sin_duplicar(self):
        claves = [
            (d.dia_semana, d.hora_inicio, d.hora_fin, d.modalidad_horario, d.tipo, d.fecha_especifica)
            for d in self.disponibilidades
        ]
        if len(claves) != len(set(claves)):
            raise ValueError("Hay disponibilidades duplicadas")
        return self


class JugadorUpdate(JugadorCreate):
    pass
