from fastapi import APIRouter, Request

from backend.xray import (
    get_latest_xray_version_info, get_installed_xray_version,
    stop_xray, download_xray_core, start_xray
)

router = APIRouter()

@router.get("/api/xray/version")
async def xray_version(request: Request):
    import backend.routes.xray as xray_facade
    if not xray_facade.check_auth(request):
        return xray_facade.decoy_response()
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
    import backend.routes.xray as xray_facade
    if not xray_facade.check_auth(request):
        return xray_facade.decoy_response()
        
    download_url = payload.get("download_url")
    try:
        stop_xray()
        version = download_xray_core(download_url)
        start_xray()
        return {"success": True, "version": version}
    except Exception as e:
        start_xray()
        return {"success": False, "msg": str(e)}
