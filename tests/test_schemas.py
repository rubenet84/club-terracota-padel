import unittest
from datetime import date

from pydantic import ValidationError

from app.application.schemas import DisponibilidadIn, JugadorCreate


class DisponibilidadValidationTests(unittest.TestCase):
    def test_accepts_unknown_hours_as_a_pair(self):
        value = DisponibilidadIn(dia_semana=1, hora_inicio="", hora_fin=None)
        self.assertIsNone(value.hora_inicio)
        self.assertIsNone(value.hora_fin)

    def test_rejects_only_one_hour(self):
        with self.assertRaises(ValidationError):
            DisponibilidadIn(dia_semana=1, hora_inicio="18:00", hora_fin=None)

    def test_rejects_invalid_interval(self):
        with self.assertRaises(ValidationError):
            DisponibilidadIn(dia_semana=1, hora_inicio="20:00", hora_fin="18:00")

    def test_puntual_requires_date(self):
        with self.assertRaises(ValidationError):
            DisponibilidadIn(dia_semana=1, tipo="puntual")

    def test_habitual_rejects_specific_date(self):
        with self.assertRaises(ValidationError):
            DisponibilidadIn(dia_semana=1, fecha_especifica=date(2026, 11, 3))


class JugadorValidationTests(unittest.TestCase):
    def _base(self):
        return {"nombre": "Ana García", "telefono": "+34 612 345 678", "nivel": 3.5}

    def test_normalizes_whitespace_and_accepts_no_availability(self):
        data = self._base()
        data["nombre"] = " Ana García "
        jugador = JugadorCreate(**data)
        self.assertEqual(jugador.nombre, "Ana García")
        self.assertEqual(jugador.disponibilidades, [])

    def test_rejects_blank_name_after_trimming(self):
        data = self._base()
        data["nombre"] = "   "
        with self.assertRaises(ValidationError):
            JugadorCreate(**data)

    def test_rejects_phone_with_invalid_characters(self):
        data = self._base()
        data["telefono"] = "612345678<script>"
        with self.assertRaises(ValidationError):
            JugadorCreate(**data)

    def test_accepts_international_phone_but_rejects_bad_length_and_parentheses(self):
        data = self._base()
        data["telefono"] = "+34 (612) 345-678"
        self.assertEqual(JugadorCreate(**data).telefono, data["telefono"])
        for phone in ("12345678", "1234567890123456", "+34+612345678", "612)345(678"):
            with self.subTest(phone=phone):
                invalid = self._base()
                invalid["telefono"] = phone
                with self.assertRaises(ValidationError):
                    JugadorCreate(**invalid)

    def test_accepts_empty_email_as_missing_and_rejects_malformed_email(self):
        self.assertIsNone(JugadorCreate(**self._base(), correo_electronico="  ").correo_electronico)
        for email in ("no-es-un-email", "a!b@example.com", "nombre@@example.com", "a..b@example.com", "usuario@-dominio.com"):
            with self.subTest(email=email):
                data = self._base()
                data["correo_electronico"] = email
                with self.assertRaises(ValidationError):
                    JugadorCreate(**data)

    def test_accepts_common_email_alias_and_unicode_person_name(self):
        data = self._base()
        data.update(nombre="  José   O’Connor-Smith ", correo_electronico="jose.smith+padel@example.es")
        jugador = JugadorCreate(
            **data,
        )
        self.assertEqual(jugador.nombre, "José O’Connor-Smith")

    def test_rejects_digits_and_symbols_in_person_name(self):
        for name in ("Carlos123", "Ana! García", "<script>alert(1)</script>"):
            with self.subTest(name=name):
                data = self._base()
                data["nombre"] = name
                with self.assertRaises(ValidationError):
                    JugadorCreate(**data)

    def test_rejects_level_outside_quarters(self):
        data = self._base()
        data["nivel"] = 3.2
        with self.assertRaises(ValidationError):
            JugadorCreate(**data)

    def test_level_is_required_and_must_be_a_json_number(self):
        missing_level = self._base()
        missing_level.pop("nivel")
        with self.assertRaises(ValidationError):
            JugadorCreate(**missing_level)
        string_level = self._base()
        string_level["nivel"] = "3.5"
        with self.assertRaises(ValidationError):
            JugadorCreate(**string_level)

    def test_rejects_unknown_fields(self):
        with self.assertRaises(ValidationError):
            JugadorCreate(**self._base(), is_admin=True)

    def test_rejects_duplicate_availability(self):
        availability = {"dia_semana": 1, "hora_inicio": "18:00", "hora_fin": "20:00"}
        with self.assertRaises(ValidationError):
            JugadorCreate(**self._base(), disponibilidades=[availability, availability])


if __name__ == "__main__":
    unittest.main()
