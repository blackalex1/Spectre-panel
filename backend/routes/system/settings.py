from fastapi import APIRouter, Request

from backend.config import settings
from backend.host_client import host_client
from backend.database import get_setting, set_setting
import backend.routes.system

router = APIRouter()

@router.get("/api/settings")
async def get_settings_api(request: Request):
    if not backend.routes.system.check_auth(request):
        return backend.routes.system.decoy_response()
        
    from backend.models import User
    from backend.database import db_session
    totp_enabled = False
    admin_username = ""
    with db_session() as session:
        user = session.query(User).first()
        if user:
            totp_enabled = (user.totp_enabled == 1)
            admin_username = user.username
            
    return {
        "success": True,
        "api_token": settings.API_TOKEN,
        "secret_path": settings.PANEL_SECRET_PATH,
        "admin_username": admin_username,
        "totp_enabled": totp_enabled,
        "decoy_type": get_setting("decoy_type", "none"),
        "decoy_value": get_setting("decoy_value", "company_landing"),
        "ssl_domain": get_setting("ssl_domain", ""),
        "ssl_email": get_setting("ssl_email", ""),
        "language": get_setting("language", "ru"),
        "session_timeout_days": int(get_setting("session_timeout_days", str(settings.SESSION_TIMEOUT_DAYS))),
        "telegram_bot_token": "••••••••" if get_setting("telegram_bot_token", "") else "",
        "telegram_admin_ids": get_setting("telegram_admin_ids", ""),
        "telegram_2fa_enabled": get_setting("telegram_2fa_enabled", "false") == "true",
        "login_max_attempts": int(get_setting("login_max_attempts", str(settings.LOGIN_MAX_ATTEMPTS))),
        "login_attempts_period": int(get_setting("login_attempts_period", str(settings.LOGIN_ATTEMPTS_PERIOD))),
        "login_fail_delay": float(get_setting("login_fail_delay", str(settings.LOGIN_FAIL_DELAY))),
        "backup_enable": get_setting("backup_enable", "false") == "true",
        "backup_interval": get_setting("backup_interval", "daily"),
        "backup_rotation": int(get_setting("backup_rotation", "7")),
        "backup_telegram": get_setting("backup_telegram", "false") == "true",
        "backup_encrypt": get_setting("backup_encrypt", "false") == "true",
        "block_bittorrent": get_setting("block_bittorrent", "false") == "true",
        "block_ads": get_setting("block_ads", "false") == "true",
        "block_cn": get_setting("block_cn", "false") == "true",
        "block_ru": get_setting("block_ru", "false") == "true",
        "block_us": get_setting("block_us", "false") == "true"
    }

@router.post("/api/settings/update")
async def update_settings_api(request: Request):
    if not backend.routes.system.check_auth(request):
        return backend.routes.system.decoy_response()
    
    try:
        data = await request.json()
        
        # 1. Access Credentials Card
        if "secret_path" in data:
            secret_path = data.get("secret_path")
            if not secret_path or not secret_path.isalnum():
                return {"success": False, "msg": "Неверный секретный путь (разрешены только буквы и цифры)"}
            backend.routes.system.save_settings_to_env({
                "PANEL_SECRET_PATH": secret_path,
            })
            
        if "session_timeout_days" in data:
            try:
                session_timeout_days = int(data.get("session_timeout_days"))
                if session_timeout_days <= 0:
                    raise ValueError()
                set_setting("session_timeout_days", str(session_timeout_days))
            except ValueError:
                return {"success": False, "msg": "Неверный срок действия сессии (должно быть целое положительное число дней)"}

        if "login_max_attempts" in data:
            try:
                login_max_attempts = int(data.get("login_max_attempts"))
                if login_max_attempts <= 0:
                    raise ValueError()
                set_setting("login_max_attempts", str(login_max_attempts))
            except ValueError:
                return {"success": False, "msg": "Неверный максимум попыток входа (должно быть целое положительное число)"}

        if "login_attempts_period" in data:
            try:
                login_attempts_period = int(data.get("login_attempts_period"))
                if login_attempts_period <= 0:
                    raise ValueError()
                set_setting("login_attempts_period", str(login_attempts_period))
            except ValueError:
                return {"success": False, "msg": "Неверный период проверки (должно быть целое положительное число секунд)"}

        if "login_fail_delay" in data:
            try:
                login_fail_delay = float(data.get("login_fail_delay"))
                if login_fail_delay < 0:
                    raise ValueError()
                set_setting("login_fail_delay", str(login_fail_delay))
            except ValueError:
                return {"success": False, "msg": "Неверное время задержки после неверного ввода (должно быть положительным числом)"}

        # 2. Telegram Integration Card
        tg_changed = False
        if "telegram_bot_token" in data or "telegram_admin_ids" in data or "telegram_2fa_enabled" in data:
            old_token = get_setting("telegram_bot_token", "")
            old_admin_ids = get_setting("telegram_admin_ids", "")
            
            tg_bot_token = data.get("telegram_bot_token", old_token).strip()
            if tg_bot_token == "••••••••":
                tg_bot_token = old_token
            tg_admin_ids = data.get("telegram_admin_ids", old_admin_ids).strip()
            
            if tg_bot_token != old_token or tg_admin_ids != old_admin_ids:
                tg_changed = True
                
            set_setting("telegram_bot_token", tg_bot_token)
            set_setting("telegram_admin_ids", tg_admin_ids)
            
            if "telegram_2fa_enabled" in data:
                set_setting("telegram_2fa_enabled", "true" if data.get("telegram_2fa_enabled") in (True, "true") else "false")
            
        # 3. Decoy Site Card
        if "decoy_type" in data:
            decoy_type = data.get("decoy_type")
            if decoy_type not in ("none", "static", "proxy", "redirect"):
                return {"success": False, "msg": "Неверный тип маскировки"}
            set_setting("decoy_type", decoy_type)
            
        if "decoy_value" in data:
            decoy_type = data.get("decoy_type", get_setting("decoy_type", "none"))
            decoy_value = data.get("decoy_value")
            if decoy_type in ("proxy", "redirect") and not decoy_value.startswith("http"):
                return {"success": False, "msg": "Для выбранного типа маскировки необходимо указать полный URL (http/https)"}
            set_setting("decoy_value", decoy_value)
            
        # 4. SSL Domain / Email
        if "ssl_domain" in data:
            set_setting("ssl_domain", data.get("ssl_domain"))
        if "ssl_email" in data:
            set_setting("ssl_email", data.get("ssl_email"))

        # 5. Backup Settings
        if "backup_enable" in data:
            set_setting("backup_enable", "true" if data.get("backup_enable") in (True, "true") else "false")
        if "backup_interval" in data:
            val = data.get("backup_interval")
            if val in ("hourly", "daily", "weekly"):
                set_setting("backup_interval", val)
        if "backup_rotation" in data:
            try:
                rot = int(data.get("backup_rotation"))
                if rot <= 0:
                    raise ValueError()
                set_setting("backup_rotation", str(rot))
                
                # Immediate rotation cleanup
                from backend.config import BASE_DIR
                backups_dir = BASE_DIR / "backups"
                if backups_dir.exists():
                    backup_files = sorted(
                        list(backups_dir.glob("backup_*.json")),
                        key=lambda x: x.stat().st_mtime
                    )
                    while len(backup_files) > rot:
                        oldest_file = backup_files.pop(0)
                        try:
                            oldest_file.unlink()
                        except Exception:
                            pass
            except ValueError:
                return {"success": False, "msg": "Количество бэкапов для ротации должно быть целым положительным числом"}
        if "backup_telegram" in data:
            set_setting("backup_telegram", "true" if data.get("backup_telegram") in (True, "true") else "false")
        if "backup_encrypt" in data:
            set_setting("backup_encrypt", "true" if data.get("backup_encrypt") in (True, "true") else "false")

        # 6. Quick Block Rules
        quick_block_changed = False
        for key in ["block_bittorrent", "block_ads", "block_cn", "block_ru", "block_us"]:
            if key in data:
                old_val = get_setting(key, "false")
                new_val = "true" if data.get(key) in (True, "true") else "false"
                if old_val != new_val:
                    set_setting(key, new_val)
                    quick_block_changed = True
                    
        if quick_block_changed:
            from backend.xray import write_xray_config, restart_xray
            from backend.hysteria import restart_hysteria
            write_xray_config()
            restart_xray()
            restart_hysteria()

        # Log action
        from backend.audit import log_action, get_actor_username
        actor = get_actor_username(request)
        log_action(actor, "update_settings", details=f"Keys: {list(data.keys())}")
        
        # Trigger Telegram bot restart if settings changed
        if tg_changed:
            from backend.bot_manager import restart_telegram_bot
            restart_telegram_bot()
            
        return {
            "success": True,
            "obj": None,
            "msg": "Настройки успешно сохранены!"
        }
    except Exception as e:
        return {"success": False, "msg": f"Ошибка сохранения настроек: {str(e)}"}

@router.post("/api/system/telegram/restart")
async def restart_telegram_bot_api(request: Request):
    if not backend.routes.system.check_auth(request):
        return backend.routes.system.decoy_response()
    
    try:
        from backend.bot_manager import restart_telegram_bot
        success = restart_telegram_bot()
        if success:
            from backend.audit import log_action, get_actor_username
            actor = get_actor_username(request)
            log_action(actor, "restart_telegram_bot", details="status:success")
            return {"success": True, "msg": "Telegram-бот успешно перезапущен!"}
        else:
            return {"success": False, "msg": "Не удалось запустить Telegram-бот. Проверьте логи."}
    except Exception as e:
        return {"success": False, "msg": f"Ошибка перезапуска бота: {str(e)}"}

@router.get("/api/locales")
async def get_locales_list_api(request: Request):
    referer = request.headers.get("referer", "")
    is_dev = "localhost" in referer or "127.0.0.1" in referer
    if not backend.routes.system.check_auth(request) and not is_dev and f"/{settings.PANEL_SECRET_PATH}" not in referer:
        return backend.routes.system.decoy_response()
    from backend.i18n import get_available_languages
    return {
        "success": True,
        "obj": get_available_languages()
    }

@router.get("/api/locales/{lang}")
async def get_locale_dict_api(request: Request, lang: str):
    referer = request.headers.get("referer", "")
    is_dev = "localhost" in referer or "127.0.0.1" in referer
    if not backend.routes.system.check_auth(request) and not is_dev and f"/{settings.PANEL_SECRET_PATH}" not in referer:
        return backend.routes.system.decoy_response()
    
    from backend.i18n import _translations
    lang_lower = lang.lower()
    lang_data = _translations.get(lang_lower)
    
    # Fallback to English if requested is not found, then Russian
    if not lang_data:
        lang_data = _translations.get("en", _translations.get("ru", {}))
        
    frontend_translations = lang_data.get("frontend", {})
    return {
        "success": True,
        "obj": frontend_translations
    }

@router.get("/api/system/bbr")
async def get_bbr_status_api(request: Request):
    if not backend.routes.system.check_auth(request):
        return backend.routes.system.decoy_response()
    res = host_client.send_command("get_bbr_status")
    return res

@router.post("/api/system/bbr/enable")
async def enable_bbr_api(request: Request):
    if not backend.routes.system.check_auth(request):
        return backend.routes.system.decoy_response()
    res = host_client.send_command("enable_bbr", timeout=15.0)
    from backend.audit import log_action, get_actor_username
    actor = get_actor_username(request)
    if res.get("success"):
        log_action(actor, "enable_bbr", details="status:success")
    else:
        log_action(actor, "enable_bbr", details=f"status:failed, error:{res.get('msg')}")
    return res

@router.get("/api/system/optimization/status")
async def get_optimization_status_api(request: Request):
    if not backend.routes.system.check_auth(request):
        return backend.routes.system.decoy_response()
    res = host_client.send_command("get_optimization_status")
    return res

@router.post("/api/system/optimization/apply")
async def apply_optimizations_api(request: Request):
    if not backend.routes.system.check_auth(request):
        return backend.routes.system.decoy_response()
    res = host_client.send_command("apply_optimizations", timeout=15.0)
    from backend.audit import log_action, get_actor_username
    actor = get_actor_username(request)
    if res.get("success"):
        log_action(actor, "apply_network_optimizations", details="status:success")
    else:
        log_action(actor, "apply_network_optimizations", details=f"status:failed, error:{res.get('msg')}")
    return res

@router.get("/api/system/backup/download")
async def download_backup_api(request: Request):
    if not backend.routes.system.check_auth(request):
        return backend.routes.system.decoy_response()
    try:
        from backend.backup import create_backup_dump
        from fastapi.responses import Response
        dump_str = create_backup_dump()
        return Response(
            content=dump_str,
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=panel_backup.json"}
        )
    except Exception as e:
        return {"success": False, "msg": f"Ошибка создания бэкапа: {str(e)}"}

@router.post("/api/system/backup/upload")
async def upload_backup_api(request: Request):
    if not backend.routes.system.check_auth(request):
        return backend.routes.system.decoy_response()
    try:
        form = await request.form()
        file = form.get("file")
        if not file:
            return {"success": False, "msg": "Файл не предоставлен"}
        content = await file.read()
        dump_str = content.decode("utf-8")
        
        if dump_str.startswith("enc1:"):
            password = form.get("password")
            if not password:
                password = get_setting("backup_password", "")
                
            if not password:
                return {
                    "success": False,
                    "code": "password_required",
                    "msg": "Файл резервной копии зашифрован. Требуется ввод пароля."
                }
                
            try:
                from backend.backup import decrypt_data
                dump_str = decrypt_data(dump_str, password)
            except Exception as e:
                import logging
                logging.error(f"[Backup Upload] Failed to decrypt backup data: {e}")
                return {
                    "success": False,
                    "code": "invalid_password",
                    "msg": "Неверный пароль для расшифровки резервной копии"
                }
                
        from backend.backup import restore_backup_dump
        success, msg = restore_backup_dump(dump_str)
        return {"success": success, "msg": msg}
    except Exception as e:
        return {"success": False, "msg": f"Ошибка загрузки бэкапа: {str(e)}"}

@router.post("/api/system/backup/clear")
async def clear_all_backups_api(request: Request):
    if not backend.routes.system.check_auth(request):
        return backend.routes.system.decoy_response()
    try:
        from backend.config import BASE_DIR
        backups_dir = BASE_DIR / "backups"
        count = 0
        if backups_dir.exists():
            for f in backups_dir.glob("backup_*.json"):
                try:
                    f.unlink()
                    count += 1
                except Exception:
                    pass
        
        # Log action
        from backend.audit import log_action, get_actor_username
        actor = get_actor_username(request)
        log_action(actor, "clear_all_backups", details=f"deleted:{count}")
        
        return {"success": True, "msg": f"Все локальные резервные копии ({count}) успешно удалены!"}
    except Exception as e:
        return {"success": False, "msg": f"Ошибка удаления бэкапов: {str(e)}"}

@router.post("/api/settings/backup/password")
async def change_backup_password_api(request: Request):
    if not backend.routes.system.check_auth(request):
        return backend.routes.system.decoy_response()
    try:
        data = await request.json()
        current_password = data.get("current_password", "").strip()
        new_password = data.get("new_password", "").strip()
        
        if not current_password or not new_password:
            return {"success": False, "msg": "Заполните все поля для смены пароля!"}
            
        stored_password = get_setting("backup_password", "")
        if current_password != stored_password:
            return {"success": False, "msg": "Неверный текущий пароль для шифрования бэкапов"}
            
        set_setting("backup_password", new_password)
        
        # Log action
        from backend.audit import log_action, get_actor_username
        actor = get_actor_username(request)
        log_action(actor, "change_backup_password", details="status:success")
        
        return {"success": True, "msg": "Пароль шифрования бэкапов успешно изменен!"}
    except Exception as e:
        return {"success": False, "msg": f"Ошибка смены пароля: {str(e)}"}

@router.get("/api/settings/telegram/token")
async def get_telegram_token_api(request: Request):
    if not backend.routes.system.check_auth(request):
        return backend.routes.system.decoy_response()
    try:
        token = get_setting("telegram_bot_token", "")
        return {"success": True, "token": token}
    except Exception as e:
        return {"success": False, "msg": f"Ошибка получения токена: {str(e)}"}
