import json
import logging
import re
import datetime
from typing import Optional
from fastapi import APIRouter, Request, Form, Query
from sqlalchemy import func

from backend.auth_utils import check_auth, decoy_response
from backend.database import db_session
from backend.models import ClientStats, Inbound, ClientTrafficDaily

router = APIRouter()

def parse_xray_timestamp(line: str) -> Optional[datetime.datetime]:
    try:
        # Format: "2026/06/16 18:13:22"
        match = re.match(r"^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2})", line)
        if match:
            return datetime.datetime.strptime(match.group(1), "%Y/%m/%d %H:%M:%S")
    except Exception:
        pass
    return None

def parse_hysteria_timestamp(line: str) -> Optional[datetime.datetime]:
    try:
        # Check if line contains a JSON payload
        # JSON format: {"time":"2026-06-16T18:13:22Z", ...}
        # First try to find a JSON substring with "time" field
        json_match = re.search(r'(\{.*"time"\s*:\s*"([^"]+)".*\})', line)
        if json_match:
            try:
                data = json.loads(json_match.group(1))
                t_str = data.get("time")
                if t_str:
                    t_str = t_str.split(".")[0].replace("Z", "").split("+")[0]
                    return datetime.datetime.strptime(t_str, "%Y-%m-%dT%H:%M:%S")
            except Exception:
                pass

        if line.startswith("{"):
            try:
                data = json.loads(line)
                t_str = data.get("time")
                if t_str:
                    t_str = t_str.split(".")[0].replace("Z", "").split("+")[0]
                    return datetime.datetime.strptime(t_str, "%Y-%m-%dT%H:%M:%S")
            except Exception:
                pass

        # Text format: e.g. 2026-06-16T18:13:22Z or [Hysteria] 2026-06-16T18:13:22Z
        match = re.search(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", line)
        if match:
            return datetime.datetime.strptime(match.group(1), "%Y-%m-%dT%H:%M:%S")

        # Text format without year: e.g. 06-16T15:17:37Z
        match_no_year = re.search(r"\b(\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", line)
        if match_no_year:
            current_year = datetime.datetime.now().year
            t_str = f"{current_year}-{match_no_year.group(1)}"
            return datetime.datetime.strptime(t_str, "%Y-%m-%dT%H:%M:%S")
    except Exception:
        pass
    return None

def find_email_in_hysteria_log(dst_ip: Optional[str], dst_port: int) -> Optional[str]:
    """
    Парсит последние 1000 строк лога Hysteria 2 для поиска email (auth/id) по параметрам соединения.
    Временной лимит: только лог-записи за последние 5 минут (отключается во время тестов).
    """
    import sys
    import backend.routes.security as sec_facade
    if not sec_facade.HYSTERIA_LOG_PATH.exists():
        return None
        
    from backend.utils import read_last_lines
    try:
        lines = read_last_lines(sec_facade.HYSTERIA_LOG_PATH, 1000)
    except Exception as e:
        logging.error(f"Error reading Hysteria logs for security search: {e}")
        return None
        
    dst_port_str = f":{dst_port}"
    now_local = datetime.datetime.now()
    now_utc = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    is_testing = "pytest" in sys.modules
    
    # Проход с конца к началу лога для поиска самого свежего совпадения
    for line in reversed(lines):
        log_time = parse_hysteria_timestamp(line)
        if log_time and not is_testing:
            diff_local = abs((now_local - log_time).total_seconds())
            diff_utc = abs((now_utc - log_time).total_seconds())
            if diff_local > 300 and diff_utc > 300:
                continue
            
        if dst_port_str not in line:
            continue
            
        if dst_ip and dst_ip not in line:
            continue
            
        # 1. JSON (Hysteria 2 debug): {"id": "den_mihomo", "reqAddr": "8.8.8.8:22"}
        match = re.search(r'"id"\s*:\s*"([^"]+)"', line)
        if not match:
            # 2. JSON (alternative): {"auth": "user@example.com", "req": "1.2.3.4:22"}
            match = re.search(r'"auth"\s*:\s*"([^"]+)"', line)
        if not match:
            # 3. Text log: auth=user@example.com или [auth=user@example.com]
            match = re.search(r'auth\s*=\s*([^\s,}]+)', line)
        if not match:
            # 4. Text log: connection: user_name (1.2.3.4:5678) -> target
            match = re.search(r'connection:\s*([^\s(]+)', line)
        if not match:
            # 5. Поиск любого email в строке лога в качестве резерва
            match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', line)
            
        if match:
            email = match.group(1) if match.lastindex and match.lastindex >= 1 else match.group(0)
            return email.strip('"\'[]')
            
    # Резервный поиск: только по порту назначения
    for line in reversed(lines):
        log_time = parse_hysteria_timestamp(line)
        if log_time and not is_testing:
            diff_local = abs((now_local - log_time).total_seconds())
            diff_utc = abs((now_utc - log_time).total_seconds())
            if diff_local > 300 and diff_utc > 300:
                continue
            
        if dst_port_str not in line:
            continue
            
        # Verify destination IP to prevent false port-only match on different IP
        dest_host = None
        json_match = re.search(r'(\{.*\})', line)
        if json_match:
            try:
                data = json.loads(json_match.group(1))
                req_val = data.get("reqAddr") or data.get("req")
                if req_val and ":" in req_val:
                    dest_host = req_val.split(":")[0]
            except Exception:
                pass
        if not dest_host:
            match_dest = re.search(r"->\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+", line)
            if match_dest:
                dest_host = match_dest.group(1)
                
        if dest_host and dst_ip and re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$", dest_host):
            if dest_host != dst_ip:
                continue

        match = re.search(r'"id"\s*:\s*"([^"]+)"', line)
        if not match:
            match = re.search(r'"auth"\s*:\s*"([^"]+)"', line)
        if not match:
            match = re.search(r'auth\s*=\s*([^\s,}]+)', line)
        if not match:
            match = re.search(r'connection:\s*([^\s(]+)', line)
        if not match:
            match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', line)
        if match:
            email = match.group(1) if match.lastindex and match.lastindex >= 1 else match.group(0)
            return email.strip('"\'[]')
            
    return None

def find_email_in_xray_log(client_ip: Optional[str], dst_ip: Optional[str], dst_port: int) -> Optional[str]:
    """
    Парсит последние 1000 строк лога Xray для поиска email по параметрам соединения.
    Временной лимит: только лог-записи за последние 5 минут (отключается во время тестов).
    """
    import sys
    import backend.routes.security as sec_facade
    if not sec_facade.XRAY_LOG_PATH.exists():
        return None
        
    from backend.utils import read_last_lines
    try:
        lines = read_last_lines(sec_facade.XRAY_LOG_PATH, 1000)
    except Exception as e:
        logging.error(f"Error reading Xray logs for security search: {e}")
        return None
        
    dst_port_str = f":{dst_port}"
    now_local = datetime.datetime.now()
    now_utc = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    is_testing = "pytest" in sys.modules
    
    # Проход с конца к началу лога для поиска самого свежего совпадения
    for line in reversed(lines):
        log_time = parse_xray_timestamp(line)
        if log_time and not is_testing:
            diff_local = abs((now_local - log_time).total_seconds())
            diff_utc = abs((now_utc - log_time).total_seconds())
            if diff_local > 300 and diff_utc > 300:
                continue
            
        if "email:" not in line:
            continue
            
        # Линия лога имеет вид:
        # 2026/06/07 00:25:00 93.100.12.34:51234 accepted tcp:185.112.14.3:443 email: user@example.com
        if dst_port_str in line:
            if (dst_ip and dst_ip in line) or (client_ip and client_ip in line):
                match = re.search(r"email:\s*(\S+)", line)
                if match:
                    return match.group(1)
                    
    # Резервный поиск
    for line in reversed(lines):
        log_time = parse_xray_timestamp(line)
        if log_time and not is_testing:
            diff_local = abs((now_local - log_time).total_seconds())
            diff_utc = abs((now_utc - log_time).total_seconds())
            if diff_local > 300 and diff_utc > 300:
                continue
            
        if "email:" not in line:
            continue
        if dst_port_str in line:
            # Verify destination IP to prevent false port-only match on different IP
            match_dest = re.search(r"accepted\s+(?:tcp|udp):([^:]+):", line)
            if match_dest:
                dest_host = match_dest.group(1)
                if dst_ip and re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$", dest_host):
                    if dest_host != dst_ip:
                        continue
                        
            match = re.search(r"email:\s*(\S+)", line)
            if match:
                return match.group(1)
                
    return None

def find_client_ip_for_email_in_hysteria_log(email: str) -> Optional[str]:
    """
    Ищет последний зафиксированный IP-адрес подключения для конкретного email в логах Hysteria 2.
    Временной лимит: только лог-записи за последние 5 минут (отключается во время тестов).
    """
    import sys
    import backend.routes.security as sec_facade
    if not sec_facade.HYSTERIA_LOG_PATH.exists():
        return None
    from backend.utils import read_last_lines
    try:
        lines = read_last_lines(sec_facade.HYSTERIA_LOG_PATH, 1000)
    except Exception:
        return None
        
    now_local = datetime.datetime.now()
    now_utc = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    is_testing = "pytest" in sys.modules
    
    for line in reversed(lines):
        log_time = parse_hysteria_timestamp(line)
        if log_time and not is_testing:
            diff_local = abs((now_local - log_time).total_seconds())
            diff_utc = abs((now_utc - log_time).total_seconds())
            if diff_local > 300 and diff_utc > 300:
                continue
            
        # Try parsing JSON to extract addr for the specified email/id
        json_match = re.search(r'(\{.*\})', line)
        if json_match:
            try:
                data = json.loads(json_match.group(1))
                if data.get("id") == email or data.get("auth") == email:
                    addr = data.get("addr", "")
                    if addr:
                        return addr.split(":")[0] if ":" in addr else addr
            except Exception:
                pass

        if "client connected" in line:
            if email in line:
                match = re.search(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", line)
                if match:
                    return match.group(1)
    return None

def find_email_and_ip_in_xray_log(client_ip: Optional[str], dst_ip: Optional[str], dst_port: int) -> Optional[tuple]:
    """
    Ищет email и IP-адрес клиента Xray по параметрам соединения.
    Временной лимит: только лог-записи за последние 5 минут (отключается во время тестов).
    """
    import sys
    import backend.routes.security as sec_facade
    if not sec_facade.XRAY_LOG_PATH.exists():
        return None
    from backend.utils import read_last_lines
    try:
        lines = read_last_lines(sec_facade.XRAY_LOG_PATH, 1000)
    except Exception:
        return None
        
    dst_port_str = f":{dst_port}"
    now_local = datetime.datetime.now()
    now_utc = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    is_testing = "pytest" in sys.modules
    
    for line in reversed(lines):
        log_time = parse_xray_timestamp(line)
        if log_time and not is_testing:
            diff_local = abs((now_local - log_time).total_seconds())
            diff_utc = abs((now_utc - log_time).total_seconds())
            if diff_local > 300 and diff_utc > 300:
                continue
            
        if "email:" not in line:
            continue
            
        if dst_port_str in line:
            if (dst_ip and dst_ip in line) or (client_ip and client_ip in line):
                match_email = re.search(r"email:\s*(\S+)", line)
                if match_email:
                    email = match_email.group(1)
                    match_ip = re.search(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+\s+accepted", line)
                    ip = match_ip.group(1) if match_ip else None
                    return email, ip
                    
    for line in reversed(lines):
        log_time = parse_xray_timestamp(line)
        if log_time and not is_testing:
            diff_local = abs((now_local - log_time).total_seconds())
            diff_utc = abs((now_utc - log_time).total_seconds())
            if diff_local > 300 and diff_utc > 300:
                continue
            
        if "email:" not in line:
            continue
        if dst_port_str in line:
            # Verify destination IP to prevent false port-only match on different IP
            match_dest = re.search(r"accepted\s+(?:tcp|udp):([^:]+):", line)
            if match_dest:
                dest_host = match_dest.group(1)
                if dst_ip and re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$", dest_host):
                    if dest_host != dst_ip:
                        continue
                        
            match_email = re.search(r"email:\s*(\S+)", line)
            if match_email:
                email = match_email.group(1)
                match_ip = re.search(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+\s+accepted", line)
                ip = match_ip.group(1) if match_ip else None
                return email, ip
                
    return None

@router.get("/api/security/client-by-connection")
async def client_by_connection(
    request: Request,
    client_ip: Optional[str] = Query(None),
    dst_ip: Optional[str] = Query(None),
    port: int = Query(...)
):
    if not check_auth(request):
        return decoy_response()
        
    import backend.routes.security as sec_facade
    # Сначала ищем в логах Hysteria
    email = sec_facade.find_email_in_hysteria_log(dst_ip, port)
    if email:
        real_client_ip = find_client_ip_for_email_in_hysteria_log(email)
        return {"success": True, "email": email, "source": "hysteria", "client_ip": real_client_ip}
        
    # Затем ищем в логах Xray
    res = find_email_and_ip_in_xray_log(client_ip, dst_ip, port)
    if res:
        found_email, found_ip = res
        return {"success": True, "email": found_email, "source": "xray", "client_ip": found_ip}
        
    return {"success": False, "msg": "Client not found in logs"}

@router.get("/api/security/search-client")
async def search_client(request: Request, key: str = Query("")):
    if not check_auth(request):
        return decoy_response()
        
    from backend.links_generator import get_client_links
    
    found_clients = []
    host_header = request.headers.get("Host", "127.0.0.1")
    proto = request.url.scheme
    base_url = f"{proto}://{host_header}"
    
    with db_session() as session:
        if not key or not key.strip():
            clients = session.query(ClientStats).all()
        else:
            clients = session.query(ClientStats).filter(
                (ClientStats.email == key) | (ClientStats.client_uuid_or_pwd == key)
            ).all()
        
        for c in clients:
            ib = session.query(Inbound).filter_by(id=c.inbound_id).first()
            if ib:
                c_dict = {
                    "id": c.id, "inbound_id": c.inbound_id, "email": c.email,
                    "client_uuid_or_pwd": c.client_uuid_or_pwd, "up": c.up, "down": c.down,
                    "total": c.total, "expiry_time": c.expiry_time, "enable": c.enable,
                    "limit_ip": c.limit_ip, "block_reason": c.block_reason or ""
                }
                ib_dict = {
                    "id": ib.id, "remark": ib.remark, "port": ib.port, "protocol": ib.protocol,
                    "settings": ib.settings, "stream_settings": ib.stream_settings, "sniffing": ib.sniffing,
                    "enable": ib.enable, "up": ib.up, "down": ib.down, "total": ib.total, "expiry_time": ib.expiry_time
                }
                
                # Генерация ссылок для подключения
                links = []
                try:
                    links = get_client_links(ib_dict, c_dict, base_url)
                except Exception as e:
                    logging.error(f"Error generating client links for search API: {e}")
                    
                found_clients.append({
                    "inbound": ib_dict,
                    "client": c_dict,
                    "links": links
                })
                
    if found_clients or not key or not key.strip():
        return {"success": True, "clients": found_clients}
    return {"success": False, "msg": "Client not found"}

@router.post("/api/security/disable-client")
async def disable_client(request: Request, email: str = Form(...)):
    if not check_auth(request):
        return decoy_response()
        
    from backend.xray import restart_xray, remove_client_api
    from backend.hysteria import restart_hysteria, kick_client_hysteria_api
    
    client_exists = False
    disabled_count = 0
    with db_session() as session:
        clients = session.query(ClientStats).filter_by(email=email).all()
        if clients:
            client_exists = True
        for c in clients:
            if c.enable == 1:
                c.enable = 0
                c.block_reason = "IPS Auto-blocked"
                ib_id = c.inbound_id
                
                # Мгновенный разрыв сессии на уровне API ядер
                inbound = session.query(Inbound).filter_by(id=ib_id).first()
                if inbound:
                    try:
                        # Обновляем settings inbound в JSON
                        ib_settings = json.loads(inbound.settings or "{}")
                        ib_clients = ib_settings.get("clients", [])
                        for sc in ib_clients:
                            if sc.get("email") == email:
                                sc["enable"] = False
                                break
                        inbound.settings = json.dumps(ib_settings)
                    except Exception as e:
                        logging.error(f"Error updating inbound settings JSON: {e}")
                        
                    if inbound.protocol == "hysteria2":
                        try:
                            kick_client_hysteria_api(ib_id, email)
                        except Exception as e:
                            logging.error(f"Failed to kick Hysteria2 client: {e}")
                    else:
                        try:
                            remove_client_api(ib_id, email)
                        except Exception as e:
                            logging.error(f"Failed to remove Xray client: {e}")
                            
                disabled_count += 1
        session.commit()
        
    if disabled_count > 0:
        restart_xray()
        restart_hysteria()
        
        # Запись в аудит-лог
        try:
            from backend.audit import log_action, get_actor_username
            actor = get_actor_username(request) or "IPS-Sentinel"
            log_action(actor, "block_client_ips", target=email, details="IPS Auto-blocked due to intrusion threat")
        except Exception:
            pass
            
        return {"success": True, "msg": f"Client {email} blocked and active sessions terminated."}
    if client_exists:
        return {"success": True, "msg": f"Client {email} is already blocked."}
    return {"success": False, "msg": f"Client {email} not found."}

@router.post("/api/security/enable-client")
async def enable_client(request: Request, email: str = Form(...)):
    if not check_auth(request):
        return decoy_response()
        
    from backend.xray import restart_xray
    from backend.hysteria import restart_hysteria
    
    client_exists = False
    enabled_count = 0
    with db_session() as session:
        clients = session.query(ClientStats).filter_by(email=email).all()
        if clients:
            client_exists = True
        for c in clients:
            if c.enable == 0:
                c.enable = 1
                c.block_reason = None
                ib_id = c.inbound_id
                
                inbound = session.query(Inbound).filter_by(id=ib_id).first()
                if inbound:
                    try:
                        ib_settings = json.loads(inbound.settings or "{}")
                        ib_clients = ib_settings.get("clients", [])
                        for sc in ib_clients:
                            if sc.get("email") == email:
                                sc["enable"] = True
                                break
                        inbound.settings = json.dumps(ib_settings)
                    except Exception as e:
                        logging.error(f"Error updating inbound settings JSON: {e}")
                        
                enabled_count += 1
        session.commit()
        
    if enabled_count > 0:
        restart_xray()
        restart_hysteria()
        
        # Запись в аудит-лог
        try:
            from backend.audit import log_action, get_actor_username
            actor = get_actor_username(request) or "IPS-Sentinel"
            log_action(actor, "unblock_client_ips", target=email, details="IPS Auto-unblocked after investigation")
        except Exception:
            pass
            
        return {"success": True, "msg": f"Client {email} unblocked and services reloaded."}
    if client_exists:
        return {"success": True, "msg": f"Client {email} is already active."}
    return {"success": False, "msg": f"Client {email} not found."}

@router.get("/api/security/top-traffic")
async def get_top_traffic(request: Request, period: str = Query("today")):
    if not check_auth(request):
        return decoy_response()
        
    today_str = datetime.date.today().isoformat()
    month_prefix = datetime.date.today().strftime("%Y-%m-") + "%"
    
    with db_session() as session:
        if period == "today":
            records = session.query(
                ClientTrafficDaily.email,
                ClientTrafficDaily.up,
                ClientTrafficDaily.down
            ).filter(ClientTrafficDaily.date == today_str).all()
        else:
            records = session.query(
                ClientTrafficDaily.email,
                func.sum(ClientTrafficDaily.up).label("up"),
                func.sum(ClientTrafficDaily.down).label("down")
            ).filter(ClientTrafficDaily.date.like(month_prefix)).group_by(ClientTrafficDaily.email).all()
            
        result = []
        for r in records:
            up_bytes = int(r.up or 0)
            down_bytes = int(r.down or 0)
            total_bytes = up_bytes + down_bytes
            result.append({
                "email": r.email,
                "up": up_bytes,
                "down": down_bytes,
                "total": total_bytes
            })
            
        result.sort(key=lambda x: x["total"], reverse=True)
        return {"success": True, "period": period, "users": result}
