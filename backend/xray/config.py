import json
import logging
from backend.config import XRAY_CONFIG_PATH, XRAY_LOG_PATH
from backend.database import get_all_inbounds, get_clients_for_inbound, get_all_outbounds, get_all_routing_rules

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

def generate_xray_config_json() -> dict:
    """Генерирует JSON конфигурации для Xray на основе данных из БД"""
    inbounds = get_all_inbounds()
    
    xray_inbounds = []
    
    # 1. Добавляем системное входящее подключение для gRPC API управления
    xray_inbounds.append({
        "listen": "127.0.0.1",
        "port": 10085,
        "protocol": "dokodemo-door",
        "settings": {
            "address": "127.0.0.1"
        },
        "tag": "api"
    })
    
    # 2. Добавляем пользовательские входящие подключения (VLESS, VMess, Trojan, Shadowsocks)
    for ib in inbounds:
        if not ib["enable"]:
            continue
            
        protocol = ib["protocol"]
        ib_id = ib["id"]
        if protocol == "hysteria2":
            try:
                stream_settings = json.loads(ib["stream_settings"] or "{}")
                hysteria_opts = stream_settings.get("hysteria", {})
                if hysteria_opts.get("routingViaXray"):
                    socks_username = hysteria_opts.get("socksUsername", "default_user")
                    socks_password = hysteria_opts.get("socksPassword", "default_pass")
                    xray_inbounds.append({
                        "listen": "127.0.0.1",
                        "port": 20000 + ib_id,
                        "protocol": "socks",
                        "settings": {
                            "auth": "password",
                            "accounts": [
                                {
                                    "user": socks_username,
                                    "pass": socks_password
                                }
                            ],
                            "udp": True
                        },
                        "tag": f"inbound-{ib_id}-socks"
                    })
            except Exception as e:
                logging.error(f"Error generating SOCKS5 inbound for Hysteria 2 routing: {e}")
            continue
            
        ib_id = ib["id"]
        port = ib["port"]
        
        # Загружаем настройки из БД
        try:
            db_settings = json.loads(ib["settings"] or "{}")
            stream_settings = json.loads(ib["stream_settings"] or "{}")
            sniffing = json.loads(ib["sniffing"] or "{}")
        except Exception as e:
            logging.error(f"Error parsing JSON for inbound {ib_id}: {e}")
            continue
            
        # Загружаем клиентов этого инбаунда из client_stats
        db_clients = get_clients_for_inbound(ib_id)
        
        # Формируем структуру настроек Xray в зависимости от протокола
        xray_settings = {}
        
        if protocol == "vless":
            clients_list = []
            for c in db_clients:
                if not c["enable"]:
                    continue
                client_flow = ""
                if db_settings.get("clients"):
                    for sc in db_settings["clients"]:
                        if sc.get("email") == c["email"]:
                            client_flow = sc.get("flow", "")
                            break
                clients_list.append({
                    "id": c["client_uuid_or_pwd"],
                    "email": c["email"],
                    "flow": client_flow
                })
            xray_settings = {
                "clients": clients_list,
            }
            fallbacks = db_settings.get("fallbacks")
            if fallbacks:
                xray_settings["fallbacks"] = fallbacks
            else:
                xray_settings["decryption"] = db_settings.get("decryption", "none")
            
        elif protocol == "vmess":
            clients_list = []
            for c in db_clients:
                if not c["enable"]:
                    continue
                alter_id = 0
                if db_settings.get("clients"):
                    for sc in db_settings["clients"]:
                        if sc.get("email") == c["email"]:
                            alter_id = int(sc.get("alterId", 0))
                            break
                clients_list.append({
                    "id": c["client_uuid_or_pwd"],
                    "email": c["email"],
                    "alterId": alter_id
                })
            xray_settings = {
                "clients": clients_list
            }
            
        elif protocol == "trojan":
            clients_list = []
            for c in db_clients:
                if not c["enable"]:
                    continue
                clients_list.append({
                    "password": c["client_uuid_or_pwd"],
                    "email": c["email"]
                })
            xray_settings = {
                "clients": clients_list,
                "fallbacks": db_settings.get("fallbacks", [])
            }
            
        elif protocol == "shadowsocks":
            clients_list = []
            for c in db_clients:
                if not c["enable"]:
                    continue
                clients_list.append({
                    "password": c["client_uuid_or_pwd"],
                    "email": c["email"]
                })
            xray_settings = {
                "method": db_settings.get("method", "aes-256-gcm"),
                "clients": clients_list,
                "network": "tcp,udp"
            }
            
        xray_inbound = {
            "port": port,
            "protocol": protocol,
            "settings": xray_settings,
            "tag": f"inbound-{ib_id}"
        }
        
        if stream_settings:
            tls_settings = stream_settings.get("tlsSettings", {})
            if tls_settings:
                if "allowInsecure" in tls_settings:
                    del tls_settings["allowInsecure"]
                if not tls_settings.get("certificates"):
                    from backend.ssl_utils import SSL_CERT_PATH, SSL_KEY_PATH
                    if SSL_CERT_PATH.exists() and SSL_KEY_PATH.exists():
                        tls_settings["certificates"] = [
                            {
                                "certificateFile": str(SSL_CERT_PATH),
                                "keyFile": str(SSL_KEY_PATH)
                            }
                        ]
            xray_inbound["streamSettings"] = stream_settings
            
        if "streamSettings" not in xray_inbound:
            xray_inbound["streamSettings"] = {}
        if "sockopt" not in xray_inbound["streamSettings"]:
            xray_inbound["streamSettings"]["sockopt"] = {}
        xray_inbound["streamSettings"]["sockopt"]["reusePort"] = True
        
        if sniffing:
            xray_inbound["sniffing"] = sniffing
            
        xray_inbounds.append(xray_inbound)
        
    # Загружаем исходящие подключения (Outbounds) из БД
    db_outbounds = get_all_outbounds()
    xray_outbounds = []
    for ob in db_outbounds:
        if ob["enable"] != 1:
            continue
        try:
            settings_dict = json.loads(ob["settings"] or "{}")
            stream_settings_dict = json.loads(ob["stream_settings"] or "{}")
        except Exception:
            settings_dict = {}
            stream_settings_dict = {}
        
        ob_dict = {
            "protocol": ob["protocol"],
            "settings": settings_dict
        }
        if stream_settings_dict:
            ob_dict["streamSettings"] = stream_settings_dict
            
        if ob["tag"]:
            ob_dict["tag"] = ob["tag"]
            
        xray_outbounds.append(ob_dict)
        
    # Сортируем outbounds, чтобы direct (Freedom) всегда шел первым.
    # Xray использует первый элемент списка outbounds в качестве шлюза по умолчанию (default gateway).
    # Если первым будет blocked (blackhole), то весь немаршрутизированный трафик будет заблокирован.
    xray_outbounds.sort(key=lambda x: 0 if x.get("tag") == "direct" else (1 if x.get("tag") == "blocked" else 2))
        
    if not xray_outbounds:
        xray_outbounds = [
            {"protocol": "freedom", "settings": {}, "tag": "direct"},
            {"protocol": "blackhole", "settings": {}, "tag": "blocked"}
        ]
        
    # Загружаем правила маршрутизации (Routing Rules) из БД
    db_rules = get_all_routing_rules()
    rules = []
    for r in db_rules:
        if r["enable"] != 1:
            continue
            
        rule_dict = {
            "type": "field",
            "outboundTag": r["outbound_tag"]
        }
        
        if r["inbound_tags"]:
            rule_dict["inboundTag"] = r["inbound_tags"]
        if r.get("users"):
            rule_dict["user"] = r["users"]
        if r["domains"]:
            rule_dict["domain"] = r["domains"]
        if r["ips"]:
            rule_dict["ip"] = r["ips"]
        if r["protocols"]:
            rule_dict["protocol"] = r["protocols"]
            
        if len(rule_dict) > 2:
            rules.append(rule_dict)
            
    if not rules:
        rules.append({
            "type": "field",
            "inboundTag": ["api"],
            "outboundTag": "api"
        })

    config = {
        "log": {
            "access": str(XRAY_LOG_PATH),
            "error": str(XRAY_LOG_PATH),
            "loglevel": "warning"
        },
        "api": {
            "tag": "api",
            "services": [
                "HandlerService",
                "StatsService"
            ]
        },
        "stats": {},
        "policy": {
            "levels": {
                "0": {
                    "statsUserUplink": True,
                    "statsUserDownlink": True
                }
            },
            "system": {
                "statsInboundUplink": True,
                "statsInboundDownlink": True,
                "statsOutboundUplink": True,
                "statsOutboundDownlink": True
            }
        },
        "inbounds": xray_inbounds,
        "outbounds": xray_outbounds,
        "routing": {
            "rules": rules
        }
    }
    
    return config

def write_xray_config():
    """Записывает сгенерированный JSON конфиг в файл"""
    from backend.database import get_setting
    if get_setting("use_custom_xray_config") == "true":
        logging.info("Xray is using custom configuration. Skipping auto-generation.")
        return
        
    config = generate_xray_config_json()
    with open(XRAY_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
    logging.info(f"Xray config rewritten to {XRAY_CONFIG_PATH}")

