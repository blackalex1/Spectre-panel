import json
from typing import Optional
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from backend.database import (
    get_all_inbounds, get_clients_for_inbound, add_inbound, update_inbound, delete_inbound
)
from backend.xray import restart_xray
from backend.hysteria import restart_hysteria
from backend.auth_utils import check_auth, decoy_response
from backend.routes.inbound_routes.validation import validate_inbound_port_collision

router = APIRouter()

class InboundCreate(BaseModel):
    remark: str
    port: int
    protocol: str
    settings: dict
    streamSettings: Optional[dict] = Field(default_factory=dict)
    sniffing: Optional[dict] = Field(default_factory=dict)
    total: Optional[int] = 0
    expiryTime: Optional[int] = 0

class InboundUpdate(BaseModel):
    remark: str
    port: int
    protocol: str
    settings: dict
    streamSettings: Optional[dict] = Field(default_factory=dict)
    sniffing: Optional[dict] = Field(default_factory=dict)
    enable: Optional[int] = 1
    total: Optional[int] = 0
    expiryTime: Optional[int] = 0

@router.get("/panel/api/inbounds/list")
async def list_inbounds_api(request: Request):
    if not check_auth(request):
        return decoy_response()
        
    inbounds = get_all_inbounds()
    obj_list = []
    
    for ib in inbounds:
        ib_id = ib["id"]
        clients = get_clients_for_inbound(ib_id)
        
        # Формируем settings.clients для совместимости
        db_settings_dict = json.loads(ib["settings"] or "{}")
        db_clients_list = db_settings_dict.get("clients", [])
        
        settings_dict = db_settings_dict.copy()
        settings_dict["clients"] = []
        for c in clients:
            flow = ""
            for dc in db_clients_list:
                if dc.get("email") == c["email"]:
                    flow = dc.get("flow", "")
                    break
            settings_dict["clients"].append({
                "id": c["client_uuid_or_pwd"],
                "email": c["email"],
                "enable": bool(c["enable"]),
                "limitIp": c["limit_ip"],
                "totalGB": int(c["total"] / (1024**3)) if c["total"] > 0 else 0,
                "expiryTime": c["expiry_time"],
                "flow": flow
            })
        
        # clientStats содержит статистику трафика по клиентам
        client_stats_list = [
            {
                "id": c["id"],
                "inboundId": ib_id,
                "email": c["email"],
                "up": c["up"],
                "down": c["down"],
                "total": c["total"],
                "expiryTime": c["expiry_time"],
                "enable": bool(c["enable"])
            } for c in clients
        ]
        
        obj_list.append({
            "id": ib_id,
            "up": ib["up"],
            "down": ib["down"],
            "total": ib["total"],
            "remark": ib["remark"],
            "enable": bool(ib["enable"]),
            "port": ib["port"],
            "protocol": ib["protocol"],
            "settings": json.dumps(settings_dict),
            "streamSettings": ib["stream_settings"],
            "sniffing": ib["sniffing"],
            "expiryTime": ib["expiry_time"],
            "clientStats": client_stats_list
        })
        
    return {"success": True, "obj": obj_list}

@router.post("/api/inbounds/create")
async def create_inbound_ui(request: Request, payload: InboundCreate):
    if not check_auth(request):
        return decoy_response()
        
    stream_settings = payload.streamSettings or {}
    
    # Run collision check
    err = validate_inbound_port_collision(payload.port, payload.protocol, stream_settings)
    if err:
        return {"success": False, "msg": err}
        
    if payload.protocol == "hysteria2":
        hysteria_opts = stream_settings.get("hysteria", {})
        if hysteria_opts.get("routingViaXray"):
            import secrets
            if not hysteria_opts.get("socksUsername"):
                hysteria_opts["socksUsername"] = secrets.token_hex(12)
            if not hysteria_opts.get("socksPassword"):
                hysteria_opts["socksPassword"] = secrets.token_hex(16)
            stream_settings["hysteria"] = hysteria_opts
            
    inbound_id = add_inbound(
        remark=payload.remark,
        port=payload.port,
        protocol=payload.protocol,
        settings_dict=payload.settings,
        stream_settings_dict=stream_settings,
        sniffing_dict=payload.sniffing,
        total=payload.total,
        expiry_time=payload.expiryTime
    )
    if inbound_id:
        from backend.audit import log_action, get_actor_username
        actor = get_actor_username(request)
        log_action(actor, "create_inbound", target=f"port:{payload.port}", details=f"remark:{payload.remark}, protocol:{payload.protocol}")
        restart_xray()
        restart_hysteria()
        return {"success": True, "id": inbound_id}
    return {"success": False, "msg": "Порт уже занят или неверные параметры"}

@router.post("/panel/api/inbounds/update/{inbound_id}")
async def update_inbound_ui(request: Request, inbound_id: int, payload: InboundUpdate):
    if not check_auth(request):
        return decoy_response()
        
    stream_settings = payload.streamSettings or {}
    
    # Run collision check
    err = validate_inbound_port_collision(payload.port, payload.protocol, stream_settings, exclude_inbound_id=inbound_id)
    if err:
        return {"success": False, "msg": err}
        
    if payload.protocol == "hysteria2":
        hysteria_opts = stream_settings.get("hysteria", {})
        if hysteria_opts.get("routingViaXray"):
            import secrets
            if not hysteria_opts.get("socksUsername"):
                hysteria_opts["socksUsername"] = secrets.token_hex(12)
            if not hysteria_opts.get("socksPassword"):
                hysteria_opts["socksPassword"] = secrets.token_hex(16)
            stream_settings["hysteria"] = hysteria_opts
            
    success = update_inbound(
        inbound_id=inbound_id,
        remark=payload.remark,
        port=payload.port,
        protocol=payload.protocol,
        settings_dict=payload.settings,
        stream_settings_dict=stream_settings,
        sniffing_dict=payload.sniffing,
        enable=payload.enable,
        total=payload.total,
        expiry_time=payload.expiryTime
    )
    if success:
        from backend.audit import log_action, get_actor_username
        actor = get_actor_username(request)
        log_action(actor, "update_inbound", target=f"id:{inbound_id}", details=f"remark:{payload.remark}, port:{payload.port}, protocol:{payload.protocol}, enable:{payload.enable}")
        restart_xray()
        restart_hysteria()
        return {"success": True}
    return {"success": False, "msg": "Inbound не найден или порт уже занят"}

@router.post("/api/inbounds/delete/{inbound_id}")
async def delete_inbound_ui(request: Request, inbound_id: int):
    if not check_auth(request):
        return decoy_response()
    if delete_inbound(inbound_id):
        from backend.audit import log_action, get_actor_username
        actor = get_actor_username(request)
        log_action(actor, "delete_inbound", target=f"id:{inbound_id}")
        restart_xray()
        restart_hysteria()
        return {"success": True}
    return {"success": False, "msg": "Inbound не найден"}
