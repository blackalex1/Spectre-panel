from fastapi import APIRouter, Request
from backend.database import (
    get_all_routing_rules, get_routing_rule_by_id, add_routing_rule,
    update_routing_rule, delete_routing_rule, update_rules_priority
)
from backend.auth_utils import check_auth, decoy_response
from backend.xray import write_xray_config, restart_xray
from backend.audit import log_action, get_actor_username

router = APIRouter()

@router.get("/api/routing/rules")
async def list_rules_api(request: Request):
    """Lists all configured routing rules."""
    if not check_auth(request):
        return decoy_response()
    return {"success": True, "obj": get_all_routing_rules()}

@router.post("/api/routing/rules/create")
async def create_rule_api(request: Request, payload: dict):
    """Creates a new routing rule."""
    if not check_auth(request):
        return decoy_response()
        
    remark = payload.get("remark", "").strip()
    outbound_tag = payload.get("outbound_tag", "").strip()
    inbound_tags = payload.get("inbound_tags", [])
    users = payload.get("users", [])
    domains = payload.get("domains", [])
    ips = payload.get("ips", [])
    protocols = payload.get("protocols", [])
    enable = int(payload.get("enable", 1))
    
    if not outbound_tag:
        return {"success": False, "msg": "Тег назначения (Outbound Tag) обязателен"}
        
    if not inbound_tags and not users and not domains and not ips and not protocols:
        return {"success": False, "msg": "Необходимо указать хотя бы одно условие (домены, IP, протоколы, пользователи или входящие теги)"}
        
    rule_id = add_routing_rule(remark, outbound_tag, inbound_tags, users, domains, ips, protocols, enable)
    
    write_xray_config()
    restart_xray()
    
    actor = get_actor_username(request)
    log_action(actor, "create_routing_rule", target=remark or f"rule-{rule_id}", details=f"outbound:{outbound_tag}")
    
    return {"success": True, "id": rule_id}

@router.post("/api/routing/rules/update/{id}")
async def update_rule_api(request: Request, id: int, payload: dict):
    """Updates an existing routing rule by ID."""
    if not check_auth(request):
        return decoy_response()
        
    remark = payload.get("remark", "").strip()
    outbound_tag = payload.get("outbound_tag", "").strip()
    inbound_tags = payload.get("inbound_tags", [])
    users = payload.get("users", [])
    domains = payload.get("domains", [])
    ips = payload.get("ips", [])
    protocols = payload.get("protocols", [])
    enable = int(payload.get("enable", 1))
    sort_order = payload.get("sort_order")
    
    if not outbound_tag:
        return {"success": False, "msg": "Тег назначения (Outbound Tag) обязателен"}
        
    if not inbound_tags and not users and not domains and not ips and not protocols:
        return {"success": False, "msg": "Необходимо указать хотя бы одно условие"}
        
    success = update_routing_rule(id, remark, outbound_tag, inbound_tags, users, domains, ips, protocols, enable, sort_order)
    if not success:
        return {"success": False, "msg": "Правило маршрутизации не найдено"}
        
    write_xray_config()
    restart_xray()
    
    actor = get_actor_username(request)
    log_action(actor, "update_routing_rule", target=remark or f"rule-{id}", details=f"outbound:{outbound_tag}, enable:{enable}")
    
    return {"success": True}

@router.post("/api/routing/rules/delete/{id}")
async def delete_rule_api(request: Request, id: int):
    """Deletes a routing rule by ID."""
    if not check_auth(request):
        return decoy_response()
        
    rule = get_routing_rule_by_id(id)
    if not rule:
        return {"success": False, "msg": "Правило маршрутизации не найдено"}
        
    if "api" in rule.get("inbound_tags", []) and rule.get("outbound_tag") == "api":
         return {"success": False, "msg": "Нельзя удалять системное правило трафика API"}
         
    success = delete_routing_rule(id)
    if not success:
        return {"success": False, "msg": "Не удалось удалить правило маршрутизации"}
        
    write_xray_config()
    restart_xray()
    
    actor = get_actor_username(request)
    log_action(actor, "delete_routing_rule", target=rule.get("remark") or f"rule-{id}")
    
    return {"success": True}

@router.post("/api/routing/rules/sort")
async def sort_rules_api(request: Request, payload: dict):
    """Updates sorting orders priorities for routing rules."""
    if not check_auth(request):
        return decoy_response()
        
    rule_ids = payload.get("rule_ids", [])
    if not rule_ids:
        return {"success": False, "msg": "Список ID правил пуст"}
        
    success = update_rules_priority(rule_ids)
    
    write_xray_config()
    restart_xray()
    
    actor = get_actor_username(request)
    log_action(actor, "sort_routing_rules", details=f"order:{rule_ids}")
    
    return {"success": True}
