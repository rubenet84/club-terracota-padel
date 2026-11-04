# Club Terracota Pádel

Aplicación web privada para gestionar contactos/jugadores y sus disponibilidades. El frontend conserva la interfaz del prototipo, pero los datos se leen y guardan en Supabase mediante una API FastAPI.

## Arquitectura

```text
Navegador (HTML + Tailwind + JavaScript)
          │ sesión HTTP (cookie firmada)
          ▼
FastAPI (presentación / API)
          │
          ▼
Casos de uso (application)
          │
          ▼
Repositorio Supabase (infrastructure)
          │ clave privilegiada solo en servidor
          ▼
PostgreSQL / Supabase
  ├── contactos
  ├── fichas_jugadores
  └── disponibilidades
```

## Requisitos

- Python 3.11 o superior.
- Node.js 18 o superior (solo para compilar los estilos).
- Proyecto Supabase ya creado y con las tres tablas indicadas en el diseño.
- Clave de servidor de Supabase (`service_role` antigua o `secret key` actual). No usar la `anon/publishable` para esta configuración del repositorio.

## 1. Preparar el esquema

En Supabase abre **SQL Editor → New query** y ejecuta el contenido de `sql/00_ajuste_disponibilidades.sql`.

Este pequeño ajuste añade `modalidad_horario` a `disponibilidades`, porque el prototipo distingue Fijo, Rotativo, Mañanas, Tardes y Noches. La columna `tipo` que ya existe sigue indicando `habitual` o `puntual`.

Antes de actualizar el código, ejecuta también `sql/01_hardening_transacciones.sql`, `sql/02_eliminar_jugadores.sql` y `sql/03_retirar_vaciado_masivo.sql`, en ese orden. La migración 01 comprueba teléfonos duplicados normalizados, añade índices, limita acceso directo a las tablas y crea funciones transaccionales para administrar jugadores. La migración 02 habilita el borrado definitivo individual. La migración 03 elimina la antigua RPC de vaciado masivo. La aplicación solo expone el borrado individual y las funciones RPC quedan restringidas a `service_role`.

## 2. Configurar secretos

En la carpeta raíz del proyecto:

```powershell
Copy-Item .env.example .env
```

Abre `.env` y configura:

- `APP_USERNAME`: usuario para entrar en esta aplicación.
- `APP_PASSWORD`: contraseña aleatoria exclusiva de al menos 16 caracteres. Puedes generarla con `python -c "import secrets; print(secrets.token_urlsafe(32))"`.
- `SESSION_SECRET_KEY`: genera una clave aleatoria con:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

- `SUPABASE_URL`: URL del proyecto, visible en Project Settings → API.
- `SUPABASE_SERVICE_ROLE_KEY`: clave secreta de servidor, visible en Project Settings → API Keys. Según la versión del panel puede aparecer como `service_role` o como una `secret key`.

La aplicación rechaza los valores de ejemplo y no inicia con una contraseña corta. Usa un usuario único distinto de `admin` en producción.

**No compartas el `.env`, no pegues sus valores en chats y no subas ese fichero a GitHub.** Está incluido en `.gitignore`.

La contraseña `Database password` de PostgreSQL no se utiliza en esta primera versión, porque la aplicación accede mediante la API de Supabase. Consérvala de forma segura por si más adelante necesitamos una conexión PostgreSQL directa.

## 3. Instalar y arrancar en Windows / PowerShell

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
npm ci
npm run build:css
pip install -r requirements.txt
uvicorn app.presentation.main:app --reload
```

Abre http://127.0.0.1:8000. Entra con `APP_USERNAME` y `APP_PASSWORD` definidos en `.env`.

## 4. Qué hace esta versión

- Lista los jugadores activos de Supabase.
- Crea contactos, fichas de jugador y disponibilidades relacionadas.
- Edita la ficha y sustituye sus disponibilidades.
- Desactiva jugadores sin borrar físicamente el contacto.
- Importa JSON/CSV y candidatos detectados en texto de WhatsApp mediante la API.
- Exporta los datos visibles a JSON o CSV.
- Comprueba teléfonos duplicados y valida email, nivel y horas en el backend.
- Exige nombre, teléfono y nivel del club; el nivel debe estar entre 1 y 5 en pasos de 0,25.
- Añade una pantalla de inicio de sesión; las rutas de API requieren sesión.

## 5. Modelo de datos utilizado

Al guardar un jugador se realizan estas operaciones:

1. `contactos`: nombre, teléfono, email y estado `jugador`.
2. `fichas_jugadores`: relación con el contacto, nivel, estado del nivel, lado preferido, busca partidas y observaciones.
3. `disponibilidades`: una fila por cada día seleccionado, con horas, tipo `habitual` y modalidad del horario.

El nombre, teléfono y nivel del club son obligatorios. El nivel debe estar entre 1 y 5 y avanzar en pasos de 0,25. El correo electrónico es opcional.

## 6. Publicar en GitHub y desplegar en Render

El proyecto incluye [`render.yaml`](https://render.com/docs/blueprint-spec) para crear un Web Service Python desde un repositorio GitHub. Render instala las dependencias de `requirements.txt`, arranca Uvicorn en el puerto asignado por Render y comprueba `/health`. `.python-version` mantiene el despliegue en Python 3.14, compatible con el entorno en el que se generó el lockfile. El CSS compilado está incluido en `app/static/app.css`, por lo que no hace falta instalar Node.js en el servidor.

Antes de publicar:

1. Revisa los archivos que vas a añadir y confirma que `.env`, `.venv/`, `node_modules/`, exportaciones y datos privados no aparecen en el commit. `.gitignore` los excluye, pero comprueba también que no estén ya versionados.
2. Inicializa Git en la carpeta del proyecto si todavía no lo has hecho, crea el repositorio GitHub como privado y sube la rama principal. No subas `.env` ni volcados de la base de datos.
3. Confirma que las cuatro migraciones SQL de la sección 1 ya se aplicaron en el proyecto Supabase de producción. Después, en Render crea un **Blueprint** desde ese repositorio y revisa el servicio definido en `render.yaml`.
4. Introduce en Render los valores de `APP_USERNAME`, `APP_PASSWORD`, `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Usa un nombre de usuario propio y una contraseña aleatoria exclusiva; Render genera `SESSION_SECRET_KEY` para el servicio.
5. Comprueba que `APP_ENV` quede como `production` y que el despliegue pase la comprobación `/health`. La aplicación entonces marca la cookie de sesión como segura y requiere HTTPS.
6. Inicia sesión y verifica que la aplicación puede leer Supabase. Haz una prueba controlada de creación, edición y eliminación de un jugador de prueba antes de guardar datos reales. `/health` comprueba que la aplicación responde; no verifica las credenciales ni la conexión a Supabase.

Las variables marcadas `sync: false` no guardan secretos en el repositorio; Render solicita sus valores al crear el Blueprint. Si agregas un Blueprint a un servicio existente, revisa las variables en el panel de Render.

El Blueprint configura el servicio con el plan Free para evitar seleccionar por defecto un plan de pago. Render Free suspende servicios web inactivos y puede tardar cerca de un minuto en responder al primer acceso; además puede suspender servicios al alcanzar límites de uso. Render indica que Free está pensado para pruebas y proyectos personales, no para producción. Antes de guardar datos confidenciales de clientes, valora un servicio de producción con disponibilidad adecuada. Los datos deben permanecer en Supabase; el disco de Render es efímero.

## Seguridad: alcance de esta primera versión

- La clave privilegiada de Supabase solo se carga en el backend; nunca se envía al navegador.
- El backend requiere un inicio de sesión compartido configurado por variables de entorno.
- La cookie de sesión está firmada; en `APP_ENV=production` se marca `Secure` (requiere HTTPS).
- Las sesiones usan `SameSite=Strict`, protección CSRF, cabecera `HttpOnly`, no se cachean y tienen ocho horas de vida.
- El login limita a cinco intentos por IP durante quince minutos por instancia; el cuerpo HTTP está limitado a 2 MiB y cada lote a 100 jugadores.
- Se envían cabeceras de seguridad y una CSP estricta sin `unsafe-inline` ni `unsafe-eval`. Tailwind se compila localmente; el navegador no carga scripts de terceros.
- Supabase `service_role`/secret key omite RLS. Por eso el acceso se restringe en el servidor y **no debe exponerse la API directamente sin HTTPS, credenciales fuertes y controles adicionales**.
- El limitador de login vive en cada proceso. En despliegues con varias instancias, configura límites persistentes en el proxy/WAF; este limitador es defensa complementaria.
- Para datos de clientes, configura Supabase Auth por persona, RLS con mínimo privilegio, TLS, copias cifradas con restauraciones probadas, monitorización y gestión de incidentes antes de abrir el servicio a Internet. La clave de servicio omite RLS y no sustituye estos controles.
- Las operaciones de escritura usan RPC transaccionales. Si falla una fila del lote, se revierte el lote entero.
- Estos controles reducen riesgos, pero ninguna aplicación puede garantizar que sea imposible de hackear. Revisa también el despliegue, las políticas de Supabase y las dependencias antes de producción.

## Comprobaciones locales

Instala las dependencias de desarrollo con `pip install -r requirements-dev.txt` y ejecuta `python -m pytest` para las pruebas de API, validación y seguridad. Ejecuta también `npm run test:filter` para las pruebas de filtros, parser de WhatsApp y lectura/exportación CSV en JavaScript. `npm ci` instala Tailwind y `npm run build:css` compila los estilos. `pip check` revisa dependencias Python; `pip-audit --local` analiza sus avisos de seguridad conocidos.

## Limitaciones funcionales conocidas

- El formulario mantiene un mismo intervalo horario para todos los días seleccionados, como el prototipo original.
- El editor representa el primer intervalo del jugador; si en el futuro se permiten horas distintas por día, habrá que mejorar el formulario para editar cada disponibilidad individualmente.
- El parser de WhatsApp es heurístico y requiere revisar los candidatos antes de guardarlos. No es IA y puede interpretar mal mensajes.
- No se ha conectado WhatsApp ni Playtomic/Matchpoint.
