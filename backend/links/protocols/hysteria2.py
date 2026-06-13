from urllib.parse import quote
from backend.links.protocols.utils import get_cert_sha256_fingerprint, is_ip

def build_hysteria2_link(inbound: dict, client: dict, host: str, port: int, display_name: str, stream_settings: dict, client_email: str) -> str:
    password = client.get('client_uuid_or_pwd') or client.get('password')
    
    hysteria_opts = stream_settings.get('hysteria', {})
    obfs_password = hysteria_opts.get('obfsPassword', '')
    hop = hysteria_opts.get('hop', '')

    sni = hysteria_opts.get('sni') or stream_settings.get('sni')
    params = []
    
    if sni:
        params.append(f"sni={sni}")
    elif not is_ip(host):
        params.append(f"sni={host}")
        
    cert_mode = hysteria_opts.get('certMode', 'self')
    cert_path = ""
    if cert_mode == 'custom':
        cert_path = hysteria_opts.get('certPath', '')
    else:
        if cert_mode == 'self' and sni:
            from backend.config import CONFIG_DIR
            from backend.ssl_utils import generate_custom_self_signed_cert
            custom_cert = CONFIG_DIR / f"hysteria_{inbound.get('id')}.crt"
            custom_key = CONFIG_DIR / f"hysteria_{inbound.get('id')}.key"
            
            # Ensure cert is generated to get the correct pinSHA256 fingerprint
            generate_custom_self_signed_cert(custom_cert, custom_key, sni)
            cert_path = str(custom_cert)
        else:
            from backend.ssl_utils import SSL_CERT_PATH
            if SSL_CERT_PATH.exists():
                cert_path = str(SSL_CERT_PATH)
            else:
                from backend.config import BIN_DIR
                p = BIN_DIR / "hysteria.crt"
                if p.exists():
                    cert_path = str(p)
            
    has_pin = False
    if cert_path:
        fp_hash = get_cert_sha256_fingerprint(cert_path)
        if fp_hash:
            params.append(f"pinSHA256={fp_hash}")
            has_pin = True
        
    if not has_pin:
        params.append("insecure=1")
        
    if obfs_password:
        params.append("obfs=salamander")
        params.append(f"obfs-password={quote(obfs_password, safe='')}")
    if hop:
        params.append(f"hop={quote(hop, safe='')}")
        
    query = "&".join(params)
    username = quote(client_email, safe='')
    encoded_password = quote(password, safe='')
    return f"hysteria2://{username}:{encoded_password}@{host}:{port}?{query}#{quote(display_name)}"
