import json
import logging
import subprocess
from typing import List
from pydantic import BaseModel
from fastapi import APIRouter, Request, Form

from backend.auth_utils import check_auth, decoy_response

router = APIRouter()

class WhitelistSyncBody(BaseModel):
    ips: List[str]

@router.post("/api/security/whitelist/sync")
async def sync_whitelist(payload: WhitelistSyncBody, request: Request):
    if not check_auth(request):
        return decoy_response()
        
    from backend.database import set_setting
    
    try:
        set_setting("ips_whitelisted_sync", json.dumps(payload.ips))
        return {"success": True, "msg": "Whitelist synchronized successfully"}
    except Exception as e:
        return {"success": False, "msg": f"Failed to sync whitelist: {e}"}


@router.post("/api/security/unban-ip")
async def unban_ip(request: Request, ip: str = Form(...)):
    if not check_auth(request):
        return decoy_response()
        
    from backend.database import get_setting, set_setting
    
    banned_ips = get_setting("banned_login_ips", "")
    banned_list = [i.strip() for i in banned_ips.split(",") if i.strip()]
    if ip in banned_list:
        banned_list.remove(ip)
        set_setting("banned_login_ips", ",".join(banned_list))
        
        # Также пробуем удалить из iptables
        try:
            subprocess.run(["iptables", "-D", "INPUT", "-s", ip, "-j", "DROP"], capture_output=True)
        except Exception as ex:
            logging.warning(f"Failed to remove IP from iptables: {ex}")
            
        return {"success": True, "msg": f"IP {ip} разблокирован"}
    return {"success": False, "msg": f"IP {ip} не найден в списке заблокированных"}


@router.get("/api/security/audit-logs")
async def get_audit_logs(request: Request, limit: int = 10, search: str = ""):
    if not check_auth(request):
        return decoy_response()
        
    try:
        from backend.models import AuditLog
        from backend.database import db_session
        
        with db_session() as session:
            query = session.query(AuditLog)
            if search:
                query = query.filter(
                    (AuditLog.username.ilike(f"%{search}%")) |
                    (AuditLog.action.ilike(f"%{search}%")) |
                    (AuditLog.target.ilike(f"%{search}%")) |
                    (AuditLog.details.ilike(f"%{search}%"))
                )
            logs = query.order_by(AuditLog.timestamp.desc()).limit(limit).all()
            
            result = []
            for log in logs:
                result.append({
                    "id": log.id,
                    "timestamp": log.timestamp,
                    "username": log.username,
                    "action": log.action,
                    "target": log.target,
                    "details": log.details
                })
                
            return {"success": True, "logs": result}
    except Exception as e:
        return {"success": False, "msg": f"Failed to get audit logs: {e}"}


@router.post("/api/security/audit-logs/clear-connections")
async def clear_connection_logs(request: Request):
    if not check_auth(request):
        return decoy_response()
        
    try:
        from backend.models import AuditLog
        from backend.database import db_session
        
        with db_session() as session:
            session.query(AuditLog).filter(
                AuditLog.action.in_([
                    "xray_connect", "xray_disconnect", 
                    "hysteria_connect", "hysteria_disconnect"
                ])
            ).delete(synchronize_session=False)
            session.commit()
            
        from backend.audit import log_action
        from backend.audit import get_actor_username
        log_action(get_actor_username(request), "clear_connection_logs", details="Connection logs cleared via Web UI")
        
        return {"success": True, "msg": "База подключений успешно очищена"}
    except Exception as e:
        return {"success": False, "msg": f"Failed to clear connection logs: {e}"}


class ReportToMasterRequest(BaseModel):
    action: str                         # "investigation_result" | "investigation_failed"
    client_email: str = ""
    tunnel_email: str = ""
    details: str = ""

@router.post("/api/security/report-to-master")
async def report_to_master(request: Request, body: ReportToMasterRequest):
    """
    Контроллер-бот дёргает этот эндпоинт на своей панели после расследования.
    Если панель зарегистрирована как edge-нода (есть node_config.json),
    она подпишет отчёт Ed25519 и перешлёт мастер-панели через POST /api/nodes/report.
    """
    if not check_auth(request):
        return decoy_response()
    
    from backend.node_agent import load_node_config, send_report_to_master
    config = load_node_config()
    if not config:
        return {"success": True, "reported": False, "reason": "Not a slave node"}
    
    success = await send_report_to_master(
        action=body.action,
        client_email=body.client_email,
        tunnel_email=body.tunnel_email,
        details=body.details
    )
    return {"success": True, "reported": success}


@router.get("/api/security/banned-ips")
async def get_banned_ips(request: Request):
    if not check_auth(request):
        return decoy_response()
        
    from backend.database import get_setting, db_session
    from backend.models import AuditLog
    
    banned_ips = get_setting("banned_login_ips", "")
    banned_list = [i.strip() for i in banned_ips.split(",") if i.strip()]
    
    result = []
    with db_session() as session:
        for ip in banned_list:
            log_entry = session.query(AuditLog).filter(
                (AuditLog.target == ip) | (AuditLog.details.like(f"%{ip}%"))
            ).order_by(AuditLog.timestamp.desc()).first()
            
            reason = "2FA-блокировка или настройки"
            if log_entry:
                if log_entry.action == "login_rate_limited":
                    reason = "Превышение попыток входа (Bruteforce)"
                elif "block" in log_entry.action or "ban" in log_entry.action:
                    reason = f"Блокировка ({log_entry.action})"
                else:
                    reason = f"Активность: {log_entry.details[:40]}"
            
            result.append({
                "ip": ip,
                "reason": reason
            })
            
    return {"success": True, "banned_ips": result}

