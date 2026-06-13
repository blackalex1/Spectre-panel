import re
import json
import datetime
import time
import logging
from backend.database import get_setting, db_session
from backend.models import ClientStats, Inbound
from backend.utils import read_last_lines

def detect_and_block_port_scans():
    """
    Scans Xray access.log and Hysteria 2 hysteria.log.
    If a client requested > 200 unique IPs in the last 10 seconds,
    automatically blocks them and alerts admins in Telegram.
    """
    import backend.scheduler
    xray_log_path = backend.scheduler.XRAY_LOG_PATH
    hysteria_log_path = backend.scheduler.HYSTERIA_LOG_PATH

    now_ts = time.time()
    cutoff_ts = now_ts - 10  # 10 seconds sliding window
    
    # email -> set of unique dst IPs
    client_dst_ips = {}
    
    # 1. Read Xray access logs
    if xray_log_path.exists():
        try:
            lines = read_last_lines(xray_log_path, 2000)
            for line in lines:
                if "accepted" not in line or "email: " not in line:
                    continue
                
                parts = line.strip().split()
                if len(parts) < 3:
                    continue
                try:
                    log_time_str = parts[0] + " " + parts[1]
                    log_time = datetime.datetime.strptime(log_time_str, "%Y/%m/%d %H:%M:%S")
                    log_ts = log_time.timestamp()
                except Exception:
                    log_ts = now_ts  # fallback
                
                if log_ts < cutoff_ts:
                    continue
                
                email_part = line.split("email: ")
                if len(email_part) < 2:
                    continue
                email = email_part[1].strip()
                
                match = re.search(r'(?:tcp|udp|multipath):\[?([a-zA-Z0-9\.-]+)\]?:(\d+)', line)
                if match:
                    dst_ip = match.group(1)
                    if email not in client_dst_ips:
                        client_dst_ips[email] = set()
                    client_dst_ips[email].add(dst_ip)
        except Exception as e:
            logging.error(f"[IPS] Error reading Xray log: {e}")

    # 2. Read Hysteria 2 logs
    if hysteria_log_path.exists():
        try:
            lines = read_last_lines(hysteria_log_path, 2000)
            for line in lines:
                parts = line.strip().split()
                if not parts:
                    continue
                try:
                    log_time_str = parts[0].replace("\t", "").strip()
                    log_time_str = log_time_str.split(".")[0].split("+")[0].rstrip("Z")
                    log_time = datetime.datetime.strptime(log_time_str, "%Y-%m-%dT%H:%M:%S")
                    log_ts = log_time.timestamp()
                except Exception:
                    log_ts = now_ts  # fallback
                    
                if log_ts < cutoff_ts:
                    continue
                
                email = None
                dst_ip = None
                
                if line.strip().startswith("{") and line.strip().endswith("}"):
                    try:
                        data = json.loads(line)
                        email = data.get("auth") or data.get("email")
                        req = data.get("req") or data.get("target")
                        if req and ":" in req:
                            dst_ip = req.rsplit(":", 1)[0].replace("[", "").replace("]", "")
                    except Exception:
                        pass
                
                if not email or not dst_ip:
                    email_match = re.search(r'(?:auth|email)\s*[:=]\s*"?([^\s",}]+)"?', line)
                    if email_match:
                        email = email_match.group(1).strip()
                    else:
                        email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', line)
                        if email_match:
                            email = email_match.group(0)
                            
                    req_match = re.search(r'(?:req|target)\s*[:=]\s*"?([^\s",}]+)"?', line)
                    if req_match:
                        req = req_match.group(1).strip()
                        if ":" in req:
                            dst_ip = req.rsplit(":", 1)[0].replace("[", "").replace("]", "")
                            
                if email and dst_ip:
                    if email not in client_dst_ips:
                        client_dst_ips[email] = set()
                    client_dst_ips[email].add(dst_ip)
        except Exception as e:
            logging.error(f"[IPS] Error reading Hysteria log: {e}")

    # 3. Block clients that exceed 200 unique IPs
    need_config_update = False
    
    sys_lang = get_setting("language", "ru")
    bot_token = get_setting("telegram_bot_token", "")
    tg_admin_ids = get_setting("telegram_admin_ids", "")
    
    with db_session() as session:
        for email, dst_ips in client_dst_ips.items():
            if len(dst_ips) > 200:
                clients = session.query(ClientStats).filter_by(email=email, enable=1).all()
                if not clients:
                    continue
                    
                block_reason = f"IPS Auto-blocked (Port Scan: {len(dst_ips)} unique IPs in 10s)"
                logging.warning(f"[IPS] Blocking client {email} due to port scanning anomaly ({len(dst_ips)} unique target IPs in 10s)")
                
                for c in clients:
                    c.enable = 0
                    c.block_reason = block_reason
                    
                    inbound = session.query(Inbound).filter_by(id=c.inbound_id).first()
                    if inbound:
                        try:
                            ib_settings = json.loads(inbound.settings or "{}")
                            ib_clients = ib_settings.get("clients", [])
                            for sc in ib_clients:
                                if sc.get("email") == email:
                                    sc["enable"] = False
                                    break
                            inbound.settings = json.dumps(ib_settings)
                        except Exception as e:
                            logging.error(f"[IPS] Error updating settings JSON for inbound {inbound.id}: {e}")
                            
                        if inbound.protocol == "hysteria2":
                            backend.scheduler.kick_client_hysteria_api(inbound.id, email)
                        else:
                            backend.scheduler.remove_client_api(inbound.id, email)
                            
                need_config_update = True
                backend.scheduler.asyncio_notify_admin(email, block_reason, bot_token, tg_admin_ids)
                
                try:
                    from backend.audit import log_action
                    log_action("IPS-Sentinel", "block_client_ips", target=email, details=block_reason)
                except Exception:
                    pass

    if need_config_update:
        backend.scheduler.write_xray_config()
        backend.scheduler.restart_hysteria()
