import json
import base64
from backend.links.protocols.utils import get_cert_sha256_fingerprint

def build_vmess_link(inbound: dict, client: dict, host: str, port: int, display_name: str, settings: dict, stream_settings: dict, network: str, security: str, security_cipher: str, alter_id: int) -> str:
    uid = client.get('client_uuid_or_pwd') or client.get('id')
    
    vmess_obj = {
        "v": "2",
        "ps": display_name,
        "add": host,
        "port": port,
        "id": uid,
        "aid": alter_id,
        "scy": security_cipher,
        "net": network,
        "type": "none",
        "host": "",
        "path": "",
        "tls": security if security in ('tls', 'reality') else "none",
        "sni": "",
        "fp": ""
    }
    
    if security == 'tls':
        tls_settings = stream_settings.get('tlsSettings', {})
        vmess_obj["sni"] = tls_settings.get('serverName', '')
        
        alpn = tls_settings.get('alpn', [])
        if alpn:
            vmess_obj["alpn"] = ','.join(alpn)
        
        fp = tls_settings.get('fingerprint', 'chrome')
        if fp:
            vmess_obj["fp"] = fp
        
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
                vmess_obj["pcs"] = fp_hash
    elif security == 'reality':
        reality_settings = stream_settings.get('realitySettings', {})
        vmess_obj["sni"] = reality_settings.get('serverName') or (reality_settings.get('serverNames', [''])[0])
        vmess_obj["fp"] = reality_settings.get('fingerprint', 'chrome')

    if network == 'tcp':
        tcp_settings = stream_settings.get('tcpSettings', {})
        header = tcp_settings.get('header', {})
        if header.get('type') == 'http':
            vmess_obj["type"] = "http"
            req = header.get('request', {})
            paths = req.get('path', ['/'])
            hosts = req.get('headers', {}).get('Host', [])
            if paths: vmess_obj["path"] = paths[0]
            if hosts: vmess_obj["host"] = hosts[0]
    elif network == 'ws':
        ws_settings = stream_settings.get('wsSettings', {})
        vmess_obj["path"] = ws_settings.get('path', '/')
        vmess_obj["host"] = ws_settings.get('headers', {}).get('Host', '')
    elif network == 'grpc':
        grpc_settings = stream_settings.get('grpcSettings', {})
        vmess_obj["path"] = grpc_settings.get('serviceName', 'grpc')
    elif network == 'h2':
        h2_settings = stream_settings.get('httpSettings', {})
        vmess_obj["path"] = h2_settings.get('path', '/')
        hosts = h2_settings.get('host', [])
        if hosts: vmess_obj["host"] = hosts[0]
    elif network == 'mkcp':
        kcp_settings = stream_settings.get('kcpSettings', {})
        header = kcp_settings.get('header', {})
        vmess_obj["type"] = header.get('type', 'none')
        vmess_obj["path"] = kcp_settings.get('seed', '')
    elif network == 'httpupgrade':
        hu_settings = stream_settings.get('httpupgradeSettings', {})
        vmess_obj["path"] = hu_settings.get('path', '/')
        vmess_obj["host"] = hu_settings.get('host', '')
    elif network == 'xhttp':
        xhttp_settings = stream_settings.get('xhttpSettings', {})
        vmess_obj["path"] = xhttp_settings.get('path', '/')
        vmess_obj["host"] = xhttp_settings.get('host', '')

    json_str = json.dumps(vmess_obj)
    b64_str = base64.b64encode(json_str.encode('utf-8')).decode('utf-8')
    return f"vmess://{b64_str}"
