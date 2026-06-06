from urllib.parse import quote
from backend.links.protocols.utils import get_cert_sha256_fingerprint

def build_trojan_link(inbound: dict, client: dict, host: str, port: int, display_name: str, settings: dict, stream_settings: dict, network: str, security: str) -> str:
    password = client.get('client_uuid_or_pwd') or client.get('password')
    
    params = [f"security={security}"]
    if security == 'tls':
        tls_settings = stream_settings.get('tlsSettings', {})
        sni = tls_settings.get('serverName')
        if sni: params.append(f"sni={sni}")
        
        certs = tls_settings.get('certificates', [])
        cert_path = ""
        if certs and isinstance(certs, list):
            cert_path = certs[0].get('certificateFile', '')
        if not cert_path:
            from backend.config import CONFIG_DIR
            p = CONFIG_DIR / "cert.pem"
            if p.exists():
                cert_path = str(p)
        
        if cert_path:
            fp_hash = get_cert_sha256_fingerprint(cert_path)
            if fp_hash:
                params.append(f"pcs={fp_hash}")
    
    # Transport parameters
    if network == 'tcp':
        tcp_settings = stream_settings.get('tcpSettings', {})
        header = tcp_settings.get('header', {})
        if header.get('type') == 'http':
            params.append("type=tcp")
            params.append("headerType=http")
            req = header.get('request', {})
            paths = req.get('path', ['/'])
            hosts = req.get('headers', {}).get('Host', [])
            if paths: params.append(f"path={quote(paths[0], safe='')}")
            if hosts: params.append(f"host={quote(hosts[0], safe='')}")
    elif network == 'ws':
        ws_settings = stream_settings.get('wsSettings', {})
        path = ws_settings.get('path', '/')
        params.append(f"type=ws")
        params.append(f"path={quote(path, safe='')}")
        ws_host = ws_settings.get('headers', {}).get('Host')
        if ws_host: params.append(f"host={ws_host}")
    elif network == 'grpc':
        grpc_settings = stream_settings.get('grpcSettings', {})
        service_name = grpc_settings.get('serviceName', 'grpc')
        params.append(f"type=grpc")
        params.append(f"serviceName={quote(service_name, safe='')}")
    elif network == 'h2':
        h2_settings = stream_settings.get('httpSettings', {})
        path = h2_settings.get('path', '/')
        params.append(f"type=h2")
        params.append(f"path={quote(path, safe='')}")
        hosts = h2_settings.get('host', [])
        if hosts: params.append(f"host={quote(hosts[0], safe='')}")
    elif network == 'mkcp':
        kcp_settings = stream_settings.get('kcpSettings', {})
        header = kcp_settings.get('header', {})
        header_type = header.get('type', 'none')
        seed = kcp_settings.get('seed', '')
        params.append(f"type=kcp")
        params.append(f"headerType={header_type}")
        if seed: params.append(f"seed={quote(seed, safe='')}")

    query = "&".join(params)
    return f"trojan://{password}@{host}:{port}?{query}#{quote(display_name)}"
