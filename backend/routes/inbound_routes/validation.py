import json
import socket
import random
from typing import Optional
from fastapi import APIRouter, Request

from backend.database import get_all_inbounds
from backend.auth_utils import check_auth, decoy_response
from backend.config import settings

router = APIRouter()

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

@router.get("/api/system/free-port")
async def get_free_port(request: Request):
    if not check_auth(request):
        return decoy_response()
    start_port = random.randint(20000, 50000)
    for p in range(start_port, 65536):
        if validate_inbound_port_collision(p, "vless", {}) is None:
            return {"success": True, "port": p}
    for p in range(20000, start_port):
        if validate_inbound_port_collision(p, "vless", {}) is None:
            return {"success": True, "port": p}
    return {"success": False, "msg": "Не удалось подобрать свободный порт"}
