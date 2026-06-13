import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

from backend.config import settings, BASE_DIR
from backend.database import init_db
from backend.xray import start_xray, stop_xray, query_traffic_stats
from backend.hysteria import start_hysteria, stop_hysteria, query_hysteria_traffic
from backend.api import router
from backend.auth_utils import decoy_response, handle_decoy_route

# Настройка логирования
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# Фоновые задачи
polling_task = None
port_scan_task = None

async def poll_port_scan_detector_loop():
    logging.info("Started background port scan detector task.")
    await asyncio.sleep(5)
    while True:
        try:
            await asyncio.sleep(10)
            from backend.scheduler import detect_and_block_port_scans
            await asyncio.to_thread(detect_and_block_port_scans)
        except asyncio.CancelledError:
            logging.info("Background port scan detector task cancelled.")
            break
        except Exception as e:
            logging.error(f"Error in port scan detector loop: {e}")

async def poll_xray_stats_loop():
    logging.info("Started background traffic statistics polling task.")
    
    # Wait for Xray and Hysteria 2 to fully initialize and start their API servers
    await asyncio.sleep(5)
    
    # Run the initial statistics and online check immediately at startup to avoid empty caches
    try:
        await asyncio.to_thread(query_traffic_stats)
        await asyncio.to_thread(query_hysteria_traffic)
        
        from backend.routes.clients import update_online_emails
        await asyncio.to_thread(update_online_emails)
        
        from backend.scheduler import enforce_client_limits_and_rules
        await asyncio.to_thread(enforce_client_limits_and_rules)
    except Exception as e:
        logging.error(f"Error in initial stats polling: {e}")
        
    while True:
        try:
            await asyncio.sleep(30)
            await asyncio.to_thread(query_traffic_stats)
            await asyncio.to_thread(query_hysteria_traffic)
            
            from backend.routes.clients import update_online_emails
            await asyncio.to_thread(update_online_emails)
            
            # Update active Telegram cards traffic on the panel
            try:
                from backend.telegram_alerts import update_panel_active_cards_traffic
                await update_panel_active_cards_traffic()
            except Exception as e:
                logging.error(f"Error updating active panel cards: {e}")
                
            # Проверка лимитов клиентов (лимит трафика, срок действия, лимит IP)
            from backend.scheduler import enforce_client_limits_and_rules
            await asyncio.to_thread(enforce_client_limits_and_rules)
        except asyncio.CancelledError:
            logging.info("Background traffic statistics polling task cancelled.")
            break
        except Exception as e:
            logging.error(f"Error in stats polling: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    global polling_task
    # Инициализация БД
    init_db()
    
    # Синхронизация статуса WARP с хоста при запуске
    try:
        from backend.host_client import host_client
        from backend.routes.system.warp import sync_warp_outbound_state
        status = host_client.send_command("get_warp_status", timeout=15.0)
        if isinstance(status, dict) and "connected" in status:
            sync_warp_outbound_state(status["connected"])
    except Exception as e:
        logging.error(f"Failed to perform startup WARP status sync: {e}")
    
    # Генерация дефолтных самоподписанных сертификатов при старте
    try:
        from backend.ssl_utils import generate_default_self_signed_cert
        generate_default_self_signed_cert()
    except Exception as e:
        logging.error(f"Failed to generate default self-signed certificate: {e}")
        
    # Загрузка словарей локализации
    from backend.i18n import load_translations
    load_translations()
    
    # Запуск Xray и Hysteria 2
    start_xray()
    start_hysteria()
    
    # Запуск фонового опроса трафика
    polling_task = asyncio.create_task(poll_xray_stats_loop())
    port_scan_task = asyncio.create_task(poll_port_scan_detector_loop())
    
    yield
    
    # Отмена фоновой задачи
    if polling_task:
        polling_task.cancel()
    if port_scan_task:
        port_scan_task.cancel()
        
    # Остановка Xray и Hysteria 2
    stop_xray()
    stop_hysteria()

# Отключаем документацию для скрытности (Stealth Mode)
app = FastAPI(
    title="Spectre Panel",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan
)

# Настройка CORS
# В продакшене фронтенд раздается на том же хосте/порту, что и API, поэтому CORS не требуется.
# Для разработки (например, с Vite на порту 5173) разрешаем локальные хосты.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)  # nosec B104

# Подключение сжатия Gzip для ответов API
from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Middleware для отключения кэширования фронтенда
@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.startswith(f"/{settings.PANEL_SECRET_PATH}"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Подключаем API роутер
app.include_router(router)

# Роут для Let's Encrypt HTTP-01 верификации
@app.get("/.well-known/acme-challenge/{token}")
async def acme_challenge(token: str):
    from backend.acme_client import ACME_CHALLENGES
    if token in ACME_CHALLENGES:
        return Response(content=ACME_CHALLENGES[token], media_type="text/plain")
    return Response(content="Challenge not found", status_code=404, media_type="text/plain")

# Роут для отдачи приманки (Decoy) на корневом пути
@app.get("/")
async def get_decoy_root(request: Request):
    return await handle_decoy_route(request)

# Подключаем фронтенд-статику ТОЛЬКО по секретному пути
# Папка frontend содержит index.html, css/style.css, js/app.js
frontend_dir = BASE_DIR / "frontend"
if frontend_dir.exists():
    class AuthenticatedStaticFiles(StaticFiles):
        async def get_response(self, path: str, scope) -> Response:
            # Защищаем компоненты, приватные скрипты и приватные стили от неавторизованного доступа
            is_component = "components/" in path
            is_private_js = "js/" in path and any(x in path for x in (
                "panel-main.js", "dashboard.js", "hysteria.js", "routing.js", 
                "inbound-modal.js", "clients.js", "modules/"
            ))
            is_private_css = "css/pages/" in path and "login.css" not in path
            
            if is_component or is_private_js or is_private_css:
                from fastapi import Request
                from backend.auth_utils import check_auth, decoy_response
                request = Request(scope)
                if not check_auth(request):
                    return decoy_response()
            
            response = await super().get_response(path, scope)
            
            # Отключаем кэширование для index.html (пустой путь или непосредственно index.html)
            clean_path = path.strip("/")
            if clean_path == "" or clean_path == "index.html":
                response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
                response.headers["Pragma"] = "no-cache"
                response.headers["Expires"] = "0"
                
            return response

    from starlette.responses import Response
    app.mount(
        f"/{settings.PANEL_SECRET_PATH}", 
        AuthenticatedStaticFiles(directory=str(frontend_dir), html=True), 
        name="frontend"
    )
    logging.info(f"Frontend mounted at: /{settings.PANEL_SECRET_PATH}/")
else:
    logging.warning("Frontend directory not found. Serving API only.")

# Роут-фолбек на все остальные пути для скрытности
@app.api_route("/{path_name:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def catch_all(request: Request, path_name: str):
    # Если путь не совпадает с секретным путем, отдаем заглушку Nginx или маскируемся
    return await handle_decoy_route(request, path_name)

if __name__ == "__main__":
    import uvicorn
    from backend.ssl_utils import generate_default_self_signed_cert, SSL_CERT_PATH, SSL_KEY_PATH
    
    # Гарантируем наличие сертификатов перед запуском веб-сервера
    try:
        generate_default_self_signed_cert()
    except Exception as e:
        logging.error(f"Failed to generate default self-signed certificate before startup: {e}")
        
    ssl_key = str(SSL_KEY_PATH) if SSL_KEY_PATH.exists() else None
    ssl_cert = str(SSL_CERT_PATH) if SSL_CERT_PATH.exists() else None
    
    if ssl_key and ssl_cert:
        logging.info(f"Starting HTTPS server on port {settings.PANEL_PORT}...")
        uvicorn.run(
            "backend.main:app",
            host="0.0.0.0",
            port=settings.PANEL_PORT,
            ssl_keyfile=ssl_key,
            ssl_certfile=ssl_cert,
            reload=False
        )  # nosec B104
    else:
        logging.warning("SSL certificates not found. Starting HTTP server...")
        logging.info(f"Starting server on port {settings.PANEL_PORT}...")
        uvicorn.run("backend.main:app", host="0.0.0.0", port=settings.PANEL_PORT, reload=False)  # nosec B104

