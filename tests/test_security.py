import re
import unittest

from starlette.testclient import TestClient

from app.presentation.main import LoginAttemptLimiter, app, login_limiter, settings


class SecurityTests(unittest.TestCase):
    def test_login_page_has_csrf_and_security_headers(self):
        with TestClient(app) as client:
            response = client.get("/login")
            css = client.get("/static/app.css")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(css.status_code, 200)
        self.assertRegex(response.text, r'name="csrf_token" value="[A-Za-z0-9_-]+"')
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(response.headers["x-frame-options"], "DENY")
        self.assertIn("frame-ancestors 'none'", response.headers["content-security-policy"])
        self.assertNotIn("unsafe-inline", response.headers["content-security-policy"])
        self.assertNotIn("unsafe-eval", response.headers["content-security-policy"])

    def test_api_requires_authentication_and_csrf(self):
        with TestClient(app) as client:
            unauthenticated = client.get("/api/jugadores")
            self.assertEqual(unauthenticated.status_code, 401)

            page = client.get("/login")
            csrf = re.search(r'name="csrf_token" value="([^"]+)"', page.text).group(1)
            login = client.post(
                "/login",
                data={
                    "username": settings.app_username,
                    "password": settings.app_password.get_secret_value(),
                    "csrf_token": csrf,
                },
                follow_redirects=False,
            )
            self.assertEqual(login.status_code, 303)
            self.assertIn("httponly", login.headers["set-cookie"].lower())
            self.assertIn("samesite=strict", login.headers["set-cookie"].lower())

            authenticated_page = client.get("/")
            token = re.search(r'<meta name="csrf-token" content="([^"]+)"', authenticated_page.text).group(1)
            self.assertIn('<script src="/static/app.js?v=20261103-10" defer></script>', authenticated_page.text)
            self.assertIn('<script src="/static/filter_rules.js?v=20261103-1" defer></script>', authenticated_page.text)
            self.assertIn('<script src="/static/whatsapp_parser.js?v=20261103-2" defer></script>', authenticated_page.text)
            self.assertIn('<script src="/static/csv_tools.js?v=20261103-1" defer></script>', authenticated_page.text)
            self.assertRegex(authenticated_page.text, r'<select id="fNivel" required\b')
            self.assertIn("Selecciona un nivel", client.get("/static/app.js").text)
            self.assertNotRegex(authenticated_page.text, r"<script(?![^>]*\bsrc=)[^>]*>")
            self.assertNotRegex(authenticated_page.text, r"\son(click|input|change|submit)=")
            self.assertNotIn("Vaciar datos de prueba", authenticated_page.text)
            self.assertEqual(client.get("/static/app.js").status_code, 200)
            self.assertEqual(client.get("/static/filter_rules.js?v=20261103-1").status_code, 200)
            self.assertEqual(client.get("/static/whatsapp_parser.js?v=20261103-2").status_code, 200)
            self.assertEqual(client.get("/static/csv_tools.js?v=20261103-1").status_code, 200)
            blocked = client.post("/api/jugadores", json={}, follow_redirects=False)
            self.assertEqual(blocked.status_code, 403)
            allowed_to_validation = client.post(
                "/api/jugadores",
                json={},
                headers={"X-CSRF-Token": token},
            )
            self.assertEqual(allowed_to_validation.status_code, 422)

    def test_bulk_delete_endpoint_is_not_exposed(self):
        with TestClient(app) as client:
            self.assertEqual(client.delete("/api/jugadores/demo/permanente").status_code, 401)
            page = client.get("/login")
            csrf = re.search(r'name="csrf_token" value="([^\"]+)"', page.text).group(1)
            client.post(
                "/login",
                data={
                    "username": settings.app_username,
                    "password": settings.app_password.get_secret_value(),
                    "csrf_token": csrf,
                },
                follow_redirects=False,
            )
            home = client.get("/")
            token = re.search(r'<meta name="csrf-token" content="([^\"]+)"', home.text).group(1)
            headers = {"X-CSRF-Token": token}
            self.assertEqual(client.delete("/api/jugadores/demo/permanente").status_code, 403)
            response = client.request("DELETE", "/api/jugadores", headers=headers)
            self.assertEqual(response.status_code, 405)
            self.assertNotIn("DELETE", response.headers.get("allow", ""))

    def test_login_limiter_blocks_after_five_failures_and_resets(self):
        limiter = LoginAttemptLimiter(limit=5, window_seconds=900)
        for _ in range(5):
            limiter.record_failure("192.0.2.10")
        self.assertGreater(limiter.remaining_lock_seconds("192.0.2.10"), 0)
        limiter.clear("192.0.2.10")
        self.assertEqual(limiter.remaining_lock_seconds("192.0.2.10"), 0)

    def test_login_endpoint_throttles_bad_passwords(self):
        with TestClient(app) as client:
            page = client.get("/login")
            csrf = re.search(r'name="csrf_token" value="([^"]+)"', page.text).group(1)
            form = {"username": settings.app_username, "password": "incorrecta-y-larga-123", "csrf_token": csrf}
            for _ in range(5):
                self.assertEqual(client.post("/login", data=form).status_code, 401)
            blocked = client.post("/login", data=form)
            self.assertEqual(blocked.status_code, 429)
            self.assertIn("retry-after", blocked.headers)
        login_limiter.clear("testclient")

    def test_validation_response_does_not_echo_submitted_personal_data(self):
        secret_value = "dato-personal-no-debe-aparecer"
        with TestClient(app) as client:
            page = client.get("/login")
            csrf = re.search(r'name="csrf_token" value="([^"]+)"', page.text).group(1)
            client.post(
                "/login",
                data={"username": settings.app_username, "password": settings.app_password.get_secret_value(), "csrf_token": csrf},
                follow_redirects=False,
            )
            home = client.get("/")
            token = re.search(r'<meta name="csrf-token" content="([^"]+)"', home.text).group(1)
            response = client.post(
                "/api/jugadores",
                json={"nombre": secret_value},
                headers={"X-CSRF-Token": token},
            )
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(secret_value, response.text)

    def test_invalid_phone_and_email_return_clear_field_errors(self):
        with TestClient(app) as client:
            page = client.get("/login")
            csrf = re.search(r'name="csrf_token" value="([^"]+)"', page.text).group(1)
            client.post(
                "/login",
                data={"username": settings.app_username, "password": settings.app_password.get_secret_value(), "csrf_token": csrf},
                follow_redirects=False,
            )
            home = client.get("/")
            token = re.search(r'<meta name="csrf-token" content="([^"]+)"', home.text).group(1)
            response = client.post(
                "/api/jugadores",
                json={"nombre": "Cliente de prueba", "telefono": "telefono-invalido", "correo_electronico": "correo-invalido", "nivel": 3.0},
                headers={"X-CSRF-Token": token},
            )
        self.assertEqual(response.status_code, 422)
        errors = response.json()["detail"]
        self.assertEqual({error["loc"][-1] for error in errors}, {"telefono", "correo_electronico"})
        self.assertIn("Formato de teléfono no válido", next(error["msg"] for error in errors if error["loc"][-1] == "telefono"))
        self.assertIn("Formato de correo electrónico no válido", next(error["msg"] for error in errors if error["loc"][-1] == "correo_electronico"))
        self.assertNotIn("telefono-invalido", response.text)
        self.assertNotIn("correo-invalido", response.text)

    def test_player_name_with_numbers_is_rejected_with_safe_message(self):
        with TestClient(app) as client:
            page = client.get("/login")
            csrf = re.search(r'name="csrf_token" value="([^"]+)"', page.text).group(1)
            client.post(
                "/login",
                data={"username": settings.app_username, "password": settings.app_password.get_secret_value(), "csrf_token": csrf},
                follow_redirects=False,
            )
            home = client.get("/")
            token = re.search(r'<meta name="csrf-token" content="([^"]+)"', home.text).group(1)
            response = client.post(
                "/api/jugadores",
                json={"nombre": "Cliente123", "telefono": "612345678", "nivel": 3.0},
                headers={"X-CSRF-Token": token},
            )
        self.assertEqual(response.status_code, 422)
        detail = response.json()["detail"]
        name_error = next(error for error in detail if error["loc"][-1] == "nombre")
        self.assertIn("solo puede contener letras", name_error["msg"])
        self.assertNotIn("Cliente123", response.text)

    def test_batch_size_is_bounded(self):
        with TestClient(app) as client:
            page = client.get("/login")
            csrf = re.search(r'name="csrf_token" value="([^"]+)"', page.text).group(1)
            client.post(
                "/login",
                data={"username": settings.app_username, "password": settings.app_password.get_secret_value(), "csrf_token": csrf},
                follow_redirects=False,
            )
            home = client.get("/")
            token = re.search(r'<meta name="csrf-token" content="([^"]+)"', home.text).group(1)
            response = client.post(
                "/api/jugadores/lote",
                json=[{}] * 101,
                headers={"X-CSRF-Token": token},
            )
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("input", response.text)

    def test_oversized_request_is_rejected(self):
        with TestClient(app) as client:
            response = client.post("/login", content=b"x" * (2 * 1024 * 1024 + 1))
        self.assertEqual(response.status_code, 413)


if __name__ == "__main__":
    unittest.main()
