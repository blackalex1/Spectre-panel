import subprocess
from fastapi import APIRouter, Request

from backend.config import XRAY_BIN_PATH
from backend.xray import (
    restart_xray, get_xray_logs, is_xray_running,
    get_latest_xray_version_info, download_xray_core, stop_xray, start_xray,
    get_installed_xray_version, download_geo_files, get_geo_files_info
)
from backend.hysteria import restart_hysteria
from backend.auth_utils import check_auth, decoy_response

router = APIRouter()

@router.get("/api/xray/status")
async def xray_status(request: Request):
    if not check_auth(request):
        return decoy_response()
    return {"running": is_xray_running()}

@router.post("/api/xray/action")
async def xray_action(request: Request, payload: dict):
    if not check_auth(request):
        return decoy_response()
        
    action = payload.get("action")
    if action == "restart":
        success = restart_xray()
        restart_hysteria()
    elif action == "stop":
        stop_xray()
        success = True
    elif action == "start":
        success = start_xray()
    else:
        return {"success": False, "msg": "Неверное действие"}
        
    return {"success": success}

@router.get("/api/xray/logs")
async def xray_logs(request: Request):
    if not check_auth(request):
        return decoy_response()
    logs = get_xray_logs()
    return {"success": True, "logs": logs}

@router.post("/api/xray/logs/clear")
async def clear_xray_logs(request: Request):
    if not check_auth(request):
        return decoy_response()
    try:
        from backend.config import XRAY_LOG_PATH
        if XRAY_LOG_PATH.exists():
            with open(XRAY_LOG_PATH, "w", encoding="utf-8") as f:
                f.truncate(0)
        return {"success": True}
    except Exception as e:
        return {"success": False, "msg": str(e)}

@router.get("/api/xray/version")
async def xray_version(request: Request):
    if not check_auth(request):
        return decoy_response()
    info = get_latest_xray_version_info()
    current_installed = get_installed_xray_version()
    return {
        "success": True, 
        "current": current_installed, 
        "latest": info["version"] if info else "Unknown",
        "download_url": info["download_url"] if info else None
    }

@router.post("/api/xray/update")
async def xray_update(request: Request, payload: dict):
    if not check_auth(request):
        return decoy_response()
        
    download_url = payload.get("download_url")
    try:
        stop_xray()
        version = download_xray_core(download_url)
        start_xray()
        return {"success": True, "version": version}
    except Exception as e:
        start_xray()
        return {"success": False, "msg": str(e)}

@router.get("/api/xray/x25519")
async def generate_x25519_keys(request: Request):
    if not check_auth(request):
        return decoy_response()
    try:
        cmd = [str(XRAY_BIN_PATH), "x25519"]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", timeout=5)  # nosec B603
        if result.returncode == 0:
            lines = result.stdout.split("\n")
            private_key = ""
            public_key = ""
            for line in lines:
                if ":" in line:
                    prefix, value = line.split(":", 1)
                    prefix_clean = prefix.lower().replace(" ", "")
                    if "privatekey" in prefix_clean:
                        private_key = value.strip()
                    elif "publickey" in prefix_clean:
                        public_key = value.strip()
            return {"success": True, "privateKey": private_key, "publicKey": public_key}
        return {"success": False, "msg": "Не удалось сгенерировать ключи"}
    except Exception as e:
        return {"success": False, "msg": f"Ошибка: {e}"}

@router.get("/api/xray/vlessenc")
async def generate_vlessenc_keys(request: Request):
    if not check_auth(request):
        return decoy_response()
    try:
        cmd = [str(XRAY_BIN_PATH), "vlessenc"]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", timeout=5)  # nosec B603
        if result.returncode == 0:
            lines = result.stdout.split("\n")
            auth_type = None
            data = {
                "x25519": {"decryption": "", "encryption": ""},
                "mlkem768": {"decryption": "", "encryption": ""}
            }
            for line in lines:
                line_clean = line.strip()
                if "Authentication: X25519" in line_clean:
                    auth_type = "x25519"
                elif "Authentication: ML-KEM-768" in line_clean:
                    auth_type = "mlkem768"
                elif auth_type and ":" in line_clean:
                    parts = line_clean.split(":", 1)
                    key = parts[0].strip().replace('"', '')
                    val = parts[1].strip().replace('"', '').replace(',', '')
                    if key in ("decryption", "encryption"):
                        data[auth_type][key] = val
            return {
                "success": True,
                "x25519": data["x25519"],
                "mlkem768": data["mlkem768"]
            }
        return {"success": False, "msg": "Не удалось сгенерировать VLESS-Encryption ключи"}
    except Exception as e:
        return {"success": False, "msg": f"Ошибка: {e}"}

@router.get("/api/xray/config")
async def xray_config(request: Request):
    if not check_auth(request):
        return decoy_response()
    
    import json
    from backend.config import XRAY_CONFIG_PATH
    from backend.xray.config import generate_xray_config_json
    
    config_data = None
    if XRAY_CONFIG_PATH.exists():
        try:
            with open(XRAY_CONFIG_PATH, "r", encoding="utf-8") as f:
                config_data = json.load(f)
        except Exception as e:
            return {"success": False, "msg": f"Ошибка чтения конфигурационного файла: {e}"}
            
    if not config_data:
        try:
            config_data = generate_xray_config_json()
        except Exception as e:
            return {"success": False, "msg": f"Ошибка генерации конфигурации: {e}"}
            
    return {"success": True, "config": config_data}

@router.post("/api/xray/config")
async def save_xray_config(request: Request, payload: dict):
    if not check_auth(request):
        return decoy_response()
        
    config = payload.get("config")
    if not config:
        return {"success": False, "msg": "Не указана конфигурация"}
        
    try:
        import json
        from backend.config import XRAY_CONFIG_PATH
        from backend.xray import restart_xray
        from backend.database import set_setting
        
        with open(XRAY_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
            
        set_setting("use_custom_xray_config", "true")
        
        success = restart_xray()
        return {"success": success}
    except Exception as e:
        return {"success": False, "msg": str(e)}

@router.post("/api/xray/config/reset")
async def reset_xray_config(request: Request):
    if not check_auth(request):
        return decoy_response()
        
    try:
        from backend.database import set_setting
        from backend.xray import restart_xray
        
        set_setting("use_custom_xray_config", "false")
        
        success = restart_xray()
        return {"success": success}
    except Exception as e:
        return {"success": False, "msg": str(e)}


# --- Geo Files API ---

@router.get("/api/xray/geo")
async def get_geo_info(request: Request):
    """Возвращает информацию об установленных geo-файлах и текущих URL источников."""
    if not check_auth(request):
        return decoy_response()
    try:
        info = get_geo_files_info()
        return {"success": True, "obj": info}
    except Exception as e:
        return {"success": False, "msg": str(e)}


@router.post("/api/xray/geo/settings")
async def save_geo_settings(request: Request, payload: dict):
    """Сохраняет кастомные URL для geoip.dat и geosite.dat."""
    if not check_auth(request):
        return decoy_response()
    try:
        from backend.database import set_setting
        from urllib.parse import urlparse

        geoip_url = payload.get("geoip_url", "").strip()
        geosite_url = payload.get("geosite_url", "").strip()

        for label, url in (("geoip_url", geoip_url), ("geosite_url", geosite_url)):
            if url:
                parsed = urlparse(url)
                if parsed.scheme not in ("https", "http"):
                    return {"success": False, "msg": f"Недопустимый протокол в {label}: используйте https://"}
                if not url.lower().endswith(".dat"):
                    return {"success": False, "msg": f"{label} должен указывать на .dat файл"}

        # Сохраняем (пустая строка = вернуться к дефолтному URL)
        set_setting("geo_geoip_url", geoip_url)
        set_setting("geo_geosite_url", geosite_url)

        from backend.audit import log_action, get_actor_username
        actor = get_actor_username(request)
        log_action(actor, "update_geo_settings",
                   details=f"geoip_url:{geoip_url or 'default'}, geosite_url:{geosite_url or 'default'}")

        return {"success": True}
    except Exception as e:
        return {"success": False, "msg": str(e)}


@router.post("/api/xray/geo/update")
async def update_geo_files(request: Request):
    """Скачивает/обновляет geoip.dat и geosite.dat по настроенным URL."""
    if not check_auth(request):
        return decoy_response()
    try:
        result = download_geo_files()

        from backend.audit import log_action, get_actor_username
        actor = get_actor_username(request)
        log_action(actor, "update_geo_files",
                   details=f"geoip:{result['geoip']}, geosite:{result['geosite']}")

        if result["geoip"] or result["geosite"]:
            # Перезапускаем Xray чтобы применить новые geo-файлы
            restart_xray()

        msg_parts = []
        if result["geoip"]:
            msg_parts.append("geoip.dat — обновлён")
        if result["geosite"]:
            msg_parts.append("geosite.dat — обновлён")
        if result["errors"]:
            msg_parts.extend(result["errors"])

        success = result["geoip"] and result["geosite"]
        return {
            "success": success,
            "partial": result["geoip"] or result["geosite"],
            "msg": "; ".join(msg_parts) if msg_parts else "Ошибка обновления",
            "info": get_geo_files_info()
        }
    except Exception as e:
        return {"success": False, "msg": str(e)}
