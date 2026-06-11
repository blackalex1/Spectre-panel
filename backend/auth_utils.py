import secrets
import hmac
import hashlib
import time
import logging
import json
import datetime
from urllib.parse import parse_qsl
from typing import Optional
from fastapi import Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
import httpx

from backend.config import settings, BASE_DIR
from backend.database import get_setting

ACTIVE_SESSIONS = set()
CSRF_TOKENS = {}

def decoy_response():
    """Возвращает стандартную заглушку Nginx 404"""
    html_content = """<html>
<head><title>404 Not Found</title></head>
<body>
<center><h1>404 Not Found</h1></center>
<hr><center>nginx</center>
</body>
</html>"""
    return HTMLResponse(content=html_content, status_code=404)

def check_auth(request: Request) -> bool:
    """Проверяет авторизацию: либо по Bearer Token, либо по Cookie сессии"""
    # 1. Проверка Bearer Token (для бота-контроллера)
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        if token == settings.API_TOKEN:
            return True
            
    # 2. Проверка Session Cookie
    session_id = request.cookies.get("session_id")
    if session_id:
        from backend.database import get_session_db, delete_session_db
        db_sess = get_session_db(session_id)
        if db_sess:
            import time
            if db_sess["expires_at"] > int(time.time()):
                # Валидация CSRF для небезопасных методов
                if request.method in ("POST", "PUT", "DELETE"):
                    csrf_token = request.headers.get("X-CSRF-Token")
                    if not csrf_token or CSRF_TOKENS.get(session_id) != csrf_token:
                        return False
                return True
            else:
                # Сессия истекла, удаляем ее из БД
                delete_session_db(session_id)
                ACTIVE_SESSIONS.discard(session_id)
        
    return False

def verify_node_token(request: Request) -> bool:
    """Проверяет токен ноды (Edge-сервера) во избежание получения decoy заглушки"""
    node_id = request.headers.get("X-Node-ID")
    auth_header = request.headers.get("Authorization", "")
    
    if not node_id or not auth_header.startswith("Bearer "):
        return False
        
    token = auth_header.split(" ")[1]
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    
    try:
        from backend.database import db_session
        from backend.models import Node
        with db_session() as session:
            node = session.query(Node).filter_by(id=node_id, status="active").first()
            if node:
                return hmac.compare_digest(node.api_token_hash, token_hash)
    except Exception as e:
        logging.error(f"Error in verify_node_token: {e}")
        
    return False

def verify_telegram_webapp(init_data: str) -> Optional[dict]:
    """Криптографически проверяет initData от Telegram Mini App"""
    bot_token = get_setting("telegram_bot_token", "")
    if not bot_token:
        logging.warning("[verify_telegram_webapp] telegram_bot_token is empty in database settings!")
        return None
    if not init_data:
        logging.warning("[verify_telegram_webapp] init_data is empty!")
        return None
        
    try:
        parsed = dict(parse_qsl(init_data, keep_blank_values=True))
        if "hash" not in parsed:
            logging.warning("[verify_telegram_webapp] 'hash' parameter is missing from initData!")
            return None
            
        received_hash = parsed.pop("hash")
        
        # Сортируем все оставшиеся параметры по алфавиту
        sorted_params = sorted(parsed.items())
        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted_params)
        
        # Вычисляем секретный ключ (HMAC с ключом "WebAppData" от токена бота)
        secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        
        # Вычисляем хэш
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        
        if calculated_hash != received_hash:
            logging.warning(
                f"[verify_telegram_webapp] Signature hash mismatch! "
                f"Check that the bot token set in the panel matches the bot you are using to open the WebApp. "
                f"Configured token starts with: '{bot_token[:6]}...'"
            )
            return None
            
        # Проверяем дату (устаревание initData через 24 часа)
        auth_date = int(parsed.get("auth_date", 0))
        time_diff = time.time() - auth_date
        logging.info(f"[verify_telegram_webapp] Signature verified successfully. auth_date diff: {time_diff:.1f}s")
        
        if time_diff > 86400:
            logging.warning(f"[verify_telegram_webapp] initData expired. auth_date diff is {time_diff:.1f}s (> 86400s)")
            return None
            
        user_json = parsed.get("user")
        if user_json:
            return json.loads(user_json)
    except Exception as e:
        logging.error(f"[verify_telegram_webapp] Telegram webapp signature verification error: {e}")
    return None


# --- Системы маскировки (Decoy Sites) ---

templates = None

def get_templates():
    global templates
    if templates is None:
        decoy_dir = BASE_DIR / "frontend" / "decoy"
        if decoy_dir.exists():
            templates = Jinja2Templates(directory=str(decoy_dir))
    return templates

def render_static_decoy(request: Request) -> HTMLResponse:
    tpls = get_templates()
    if tpls:
        try:
            server_host = request.headers.get("host", "localhost")
            # Генерация стабильной псевдо-статистики
            h = sum(ord(c) for c in server_host)
            served_count = 120 + (h % 380)
            
            domain = server_host.split(":")[0]
            contact_email = f"info@{domain}" if "." in domain else "info@nimbus.solutions"
            current_year = datetime.datetime.now().year
            
            return tpls.TemplateResponse(
                request,
                "company_landing.html",
                {
                    "contact_email": contact_email,
                    "served_count": served_count,
                    "current_year": current_year,
                    "server_host": server_host
                }
            )
        except Exception as e:
            logging.error(f"Static decoy rendering error: {e}")
            
    # Резервный HTML 404
    html_content = """<html>
<head><title>404 Not Found</title></head>
<body>
<center><h1>404 Not Found</h1></center>
<hr><center>nginx</center>
</body>
</html>"""
    return HTMLResponse(content=html_content, status_code=404)

async def proxy_decoy_request(request: Request, path: str) -> Response:
    decoy_value = get_setting("decoy_value", "company_landing")
    if not decoy_value.startswith("http"):
        return render_static_decoy(request)
        
    try:
        target_url = f"{decoy_value.rstrip('/')}/{path}"
        if request.query_params:
            target_url += f"?{request.query_params}"
            
        headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "accept-encoding")}
        
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
            req_method = request.method
            req_content = await request.body()
            
            proxy_res = await client.request(
                method=req_method,
                url=target_url,
                headers=headers,
                content=req_content
            )
            
            exclude_headers = ("content-encoding", "content-length", "transfer-encoding", "connection")
            res_headers = {k: v for k, v in proxy_res.headers.items() if k.lower() not in exclude_headers}
            
            return Response(
                content=proxy_res.content,
                status_code=proxy_res.status_code,
                headers=res_headers,
                media_type=proxy_res.headers.get("content-type")
            )
    except Exception as e:
        logging.error(f"Proxy decoy error for path '{path}': {e}")
        return render_static_decoy(request)

async def handle_decoy_route(request: Request, path: str = "") -> Response:
    """Определяет тип маскировки и отдает соответствующий ответ"""
    decoy_type = get_setting("decoy_type", "none")
    
    if decoy_type == "proxy":
        return await proxy_decoy_request(request, path)
    elif decoy_type == "redirect":
        decoy_value = get_setting("decoy_value", "company_landing")
        if decoy_value.startswith("http"):
            return RedirectResponse(url=decoy_value, status_code=302)
        return render_static_decoy(request)
    elif decoy_type == "static":
        return render_static_decoy(request)
    else:
        return decoy_response()

