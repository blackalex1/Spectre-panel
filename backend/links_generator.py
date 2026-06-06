import json
from urllib.parse import urlparse
from backend.links.protocols import (
    get_cert_sha256_fingerprint,
    build_vless_link,
    build_vmess_link,
    build_trojan_link,
    build_shadowsocks_link,
    build_hysteria2_link,
)

def get_base_host(host_url: str) -> str:
    """Извлекает IP или домен из URL"""
    if not host_url:
        return ""
    if "://" not in host_url:
        host_url = "http://" + host_url
    parsed = urlparse(host_url)
    return parsed.hostname or ""

def get_client_links(inbound: dict, client: dict, host_url: str) -> list:
    """Генерирует ссылки для подключения (VLESS, VMess, Trojan, Shadowsocks)"""
    protocol = inbound.get('protocol')
    port = inbound.get('port')
    remark = inbound.get('remark', 'VPN')
    host = get_base_host(host_url)
    if not host:
        host = host_url  # фолбек если это просто IP
        
    client_email = client.get('email', 'client')
    display_name = f"{remark}-{client_email}"
    
    # Парсим настройки
    try:
        settings = json.loads(inbound.get('settings', '{}'))
        stream_settings = json.loads(inbound.get('stream_settings', '{}') or inbound.get('streamSettings', '{}') or '{}')
    except Exception:
        return []

    security = stream_settings.get('security', 'none')
    network = stream_settings.get('network', 'tcp')
    
    links = []

    # Находим конкретные параметры клиента
    flow = ""
    alter_id = 0
    security_cipher = "auto"
    for sc in settings.get("clients", []):
        if sc.get("email") == client_email:
            flow = sc.get("flow", "")
            alter_id = int(sc.get("alterId", 0))
            security_cipher = sc.get("security", "auto")
            break

    if protocol == 'vless':
        link = build_vless_link(
            inbound=inbound,
            client=client,
            host=host,
            port=port,
            display_name=display_name,
            settings=settings,
            stream_settings=stream_settings,
            network=network,
            security=security,
            flow=flow
        )
        links.append(link)

    elif protocol == 'vmess':
        link = build_vmess_link(
            inbound=inbound,
            client=client,
            host=host,
            port=port,
            display_name=display_name,
            settings=settings,
            stream_settings=stream_settings,
            network=network,
            security=security,
            security_cipher=security_cipher,
            alter_id=alter_id
        )
        links.append(link)

    elif protocol == 'trojan':
        link = build_trojan_link(
            inbound=inbound,
            client=client,
            host=host,
            port=port,
            display_name=display_name,
            settings=settings,
            stream_settings=stream_settings,
            network=network,
            security=security
        )
        links.append(link)

    elif protocol in ('shadowsocks', 'ss'):
        link = build_shadowsocks_link(
            inbound=inbound,
            client=client,
            host=host,
            port=port,
            display_name=display_name,
            settings=settings
        )
        links.append(link)

    elif protocol == 'hysteria2':
        link = build_hysteria2_link(
            inbound=inbound,
            client=client,
            host=host,
            port=port,
            display_name=display_name,
            stream_settings=stream_settings,
            client_email=client_email
        )
        links.append(link)

    return links
