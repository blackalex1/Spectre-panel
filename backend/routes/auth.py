import secrets
import time
import logging
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.config import settings
from backend.database import authenticate_admin
from backend.auth_utils import (
    ACTIVE_SESSIONS, CSRF_TOKENS, decoy_response, verify_telegram_webapp, check_auth
)

router = APIRouter()

# Хранилище попыток входа для rate limiting: IP -> list of timestamps
LOGIN_ATTEMPTS = {}


def is_ip_whitelisted_sync(client_ip: str) -> bool:
    from backend.database import get_setting
    import json
    try:
        val = get_setting("ips_whitelisted_sync", "[]")
        ips = json.loads(val)
        for entry in ips:
            entry = entry.strip()
            if ":" in entry:
                entry_ip, entry_port = entry.rsplit(":", 1)
                if entry_ip == client_ip:
                    if entry_port == "*" or str(entry_port) == str(settings.PANEL_PORT):
                        return True
            else:
                if entry == client_ip:
                    return True
    except Exception as e:
        logging.error(f"Error checking synchronized IP whitelist: {e}")
    return False


def check_rate_limit(ip: str) -> bool:
    if is_ip_whitelisted_sync(ip):
        return True
    import time
    from backend.database import get_setting
    now = time.time()
    
    period = int(get_setting("login_attempts_period", str(settings.LOGIN_ATTEMPTS_PERIOD)))
    max_attempts = int(get_setting("login_max_attempts", str(settings.LOGIN_MAX_ATTEMPTS)))
    
    # Очищаем попытки старше выбранного периода
    attempts = [t for t in LOGIN_ATTEMPTS.get(ip, []) if now - t < period]
    LOGIN_ATTEMPTS[ip] = attempts
    return len(attempts) < max_attempts

def record_attempt(ip: str):
    import time
    if ip not in LOGIN_ATTEMPTS:
        LOGIN_ATTEMPTS[ip] = []
    LOGIN_ATTEMPTS[ip].append(time.time())

class LoginRequest(BaseModel):
    username: str
    password: str

@router.get("/csrf-token")
async def get_csrf_token(request: Request):
    """Возвращает CSRF токен для сессии"""
    # Если запрос от контроллера с Bearer токеном, разрешаем
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer ") and auth_header.split(" ")[1] == settings.API_TOKEN:
        return {"success": True, "obj": "bearer_bypass"}
        
    session_id = request.cookies.get("session_id")
    if not session_id or session_id not in ACTIVE_SESSIONS:
        return decoy_response()
        
    token = CSRF_TOKENS.get(session_id)
    if not token:
        token = secrets.token_hex(16)
        CSRF_TOKENS[session_id] = token
        
    return {"success": True, "obj": token}

@router.post("/login")
async def login_api(request: Request, response: Response):
    """Авторизация по логину и паролю (поддерживает JSON и Form data)"""
    client_ip = request.client.host if request.client else "unknown"
    
    from backend.database import get_setting
    banned_ips = get_setting("banned_login_ips", "")
    if client_ip in [ip.strip() for ip in banned_ips.split(",") if ip.strip()]:
        return JSONResponse(status_code=403, content={"success": False, "msg": "Ваш IP-адрес заблокирован."})
        
    content_type = request.headers.get("content-type", "")
    uname = None
    pwd = None
    
    if "application/json" in content_type:
        try:
            body = await request.json()
            uname = body.get("username")
            pwd = body.get("password")
        except Exception as e:
            logging.warning(f"Failed to parse JSON login body: {e}")
    else:
        try:
            form = await request.form()
            uname = form.get("username")
            pwd = form.get("password")
        except Exception as e:
            logging.warning(f"Failed to parse Form login data: {e}")
            
    if not uname or not pwd:
        from backend.audit import log_action
        log_action("unknown", "login_failure", target=client_ip, details="Empty login credentials")
        return decoy_response()
        
    # Rate Limiting
    if not check_rate_limit(client_ip):
        from backend.audit import log_action
        period = int(get_setting("login_attempts_period", str(settings.LOGIN_ATTEMPTS_PERIOD)))
        log_action("system", "login_rate_limited", target=client_ip, details=f"IP {client_ip} exceeded max login attempts. Blocked for {period}s.")
        return JSONResponse(status_code=429, content={"success": False, "msg": f"Слишком много попыток входа. Пожалуйста, подождите {period} сек."})
        
    record_attempt(client_ip)
        
    # Брутфорс защита: небольшая задержка без блокировки event loop
    fail_delay = float(get_setting("login_fail_delay", str(settings.LOGIN_FAIL_DELAY)))
    if fail_delay > 0:
        import asyncio
        await asyncio.sleep(fail_delay)
    
    from backend.audit import log_action
    if authenticate_admin(uname, pwd):
        # Проверяем 2FA
        from backend.models import User
        from backend.database import db_session
        import json
        import asyncio
        
        with db_session() as session:
            user = session.query(User).filter_by(username=uname).first()
            
            totp_secret = user.totp_secret if user else None
            totp_enabled = user.totp_enabled if user else 0
            
            totp_active = user and totp_enabled == 1
            telegram_active = get_setting("telegram_2fa_enabled", "false") == "true"
            
            # Если IP клиента находится в синхронизированном белом списке, отключаем 2FA
            if is_ip_whitelisted_sync(client_ip):
                logging.info(f"[Auth Whitelist] Отключение 2FA для белого IP: {client_ip}")
                totp_active = False
                telegram_active = False
            
            if totp_active or telegram_active:
                code = None
                if "application/json" in content_type:
                    try:
                        body = await request.json()
                        code = body.get("code")
                    except Exception:
                        pass
                else:
                    try:
                        form = await request.form()
                        code = form.get("code")
                    except Exception:
                        pass
                
                # Пробуем проверить TOTP
                totp_verified = False
                if totp_active and code:
                    from backend.totp import verify_totp_token
                    if verify_totp_token(totp_secret, code):
                        totp_verified = True
                
                if not totp_verified:
                    # Если TOTP код прислан, но неверный (при включенном TOTP)
                    if totp_active and code:
                        log_action(uname, "login_2fa_failure", target=client_ip, details="Invalid 2FA code")
                        return {"success": False, "msg": "Неверный код двухфакторной аутентификации"}
                        
                    # Если Telegram 2FA включена, отправляем подтверждение
                    if telegram_active:
                        tg_token = secrets.token_hex(32)
                        from backend.models import SystemSetting
                        session.add(SystemSetting(
                            key=f"tg_2fa_req_{tg_token}",
                            value=json.dumps({
                                "username": uname,
                                "client_ip": client_ip,
                                "status": "pending",
                                "expires": time.time() + 120
                            })
                        ))
                        session.commit()
                        
                        bot_token = get_setting("telegram_bot_token", "")
                        tg_admin_ids = get_setting("telegram_admin_ids", "")
                        
                        if bot_token and tg_admin_ids:
                            from aiogram import Bot
                            from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
                            
                            temp_bot = Bot(token=bot_token)
                            kb = InlineKeyboardMarkup(inline_keyboard=[
                                [
                                    InlineKeyboardButton(text="✅ Да, разрешить", callback_data=f"tg_2fa_approve:{tg_token}"),
                                    InlineKeyboardButton(text="❌ Заблокировать IP", callback_data=f"tg_2fa_block:{tg_token}:{client_ip}")
                                ]
                            ])
                            
                            admin_ids = [x.strip() for x in tg_admin_ids.split(",") if x.strip()]
                            
                            async def send_2fa_alert(bot_inst, chat, ip, keyboard):
                                try:
                                    await bot_inst.send_message(
                                        chat_id=chat,
                                        text=f"🚨 <b>Попытка входа в панель с IP <code>{ip}</code>. Это вы?</b>",
                                        reply_markup=keyboard,
                                        parse_mode="HTML"
                                    )
                                except Exception as ex:
                                    logging.error(f"Failed to send 2FA alert: {ex}")
                                finally:
                                    await bot_inst.session.close()
                                    
                            try:
                                loop = asyncio.get_running_loop()
                                for admin_id in admin_ids:
                                    loop.create_task(send_2fa_alert(temp_bot, admin_id, client_ip, kb))
                            except RuntimeError:
                                pass
                                
                        return {
                            "success": True,
                            "requires_2fa": True,
                            "type": "both" if totp_active else "tg_2fa",
                            "token": tg_token,
                            "msg": "Требуется подтверждение входа"
                        }
                    else:
                        # Включен только TOTP
                        return {"success": True, "requires_2fa": True, "type": "totp", "msg": "Требуется двухфакторная аутентификация"}

        session_id = secrets.token_hex(16)
        
        # Получаем срок действия сессии из настроек и сохраняем в БД
        from backend.database import add_session_db
        timeout_days = int(get_setting("session_timeout_days", str(settings.SESSION_TIMEOUT_DAYS)))
        user_agent = request.headers.get("user-agent", "unknown")
        add_session_db(session_id, uname, timeout_days, ip_address=client_ip, user_agent=user_agent)
        ACTIVE_SESSIONS.add(session_id)
        
        # Генерируем CSRF
        csrf_token = secrets.token_hex(16)
        CSRF_TOKENS[session_id] = csrf_token
        
        response.set_cookie(
            key="session_id", 
            value=session_id, 
            httponly=True, 
            samesite="lax",
            secure=True,
            max_age=timeout_days * 24 * 3600
        )
        log_action(uname, "login_success", target=client_ip, details="Web password login success")
        return {"success": True, "msg": "Успешный вход"}
        
    log_action(uname, "login_failure", target=client_ip, details="Invalid password")
    return {"success": False, "msg": "Неверный логин или пароль"}


@router.post("/api/auth/telegram")
async def telegram_webapp_auth(request: Request, response: Response, payload: dict):
    """Авторизация через Telegram WebApp с проверкой initData"""
    init_data = payload.get("initData")
    if not init_data:
        return JSONResponse(status_code=400, content={"success": False, "msg": "Missing initData"})
        
    client_ip = request.client.host if request.client else "unknown"
    from backend.audit import log_action
    user = verify_telegram_webapp(init_data)
    if not user:
        log_action("unknown_tg", "login_telegram_failure", target=client_ip, details="Invalid Telegram webapp signature")
        return JSONResponse(status_code=401, content={"success": False, "msg": "Неверная цифровая подпись Telegram"})
        
    tg_id = str(user.get("id"))
    username_tg = user.get("username") or f"tg_{tg_id}"
    
    # Проверяем белый список ID
    from backend.database import get_setting
    tg_admin_ids = get_setting("telegram_admin_ids", "")
    allowed_ids = [x.strip() for x in tg_admin_ids.split(",") if x.strip()]
    if not allowed_ids or tg_id not in allowed_ids:
        logging.warning(f"Unauthorized Telegram login attempt: ID {tg_id} ({user.get('username')})")
        log_action(username_tg, "login_telegram_failure", target=client_ip, details=f"Telegram ID {tg_id} not in whitelist")
        return JSONResponse(status_code=403, content={"success": False, "msg": "Ваш Telegram ID отсутствует в белом списке"})
        
    # Rate Limiting
    if not check_rate_limit(client_ip):
        from backend.database import get_setting
        from backend.audit import log_action
        period = int(get_setting("login_attempts_period", str(settings.LOGIN_ATTEMPTS_PERIOD)))
        log_action("system", "login_rate_limited", target=client_ip, details=f"IP {client_ip} exceeded max Telegram webapp login attempts. Blocked for {period}s.")
        return JSONResponse(status_code=429, content={"success": False, "msg": f"Слишком много попыток входа. Пожалуйста, подождите {period} сек."})
        
    record_attempt(client_ip)

    # Сессия
    session_id = secrets.token_hex(16)
    
    # Получаем срок действия сессии из настроек и сохраняем сессию в БД
    from backend.database import get_setting, add_session_db
    timeout_days = int(get_setting("session_timeout_days", str(settings.SESSION_TIMEOUT_DAYS)))
    user_agent = request.headers.get("user-agent", "unknown")
    add_session_db(session_id, username_tg, timeout_days, ip_address=client_ip, user_agent=user_agent)
    ACTIVE_SESSIONS.add(session_id)
    
    csrf_token = secrets.token_hex(16)
    CSRF_TOKENS[session_id] = csrf_token
    
    response.set_cookie(
        key="session_id", 
        value=session_id, 
        httponly=True, 
        samesite="lax",
        secure=True,
        max_age=timeout_days * 24 * 3600
    )
    
    log_action(username_tg, "login_telegram_success", target=client_ip, details=f"Telegram WebApp login success (ID: {tg_id})")
    return {"success": True, "token": csrf_token}

@router.post("/api/logout")
async def logout(request: Request, response: Response):
    session_id = request.cookies.get("session_id")
    if session_id:
        from backend.audit import log_action, get_actor_username
        from backend.database import delete_session_db
        actor = get_actor_username(request)
        delete_session_db(session_id)
        ACTIVE_SESSIONS.discard(session_id)
        CSRF_TOKENS.pop(session_id, None)
        client_ip = request.client.host if request.client else "unknown"
        log_action(actor, "logout", target=client_ip)
    response.delete_cookie("session_id")
    return {"success": True}

@router.post("/api/settings/credentials")
async def change_credentials_api(request: Request):
    if not check_auth(request):
        return decoy_response()
    
    try:
        body = await request.json()
        current_password = body.get("current_password")
        new_username = body.get("new_username")
        new_password = body.get("new_password")
    except Exception:
        return {"success": False, "msg": "Неверный формат запроса"}
        
    if not current_password or not new_username:
        return {"success": False, "msg": "Текущий пароль и новый логин обязательны"}
        
    from backend.audit import log_action, get_actor_username
    actor = get_actor_username(request)
    
    if not authenticate_admin(actor, current_password):
        return {"success": False, "msg": "Неверный текущий пароль"}
        
    from backend.models import User
    from backend.database import db_session, update_admin_credentials
    with db_session() as session:
        existing = session.query(User).filter_by(username=new_username).first()
        if existing and existing.username != actor:
            return {"success": False, "msg": "Имя пользователя уже занято"}
            
    success = update_admin_credentials(actor, new_username, new_password)
    if success:
        log_action(actor, "change_credentials", details=f"Username changed to {new_username}")
        return {"success": True, "msg": "Учетные данные успешно изменены."}
    else:
        return {"success": False, "msg": "Не удалось обновить учетные данные"}

@router.get("/api/settings/2fa/setup")
async def setup_2fa_api(request: Request):
    if not check_auth(request):
        return decoy_response()
        
    from backend.audit import get_actor_username
    actor = get_actor_username(request)
    
    from backend.models import User
    from backend.database import db_session
    from backend.totp import generate_totp_secret, get_totp_uri
    
    with db_session() as session:
        user = session.query(User).filter_by(username=actor).first()
        if not user:
            return {"success": False, "msg": "Пользователь не найден"}
            
        if user.totp_enabled == 1:
            return {"success": False, "msg": "Двухфакторная аутентификация уже включена"}
            
        secret = generate_totp_secret()
        user.totp_secret = secret
        session.commit()
        
    qr_uri = get_totp_uri(secret, actor)
    return {
        "success": True,
        "secret": secret,
        "qr_uri": qr_uri
    }

@router.post("/api/settings/2fa/enable")
async def enable_2fa_api(request: Request):
    if not check_auth(request):
        return decoy_response()
        
    try:
        body = await request.json()
        code = body.get("code")
    except Exception:
        return {"success": False, "msg": "Неверный формат запроса"}
        
    if not code:
        return {"success": False, "msg": "Код подтверждения обязателен"}
        
    from backend.audit import log_action, get_actor_username
    actor = get_actor_username(request)
    
    from backend.models import User
    from backend.database import db_session
    from backend.totp import verify_totp_token
    
    with db_session() as session:
        user = session.query(User).filter_by(username=actor).first()
        if not user or not user.totp_secret:
            return {"success": False, "msg": "2FA не настроена. Сначала получите секретный ключ."}
            
        if user.totp_enabled == 1:
            return {"success": False, "msg": "2FA уже включена"}
            
        if verify_totp_token(user.totp_secret, code):
            user.totp_enabled = 1
            session.commit()
            log_action(actor, "enable_2fa", details="TOTP enabled successfully")
            return {"success": True, "msg": "Двухфакторная аутентификация успешно включена"}
        else:
            return {"success": False, "msg": "Неверный код подтверждения"}

@router.post("/api/settings/2fa/disable")
async def disable_2fa_api(request: Request):
    if not check_auth(request):
        return decoy_response()
        
    try:
        body = await request.json()
        code = body.get("code")
    except Exception:
        return {"success": False, "msg": "Неверный формат запроса"}
        
    if not code:
        return {"success": False, "msg": "Код подтверждения обязателен"}
        
    from backend.audit import log_action, get_actor_username
    actor = get_actor_username(request)
    
    from backend.models import User
    from backend.database import db_session
    from backend.totp import verify_totp_token
    
    with db_session() as session:
        user = session.query(User).filter_by(username=actor).first()
        if not user or user.totp_enabled == 0:
            return {"success": False, "msg": "2FA не включена для этого пользователя"}
            
        if verify_totp_token(user.totp_secret, code):
            user.totp_enabled = 0
            user.totp_secret = None
            session.commit()
            log_action(actor, "disable_2fa", details="TOTP disabled successfully")
            return {"success": True, "msg": "Двухфакторная аутентификация успешно отключена"}
        else:
            return {"success": False, "msg": "Неверный код подтверждения"}

@router.get("/api/auth/tg-2fa/poll")
async def tg_2fa_poll(request: Request, response: Response, token: str):
    from backend.database import db_session, get_setting, add_session_db
    from backend.models import SystemSetting
    import json
    import time
    
    with db_session() as session:
        setting = session.query(SystemSetting).filter_by(key=f"tg_2fa_req_{token}").first()
        if not setting:
            return {"success": False, "status": "expired"}
            
        try:
            data = json.loads(setting.value)
        except Exception:
            return {"success": False, "status": "expired"}
            
        if time.time() > data.get("expires", 0):
            session.delete(setting)
            session.commit()
            return {"success": True, "status": "expired"}
            
        status = data.get("status", "pending")
        if status == "approved":
            uname = data.get("username", "admin")
            session_id = secrets.token_hex(16)
            timeout_days = int(get_setting("session_timeout_days", str(settings.SESSION_TIMEOUT_DAYS)))
            client_ip = request.client.host if request.client else "unknown"
            user_agent = request.headers.get("user-agent", "unknown")
            add_session_db(session_id, uname, timeout_days, ip_address=client_ip, user_agent=user_agent)
            ACTIVE_SESSIONS.add(session_id)
            
            csrf_token = secrets.token_hex(16)
            CSRF_TOKENS[session_id] = csrf_token
            
            response.set_cookie(
                key="session_id", 
                value=session_id, 
                httponly=True, 
                samesite="lax",
                secure=True,
                max_age=timeout_days * 24 * 3600
            )
            
            session.delete(setting)
            session.commit()
            
            from backend.audit import log_action
            log_action(uname, "login_success", target=data.get("client_ip"), details="Web Telegram 2FA login approved")
            return {"success": True, "status": "approved", "msg": "Успешный вход"}
            
        elif status == "blocked":
            session.delete(setting)
            session.commit()
            return {"success": True, "status": "blocked"}
            
        return {"success": True, "status": "pending"}

class Tg2faActionBody(BaseModel):
    token: str
    action: str

@router.post("/api/auth/tg-2fa/action")
async def tg_2fa_action(payload: Tg2faActionBody):
    from backend.database import db_session, get_setting, set_setting
    from backend.models import SystemSetting
    import json
    import subprocess
    
    token = payload.token
    action = payload.action
    
    with db_session() as session:
        setting = session.query(SystemSetting).filter_by(key=f"tg_2fa_req_{token}").first()
        if not setting:
            return {"success": False, "msg": "Запрос не найден или истек"}
            
        try:
            data = json.loads(setting.value)
        except Exception:
            return {"success": False, "msg": "Неверный формат запроса"}
            
        if action == "approve":
            data["status"] = "approved"
            setting.value = json.dumps(data)
            session.commit()
            return {"success": True, "msg": "Вход разрешен"}
            
        elif action == "block":
            data["status"] = "blocked"
            setting.value = json.dumps(data)
            
            client_ip = data.get("client_ip")
            if client_ip and client_ip != "unknown":
                banned_ips = get_setting("banned_login_ips", "")
                banned_list = [ip.strip() for ip in banned_ips.split(",") if ip.strip()]
                if client_ip not in banned_list:
                    banned_list.append(client_ip)
                    set_setting("banned_login_ips", ",".join(banned_list))
                    
                try:
                    subprocess.run(["iptables", "-I", "INPUT", "-s", client_ip, "-j", "DROP"], capture_output=True)
                except Exception as ex:
                    logging.warning(f"Failed to block IP via iptables: {ex}")
                    
            session.commit()
            return {"success": True, "msg": "IP заблокирован"}
            
        return {"success": False, "msg": "Неверное действие"}

