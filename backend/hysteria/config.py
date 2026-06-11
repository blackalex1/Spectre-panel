import logging
import backend.hysteria

def generate_hysteria_config(inbound_id: int, port: int, clients: list, stream_settings: dict = None) -> dict:
    """Генерирует JSON конфигурации для Hysteria 2"""
    auth_userpass = {}
    for c in clients:
        if c["enable"]:
            auth_userpass[c["email"]] = c["client_uuid_or_pwd"]
            
    admin_port = 10100 + inbound_id

    hysteria_opts = stream_settings.get("hysteria", {}) if stream_settings else {}
    obfs_password = hysteria_opts.get("obfsPassword", "")
    up_mbps = hysteria_opts.get("upMbps", 0)
    down_mbps = hysteria_opts.get("downMbps", 0)
    
    cert_mode = hysteria_opts.get("certMode", "self")
    cert_path = hysteria_opts.get("certPath", "")
    key_path = hysteria_opts.get("keyPath", "")
    masq_type = hysteria_opts.get("masqType", "proxy")
    masq_value = hysteria_opts.get("masqValue", "https://yahoo.com")
    hop = hysteria_opts.get("hop", "")

    # Настройка TLS
    sni = hysteria_opts.get("sni", "")
    if cert_mode == "custom" and cert_path and key_path:
        tls_config = {
            "cert": cert_path,
            "key": key_path
        }
    else:
        from backend.ssl_utils import SSL_CERT_PATH, SSL_KEY_PATH
        if SSL_CERT_PATH.exists() and SSL_KEY_PATH.exists():
            tls_config = {
                "cert": str(SSL_CERT_PATH),
                "key": str(SSL_KEY_PATH)
            }
        else:
            tls_config = {
                "cert": str(backend.hysteria.HYSTERIA_CERT_PATH),
                "key": str(backend.hysteria.HYSTERIA_KEY_PATH)
            }
    if sni:
        tls_config["sni"] = sni

    # Настройка Masquerade
    if masq_type == "file":
        masq_config = {
            "type": "file",
            "file": {
                "dir": masq_value
            }
        }
    elif masq_type == "status":
        try:
            status_code = int(masq_value)
        except ValueError:
            status_code = 404
        masq_config = {
            "type": "string",
            "string": {
                "content": str(status_code),
                "headers": {
                    "Content-Type": "text/plain"
                },
                "statusCode": status_code
            }
        }
    else:  # proxy
        masq_config = {
            "type": "proxy",
            "proxy": {
                "url": masq_value or "https://yahoo.com",
                "rewriteHost": True
            }
        }

    # Настройка listen (с поддержкой Port Hopping)
    listen_str = f":{port}"
    if hop:
        if "-" in hop:
            try:
                start_port, end_port = hop.split("-", 1)
                start_port = int(start_port.strip())
                end_port = int(end_port.strip())
                if start_port == port:
                    listen_str = f":{hop}"
                else:
                    logging.warning(
                        f"Hysteria 2: Primary port {port} does not match start of hop range {hop}. "
                        f"Listening on primary port {port} only. Please configure firewall DNAT manually."
                    )
            except ValueError:
                logging.warning(f"Hysteria 2: Invalid hop range format '{hop}'. Listening on port {port} only.")
        else:
            logging.warning(
                f"Hysteria 2: Hop '{hop}' is not a range. Hysteria 2 requires a range for automatic port hopping. "
                f"Listening on port {port} only."
            )

    config = {
        "listen": listen_str,
        "auth": {
            "type": "userpass",
            "userpass": auth_userpass
        },
        "tls": tls_config,
        "trafficStats": {
            "listen": f"127.0.0.1:{admin_port}"
        }
    }

    if not obfs_password:
        config["masquerade"] = masq_config

    try:
        up_mbps = int(up_mbps) if up_mbps else 0
    except ValueError:
        up_mbps = 0

    try:
        down_mbps = int(down_mbps) if down_mbps else 0
    except ValueError:
        down_mbps = 0

    if obfs_password:
        config["obfs"] = {
            "type": "salamander",
            "salamander": {
                "password": obfs_password
            }
        }

    ignore_bw = hysteria_opts.get("ignoreClientBandwidth", False)
    
    if ignore_bw:
        config["ignoreClientBandwidth"] = True
    elif up_mbps > 0 or down_mbps > 0:
        config["bandwidth"] = {}
        if up_mbps > 0:
            config["bandwidth"]["up"] = f"{up_mbps} mbps"
        if down_mbps > 0:
            config["bandwidth"]["down"] = f"{down_mbps} mbps"
            
    if hysteria_opts.get("routingViaXray"):
        socks_username = hysteria_opts.get("socksUsername", "default_user")
        socks_password = hysteria_opts.get("socksPassword", "default_pass")
        config["outbounds"] = [
            {
                "name": "xray-socks",
                "type": "socks5",
                "socks5": {
                    "addr": f"127.0.0.1:{20000 + inbound_id}",
                    "username": socks_username,
                    "password": socks_password
                }
            }
        ]
            
    return config
