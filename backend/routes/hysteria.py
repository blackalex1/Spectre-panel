from fastapi import APIRouter, Request

from backend.hysteria import (
    restart_hysteria, get_hysteria_logs, is_hysteria_running,
    get_latest_hysteria_version_info, download_hysteria_core, stop_hysteria, start_hysteria,
    get_installed_hysteria_version
)
from backend.auth_utils import check_auth, decoy_response

router = APIRouter()

@router.get("/api/hysteria/status")
async def hysteria_status(request: Request):
    if not check_auth(request):
        return decoy_response()
    return {"running": is_hysteria_running()}

@router.post("/api/hysteria/action")
async def hysteria_action(request: Request, payload: dict):
    if not check_auth(request):
        return decoy_response()
        
    action = payload.get("action")
    if action == "restart":
        success = restart_hysteria()
    elif action == "stop":
        stop_hysteria()
        success = True
    elif action == "start":
        success = start_hysteria()
    else:
        return {"success": False, "msg": "Неверное действие"}
        
    return {"success": success}

@router.get("/api/hysteria/logs")
async def hysteria_logs(request: Request):
    if not check_auth(request):
        return decoy_response()
    logs = get_hysteria_logs()
    return {"success": True, "logs": logs}

@router.post("/api/hysteria/logs/clear")
async def clear_hysteria_logs(request: Request):
    if not check_auth(request):
        return decoy_response()
    try:
        from backend.config import HYSTERIA_LOG_PATH
        if HYSTERIA_LOG_PATH.exists():
            with open(HYSTERIA_LOG_PATH, "w", encoding="utf-8") as f:
                f.truncate(0)
        return {"success": True}
    except Exception as e:
        return {"success": False, "msg": str(e)}

@router.get("/api/hysteria/version")
async def hysteria_version(request: Request):
    if not check_auth(request):
        return decoy_response()
    info = get_latest_hysteria_version_info()
    current_installed = get_installed_hysteria_version()
    return {
        "success": True, 
        "current": current_installed, 
        "latest": info["version"] if info else "Unknown",
        "download_url": info["download_url"] if info else None
    }

@router.post("/api/hysteria/update")
async def hysteria_update(request: Request, payload: dict):
    if not check_auth(request):
        return decoy_response()
        
    download_url = payload.get("download_url")
    try:
        stop_hysteria()
        version = download_hysteria_core(download_url)
        start_hysteria()
        return {"success": True, "version": version}
    except Exception as e:
        start_hysteria()
        return {"success": False, "msg": str(e)}

@router.get("/api/hysteria/config")
async def hysteria_config(request: Request):
    if not check_auth(request):
        return decoy_response()
    
    try:
        import json
        from backend.database import get_all_inbounds, get_clients_for_inbound
        import backend.hysteria
        
        inbounds = get_all_inbounds()
        hysteria_inbounds = [ib for ib in inbounds if ib["protocol"] == "hysteria2" and ib["enable"]]
        
        configs_list = []
        for ib in hysteria_inbounds:
            ib_id = ib["id"]
            config_path = backend.hysteria.BIN_DIR / f"hysteria_{ib_id}.json"
            
            config_data = None
            if config_path.exists():
                try:
                    with open(config_path, "r", encoding="utf-8") as f:
                        config_data = json.load(f)
                except Exception:
                    pass
            
            if not config_data:
                clients = get_clients_for_inbound(ib_id)
                active_clients = [c for c in clients if c["enable"]]
                try:
                    stream_settings = json.loads(ib["stream_settings"] or "{}")
                except Exception:
                    stream_settings = {}
                config_data = backend.hysteria.generate_hysteria_config(
                    ib_id, ib["port"], active_clients, stream_settings
                )
                
            configs_list.append({
                "inbound_id": ib_id,
                "port": ib["port"],
                "remark": ib["remark"],
                "config": config_data
            })
            
        return {"success": True, "configs": configs_list}
    except Exception as e:
        return {"success": False, "msg": f"Ошибка: {e}"}

@router.post("/api/hysteria/config")
async def save_hysteria_config(request: Request, payload: dict):
    if not check_auth(request):
        return decoy_response()
        
    inbound_id = payload.get("inbound_id")
    config = payload.get("config")
    if inbound_id is None or not config:
        return {"success": False, "msg": "Неверные параметры"}
        
    try:
        import json
        import backend.hysteria
        from backend.database import set_setting
        
        config_path = backend.hysteria.BIN_DIR / f"hysteria_{inbound_id}.json"
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
            
        set_setting(f"use_custom_hysteria_config_{inbound_id}", "true")
        
        from backend.hysteria import restart_hysteria
        success = restart_hysteria()
        return {"success": success}
    except Exception as e:
        return {"success": False, "msg": str(e)}

@router.post("/api/hysteria/config/reset")
async def reset_hysteria_config(request: Request, payload: dict):
    if not check_auth(request):
        return decoy_response()
        
    inbound_id = payload.get("inbound_id")
    if inbound_id is None:
        return {"success": False, "msg": "Не указан inbound_id"}
        
    try:
        from backend.database import set_setting
        set_setting(f"use_custom_hysteria_config_{inbound_id}", "false")
        
        from backend.hysteria import restart_hysteria
        success = restart_hysteria()
        return {"success": success}
    except Exception as e:
        return {"success": False, "msg": str(e)}


@router.post("/api/hysteria/auth")
async def hysteria_client_auth(request: Request, payload: dict):
    from fastapi.responses import JSONResponse
    from backend.database import db_session
    from backend.models import ClientStats
    
    # Разрешаем доступ только локально
    client_host = request.client.host if request.client else None
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        return JSONResponse(status_code=403, content={"msg": "Forbidden"})
        
    auth_str = payload.get("auth", "")
    if not auth_str or ":" not in auth_str:
        return {"ok": False}
        
    email, password = auth_str.split(":", 1)
    
    with db_session() as session:
        # Проверяем, существует ли клиент с таким email и паролем, и включен ли он
        client = session.query(ClientStats).filter_by(email=email, client_uuid_or_pwd=password).first()
        if client and client.enable == 1:
            return {"ok": True, "id": email}
            
    return {"ok": False}



