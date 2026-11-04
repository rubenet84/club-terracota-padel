from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Club Terracota Padel"
    app_env: Literal["development", "production"] = "development"
    app_username: str = Field(min_length=3, max_length=80)
    app_password: SecretStr = Field(min_length=16, max_length=256)
    session_secret_key: SecretStr = Field(min_length=32)
    supabase_url: str
    supabase_service_role_key: SecretStr

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        hide_input_in_errors=True,
    )

    @field_validator("app_username")
    @classmethod
    def reject_placeholder_username(cls, value: str) -> str:
        normalized = value.strip().lower()
        if any(marker in normalized for marker in ("cambia-esto", "reemplazar", "tu-service", "change-me")):
            raise ValueError("APP_USERNAME de ejemplo debe reemplazarse")
        return value

    @field_validator("app_password", "session_secret_key", "supabase_service_role_key")
    @classmethod
    def reject_placeholder_secrets(cls, value: SecretStr) -> SecretStr:
        normalized = value.get_secret_value().strip().lower()
        if any(marker in normalized for marker in ("cambia-esto", "reemplazar", "tu-service", "tu_service", "change-me")):
            raise ValueError("Las credenciales de ejemplo deben reemplazarse")
        return value

    @field_validator("supabase_url")
    @classmethod
    def validate_supabase_url(cls, value: str) -> str:
        if (
            not value.startswith("https://")
            or ".supabase.co" not in value
            or "tu-proyecto" in value.lower()
        ):
            raise ValueError("SUPABASE_URL debe ser la URL HTTPS de Supabase")
        return value.rstrip("/")

    @model_validator(mode="after")
    def validate_production_settings(self):
        if self.app_env == "production" and self.app_username.lower() in {"admin", "administrator", "user"}:
            raise ValueError("Configura un usuario de producción no predeterminado")
        if self.app_password.get_secret_value() == self.app_username:
            raise ValueError("APP_PASSWORD no puede coincidir con APP_USERNAME")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
