import subprocess
from fastapi import APIRouter, Request

from backend.config import XRAY_BIN_PATH
from backend.xray import (
    restart_xray, get_xray_logs, is_xray_running,
    get_latest_xray_version_info, download_xray_core, stop_xray, start_xray,
    get_installed_xray_version
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


