import unittest

from pydantic import SecretStr, ValidationError

from app.infrastructure.config import Settings


def valid_settings(**overrides):
    values = {
        "app_env": "development",
        "app_username": "club-owner",
        "app_password": SecretStr("a-random-password-123456"),
        "session_secret_key": SecretStr("s" * 48),
        "supabase_url": "https://example.supabase.co",
        "supabase_service_role_key": SecretStr("service-key-value"),
    }
    values.update(overrides)
    return Settings(**values)


class SettingsValidationTests(unittest.TestCase):
    def test_accepts_valid_private_configuration(self):
        self.assertEqual(valid_settings().app_username, "club-owner")

    def test_rejects_short_password(self):
        with self.assertRaises(ValidationError):
            valid_settings(app_password=SecretStr("too-short"))

    def test_rejects_example_secret(self):
        with self.assertRaises(ValidationError):
            valid_settings(app_password=SecretStr("cambia-esto-por-una-clave"))

    def test_rejects_default_user_in_production(self):
        with self.assertRaises(ValidationError):
            valid_settings(app_env="production", app_username="admin")

    def test_rejects_non_https_supabase_url(self):
        with self.assertRaises(ValidationError):
            valid_settings(supabase_url="http://example.supabase.co")


if __name__ == "__main__":
    unittest.main()
