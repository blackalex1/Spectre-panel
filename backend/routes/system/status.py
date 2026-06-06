import time
import psutil
from fastapi import APIRouter, Request

from backend.host_client import host_client
from backend.xray import is_xray_running, get_installed_xray_version
from backend.hysteria import is_hysteria_running, get_installed_hysteria_version
import backend.routes.system

router = APIRouter()

@router.get("/panel/api/server/status")
async def server_status_api(request: Request):
    if not backend.routes.system.check_auth(request):
        return backend.routes.system.decoy_response()
        
    # Собираем метрики системы из хост-агента
    stats = host_client.send_command("get_system_stats")
    if stats.get("success"):
        cpu_percent = stats.get("cpu", 0.0)
        mem_current = stats.get("mem", {}).get("current", 0)
        mem_total = stats.get("mem", {}).get("total", 0)
        uptime = stats.get("uptime", 0)
        net_up = stats.get("netIO", {}).get("up", 0)
        net_down = stats.get("netIO", {}).get("down", 0)
    else:
        # Резервный вариант сбора локальных метрик
        cpu_percent = psutil.cpu_percent()
        mem = psutil.virtual_memory()
        mem_current = mem.used
        mem_total = mem.total
        net_io = psutil.net_io_counters()
        net_up = net_io.bytes_sent
        net_down = net_io.bytes_recv
        boot_time = psutil.boot_time()
        uptime = int(time.time() - boot_time)
    
    # Disk stats
    try:
        disk_info = psutil.disk_usage('/')
        disk_current = disk_info.used
        disk_total = disk_info.total
        disk_percent = disk_info.percent
    except Exception:
        disk_current = 0
        disk_total = 0
        disk_percent = 0.0

    # Получаем версию xray и hysteria
    xray_status = "running" if is_xray_running() else "stopped"
    hysteria_status = "running" if is_hysteria_running() else "stopped"
    
    return {
        "success": True,
        "obj": {
            "cpu": cpu_percent,
            "mem": {
                "current": mem_current,
                "total": mem_total
            },
            "disk": {
                "current": disk_current,
                "total": disk_total,
                "percent": disk_percent
            },
            "uptime": uptime,
            "netIO": {
                "up": net_up,
                "down": net_down
            },
            "xray": {
                "state": xray_status,
                "version": get_installed_xray_version()
            },
            "hysteria": {
                "state": hysteria_status,
                "version": get_installed_hysteria_version()
            }
        }
    }

@router.get("/panel/api/system/global-traffic")
async def global_traffic_api(request: Request):
    if not backend.routes.system.check_auth(request):
        return backend.routes.system.decoy_response()
        
    import datetime
    from sqlalchemy import func
    from backend.database import db_session
    from backend.models import ClientTrafficDaily
    
    # Calculate cutoff date (30 days ago)
    today = datetime.date.today()
    cutoff_date = (today - datetime.timedelta(days=30)).isoformat()
    
    with db_session() as session:
        records = session.query(
            ClientTrafficDaily.date,
            func.sum(ClientTrafficDaily.up).label("total_up"),
            func.sum(ClientTrafficDaily.down).label("total_down")
        ).filter(ClientTrafficDaily.date >= cutoff_date)\
         .group_by(ClientTrafficDaily.date)\
         .order_by(ClientTrafficDaily.date)\
         .all()
         
    result = []
    # Fill in missing dates with 0
    date_map = {r.date: (r.total_up, r.total_down) for r in records}
    
    for i in range(30):
        d = (today - datetime.timedelta(days=29 - i)).isoformat()
        up, down = date_map.get(d, (0, 0))
        result.append({
            "date": d,
            "up": up or 0,
            "down": down or 0
        })
        
    return {"success": True, "obj": result}
