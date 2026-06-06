import json
import socket
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from typing import Optional

from backend.database import get_all_inbounds, get_clients_for_inbound, add_inbound, update_inbound, delete_inbound
from backend.xray import restart_xray
from backend.hysteria import restart_hysteria
from backend.auth_utils import check_auth, decoy_response
from backend.config import settings

def parse_hop_ports(hop_str: str) -> set:
    ports = set()
    if not hop_str:
        return ports
    parts = hop_str.split(",")
    for part in parts:
        part = part.strip()
        if "-" in part:
            try:
                start, end = part.split("-")
                start = int(start.strip())
                end = int(end.strip())
                if 1 <= start <= 65535 and 1 <= end <= 65535:
                    if end - start < 1000:
                        ports.update(range(start, end + 1))
                    else:
                        ports.update(range(start, start + 1000))
            except ValueError:
                pass
        else:
            try:
                p = int(part)
                if 1 <= p <= 65535:
                    ports.add(p)
            except ValueError:
                pass
    return ports

def validate_inbound_port_collision(
    port: int,
    protocol: str,
    stream_settings: dict,
    exclude_inbound_id: int = None
) -> Optional[str]:
    all_ibs = get_all_inbounds()
    
    # 1. Check database for direct port conflicts
    for ib in all_ibs:
        if exclude_inbound_id and ib["id"] == exclude_inbound_id:
            continue
        if ib["port"] == port:
            return f"Порт {port} уже занят подключением '{ib['remark']}'"
            
    # 2. Check conflict with system/API/panel ports
    if port == 10085:
        return "Порт 10085 зарезервирован для Xray API"
    if port == settings.PANEL_PORT:
        return f"Порт {port} занят веб-панелью управления"
        
    # 3. Check conflict with Hysteria SOCKS routing ports
    for ib in all_ibs:
        if exclude_inbound_id and ib["id"] == exclude_inbound_id:
            continue
        if ib["protocol"] == "hysteria2":
            try:
                ib_stream = json.loads(ib["stream_settings"] or "{}")
                if ib_stream.get("hysteria", {}).get("routingViaXray"):
                    socks_port = 20000 + ib["id"]
                    if port == socks_port:
                        return f"Порт {port} зарезервирован для SOCKS-маршрутизации подключения Hysteria 2 '{ib['remark']}'"
            except Exception:
                pass

    # 4. Check Hysteria 2 hop ports conflicts
    new_hop_str = ""
    if protocol == "hysteria2":
        new_hop_str = stream_settings.get("hysteria", {}).get("hop", "")
    new_hop_ports = parse_hop_ports(new_hop_str)
    
    # Check if the new main port conflicts with any existing hop ports
    for ib in all_ibs:
        if exclude_inbound_id and ib["id"] == exclude_inbound_id:
            continue
        if ib["protocol"] == "hysteria2":
            try:
                ib_stream = json.loads(ib["stream_settings"] or "{}")
                ib_hop_str = ib_stream.get("hysteria", {}).get("hop", "")
                ib_hop_ports = parse_hop_ports(ib_hop_str)
                if port in ib_hop_ports:
                    return f"Порт {port} пересекается с hop-портами подключения Hysteria 2 '{ib['remark']}'"
                
                # Check if our new hop ports conflict with this existing inbound's main port
                if new_hop_ports and ib["port"] in new_hop_ports:
                    return f"Hop-порт {ib['port']} уже занят подключением '{ib['remark']}'"
                    
                # Check if our new hop ports conflict with this existing inbound's hop ports
                overlap = new_hop_ports.intersection(ib_hop_ports)
                if overlap:
                    first_overlap = next(iter(overlap))
                    return f"Hop-порт {first_overlap} пересекается с hop-портами Hysteria 2 '{ib['remark']}'"
            except Exception:
                pass

    # Check if the new hop ports conflict with Xray API or panel ports
    if 10085 in new_hop_ports:
        return "Hop-порт 10085 зарезервирован для Xray API"
    if settings.PANEL_PORT in new_hop_ports:
        return f"Hop-порт {settings.PANEL_PORT} занят веб-панелью управления"

    # 5. OS Socket Bind Check (only if port is new or changed)
    is_new_port = True
    if exclude_inbound_id:
        existing_ib = next((ib for ib in all_ibs if ib["id"] == exclude_inbound_id), None)
        if existing_ib and existing_ib["port"] == port:
            is_new_port = False
            
    if is_new_port:
        is_udp_only = (protocol == "hysteria2")
        if not is_udp_only:
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(0.5)
                    s.bind(("0.0.0.0", port))
            except OSError:
                return f"Порт {port} (TCP) уже занят другим процессом в ОС (например, Nginx/SSH)"
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.settimeout(0.5)
                s.bind(("0.0.0.0", port))
        except OSError:
            return f"Порт {port} (UDP) уже занят другим процессом в ОС"

        # Check hop ports in OS
        for hp in new_hop_ports:
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                    s.settimeout(0.5)
                    s.bind(("0.0.0.0", hp))
            except OSError:
                return f"Hop-порт {hp} (UDP) уже занят другим процессом в ОС"

    return None

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

@router.get("/api/system/free-port")
async def get_free_port(request: Request):
    if not check_auth(request):
        return decoy_response()
    import random
    start_port = random.randint(20000, 50000)
    for p in range(start_port, 65536):
        if validate_inbound_port_collision(p, "vless", {}) is None:
            return {"success": True, "port": p}
    for p in range(20000, start_port):
        if validate_inbound_port_collision(p, "vless", {}) is None:
            return {"success": True, "port": p}
    return {"success": False, "msg": "Не удалось подобрать свободный порт"}

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
        
        settings_dict = {}
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
                "tgId": "",
                "subId": "",
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
