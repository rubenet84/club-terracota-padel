
import hmac
import logging
import secrets
import threading
import time
from collections import OrderedDict
from pathlib import Path

from fastapi import FastAPI, Request, Form, Depends, HTTPException, Body
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from starlette.responses import Response
from starlette.middleware.sessions import SessionMiddleware
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles

from app.infrastructure.config import get_settings
from app.infrastructure.supabase_client import get_supabase
from app.infrastructure.supabase_repository import (
    SupabaseJugadorRepository,
)
from app.application.errors import DuplicatePhoneError, NotFoundError
from app.application.use_cases import JugadorUseCases
from app.application.schemas import JugadorCreate, JugadorUpdate


logger = logging.getLogger(__name__)
MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_BATCH_SIZE = 100
CSRF_HEADER = "x-csrf-token"


class LoginAttemptLimiter:
    """Limitador local acotado para frenar fuerza bruta en una instancia."""

    def __init__(self, limit: int = 5, window_seconds: int = 900, max_clients: int = 10_000):
        self.limit = limit
        self.window_seconds = window_seconds
        self.max_clients = max_clients
        self._attempts: OrderedDict[str, tuple[float, int]] = OrderedDict()
        self._lock = threading.Lock()

    def remaining_lock_seconds(self, client: str) -> int:
        now = time.monotonic()
        with self._lock:
            attempt = self._attempts.get(client)
            if not attempt:
                return 0
            started, count = attempt
            if now - started >= self.window_seconds:
                self._attempts.pop(client, None)
                return 0
            self._attempts.move_to_end(client)
            return max(0, int(self.window_seconds - (now - started))) if count >= self.limit else 0

    def record_failure(self, client: str) -> None:
        now = time.monotonic()
        with self._lock:
            started, count = self._attempts.get(client, (now, 0))
            if now - started >= self.window_seconds:
                started, count = now, 0
            self._attempts[client] = (started, count + 1)
            self._attempts.move_to_end(client)
            while len(self._attempts) > self.max_clients:
                self._attempts.popitem(last=False)

    def clear(self, client: str) -> None:
        with self._lock:
            self._attempts.pop(client, None)


login_limiter = LoginAttemptLimiter()


class RequestSizeLimitMiddleware:
    """Caps request bodies even when clients omit Content-Length."""

    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        body_parts = []
        total = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            part = message.get("body", b"")
            total += len(part)
            if total > self.max_bytes:
                response = Response(
                    content='{"detail":"Solicitud demasiado grande"}',
                    status_code=413,
                    media_type="application/json",
                    headers={
                        "Cache-Control": "no-store",
                        "X-Content-Type-Options": "nosniff",
                        "X-Frame-Options": "DENY",
                    },
                )

                async def disconnected():
                    return {"type": "http.disconnect"}

                await response(scope, disconnected, send)
                return
            body_parts.append(part)
            if not message.get("more_body", False):
                break

        body = b"".join(body_parts)
        replayed = False

        async def replay_body():
            nonlocal replayed
            if replayed:
                return await receive()
            replayed = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay_body, send)

BASE_DIR = Path(__file__).resolve().parents[2]
settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    docs_url=None,
    redoc_url=None,
)

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount(
    "/static",
    StaticFiles(directory=str(BASE_DIR / "app" / "static")),
    name="static",
)


def use_cases() -> JugadorUseCases:
    return JugadorUseCases(
        SupabaseJugadorRepository(get_supabase())
    )


# --------------------------------------------------
# AUTENTICACIÓN
# --------------------------------------------------

@app.middleware("http")
async def proteger_aplicacion(request: Request, call_next):
    path = request.url.path
    response = None

    public_paths = {"/login", "/health"}
    is_public_path = path in public_paths or path.startswith("/static/")

    if response is None and not is_public_path and not request.session.get("authenticated"):
        if path.startswith("/api/"):
            response = JSONResponse({"detail": "No autenticado"}, status_code=401)
        else:
            response = RedirectResponse(url="/login", status_code=303)

    unsafe_method = request.method in {"POST", "PUT", "PATCH", "DELETE"}
    if response is None and unsafe_method and path not in {"/login", "/logout"}:
        expected = request.session.get("csrf_token", "")
        supplied = request.headers.get(CSRF_HEADER, "")
        if not expected or not supplied or not hmac.compare_digest(expected, supplied):
            response = JSONResponse({"detail": "Token CSRF inválido"}, status_code=403)

    if response is None:
        response = await call_next(request)

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cache-Control"] = (
        "public, max-age=3600" if path.startswith("/static/") else "no-store"
    )
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
        "form-action 'self'; connect-src 'self'; img-src 'self' data:; "
        "font-src 'self'; style-src 'self'; script-src 'self'"
    )
    if settings.app_env == "production":
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"

    return response


# SessionMiddleware debe quedar por fuera del middleware anterior.
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret_key,
    session_cookie="__Host-session" if settings.app_env == "production" else "club-session",
    same_site="strict",
    https_only=settings.app_env == "production",
    path="/",
    max_age=60 * 60 * 8,
)
app.add_middleware(RequestSizeLimitMiddleware, max_bytes=MAX_REQUEST_BYTES)


# --------------------------------------------------
# RUTAS PÚBLICAS
# --------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "app": settings.app_name,
    }


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    # Never echo submitted PII, passwords, or provider internals in validation responses.
    errors = []
    for error in exc.errors():
        location = [str(part) for part in error.get("loc", ())]
        field = location[-1] if location else ""
        error_type = error.get("type", "value_error")
        raw_message = str(error.get("msg", ""))
        message = raw_message.removeprefix("Value error, ")

        if field == "nombre":
            if error_type == "string_too_short" or "al menos 2 caracteres" in raw_message:
                message = "El nombre debe tener al menos 2 caracteres."
            elif error_type == "string_too_long":
                message = "El nombre no puede superar los 120 caracteres."
            else:
                message = "El nombre solo puede contener letras, espacios, puntos, apóstrofos o guiones."
        elif field == "telefono":
            message = "Formato de teléfono no válido. Usa entre 9 y 15 dígitos y, si quieres, un + inicial, espacios, paréntesis, puntos o guiones."
        elif field == "correo_electronico":
            message = "Formato de correo electrónico no válido."
        elif field == "nivel":
            if error_type == "missing":
                message = "El nivel del club es obligatorio. Selecciona un nivel."
            elif error_type in {"float_parsing", "int_parsing", "float_type", "int_type"}:
                message = "El nivel debe ser un número válido, por ejemplo 3,25."
            elif error_type in {"greater_than_equal", "less_than_equal"}:
                message = "El nivel debe estar entre 1,00 y 5,00."
            else:
                message = "El nivel debe avanzar en intervalos de 0,25."
        elif field in {"hora_inicio", "hora_fin"} and error_type == "string_pattern_mismatch":
            message = "Usa el formato de hora HH:MM, por ejemplo 09:30."
        elif field == "dia_semana":
            message = "Selecciona un día de la semana válido."
        elif field == "fecha_especifica":
            message = "Selecciona una fecha válida para la disponibilidad puntual."
        elif field == "observaciones":
            message = "Las observaciones no pueden superar los 2.000 caracteres."
        elif field == "disponibilidades":
            message = "Revisa las disponibilidades. Debe haber como máximo 28 y no puede haber filas duplicadas."
        elif not message:
            message = "Revisa el formato de los datos introducidos."

        errors.append({
            "loc": location,
            "msg": message,
            "type": error_type,
        })
    return JSONResponse({"detail": errors}, status_code=422)


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    if request.session.get("authenticated"):
        return RedirectResponse("/", status_code=303)

    csrf_token = request.session.setdefault("csrf_token", secrets.token_urlsafe(32))
    return templates.TemplateResponse(
        request,
        "login.html",
        {
            "error": None,
            "app_name": settings.app_name,
            "csrf_token": csrf_token,
        },
    )


@app.post("/login", response_class=HTMLResponse)
async def login(request: Request):
    form = await request.form()
    username = str(form.get("username", ""))
    password = str(form.get("password", ""))
    csrf_token = str(form.get("csrf_token", ""))
    expected_csrf = request.session.get("csrf_token", "")
    if not expected_csrf or not hmac.compare_digest(expected_csrf, csrf_token):
        raise HTTPException(status_code=403, detail="Token CSRF inválido")

    client_ip = request.client.host if request.client else "unknown"
    retry_after = login_limiter.remaining_lock_seconds(client_ip)
    if retry_after:
        raise HTTPException(
            status_code=429,
            detail="Demasiados intentos. Inténtalo más tarde.",
            headers={"Retry-After": str(retry_after)},
        )

    if len(username) > 80 or len(password) > 256:
        login_limiter.record_failure(client_ip)
        return templates.TemplateResponse(
            request,
            "login.html",
            {"error": "Usuario o contraseña incorrectos", "app_name": settings.app_name, "csrf_token": csrf_token},
            status_code=401,
        )

    valid_user = hmac.compare_digest(
        username,
        settings.app_username,
    )

    valid_password = hmac.compare_digest(
        password,
        settings.app_password.get_secret_value(),
    )

    if not (valid_user and valid_password):
        login_limiter.record_failure(client_ip)
        logger.warning("Intento de acceso fallido")
        return templates.TemplateResponse(
            request,
            "login.html",
            {
                "error": "Usuario o contraseña incorrectos",
                "app_name": settings.app_name,
                "csrf_token": csrf_token,
            },
            status_code=401,
        )

    login_limiter.clear(client_ip)
    logger.info("Inicio de sesión correcto")
    request.session.clear()
    request.session["authenticated"] = True
    request.session["csrf_token"] = secrets.token_urlsafe(32)

    return RedirectResponse("/", status_code=303)


@app.post("/logout")
def logout(request: Request, csrf_token: str = Form(...)):
    expected_csrf = request.session.get("csrf_token", "")
    if not expected_csrf or not hmac.compare_digest(expected_csrf, csrf_token):
        raise HTTPException(status_code=403, detail="Token CSRF inválido")
    request.session.clear()
    logger.info("Cierre de sesión")

    return RedirectResponse(
        "/login",
        status_code=303,
    )


# --------------------------------------------------
# APLICACIÓN PRINCIPAL
# --------------------------------------------------

@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    csrf_token = request.session.setdefault("csrf_token", secrets.token_urlsafe(32))
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "csrf_token": csrf_token,
        },
    )


# --------------------------------------------------
# API DE JUGADORES
# --------------------------------------------------

@app.get("/api/jugadores")
def listar_jugadores(
    uc: JugadorUseCases = Depends(use_cases),
):
    return uc.listar()


@app.get("/api/jugadores/inactivos")
def listar_jugadores_inactivos(
    uc: JugadorUseCases = Depends(use_cases),
):
    try:
        return uc.listar_inactivos()

    except Exception as exc:
        logger.exception("ERROR AL LISTAR JUGADORES INACTIVOS")
        raise HTTPException(
            status_code=502,
            detail="No se pudieron consultar los jugadores inactivos",
        ) from exc


@app.post("/api/jugadores", status_code=201)
def crear_jugador(
    datos: JugadorCreate,
    uc: JugadorUseCases = Depends(use_cases),
):
    try:
        return uc.crear(datos)

    except DuplicatePhoneError as exc:
        raise HTTPException(
            status_code=409,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        logger.exception("ERROR AL CREAR JUGADOR EN SUPABASE")
        raise HTTPException(
            status_code=502,
            detail="No se pudo guardar el jugador",
        ) from exc


@app.post("/api/jugadores/lote", status_code=201)
def crear_lote(
    datos: list[JugadorCreate] = Body(..., max_length=MAX_BATCH_SIZE),
    uc: JugadorUseCases = Depends(use_cases),
):
    try:
        return uc.crear_lote(datos)

    except DuplicatePhoneError as exc:
        raise HTTPException(
            status_code=409,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        logger.exception("ERROR AL IMPORTAR JUGADORES")
        raise HTTPException(
            status_code=502,
            detail="No se pudo completar la importación",
        ) from exc


@app.put("/api/jugadores/{jugador_id}")
def actualizar_jugador(
    jugador_id: str,
    datos: JugadorUpdate,
    uc: JugadorUseCases = Depends(use_cases),
):
    try:
        return uc.actualizar(jugador_id, datos)

    except DuplicatePhoneError as exc:
        raise HTTPException(
            status_code=409,
            detail=str(exc),
        ) from exc

    except NotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        logger.exception("ERROR AL ACTUALIZAR JUGADOR")
        raise HTTPException(
            status_code=502,
            detail="No se pudo actualizar el jugador",
        ) from exc


@app.delete("/api/jugadores/{jugador_id}")
def desactivar_jugador(
    jugador_id: str,
    uc: JugadorUseCases = Depends(use_cases),
):
    try:
        return uc.desactivar(jugador_id)

    except NotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        logger.exception("ERROR AL DESACTIVAR JUGADOR")
        raise HTTPException(
            status_code=502,
            detail="No se pudo desactivar el jugador",
        ) from exc


@app.delete("/api/jugadores/{jugador_id}/permanente")
def eliminar_jugador_definitivamente(
    jugador_id: str,
    uc: JugadorUseCases = Depends(use_cases),
):
    try:
        return uc.eliminar(jugador_id)

    except NotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        logger.exception("ERROR AL ELIMINAR JUGADOR DEFINITIVAMENTE")
        raise HTTPException(
            status_code=502,
            detail="No se pudo eliminar el jugador",
        ) from exc


@app.post("/api/jugadores/{jugador_id}/reactivar")
def reactivar_jugador(
    jugador_id: str,
    uc: JugadorUseCases = Depends(use_cases),
):
    try:
        return uc.reactivar(jugador_id)

    except NotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        logger.exception("ERROR AL REACTIVAR JUGADOR")
        raise HTTPException(
            status_code=502,
            detail="No se pudo reactivar el jugador",
        ) from exc
