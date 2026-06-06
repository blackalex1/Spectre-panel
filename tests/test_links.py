import json
import pytest
from backend.links_generator import get_client_links


def test_links_generator():
    """Test generated connection link strings formatting."""
    # VLESS Reality
    vless_inbound = {
        "protocol": "vless",
        "port": 443,
        "remark": "TestReality",
        "settings": json.dumps({
            "clients": [{"email": "alice", "flow": "xtls-rprx-vision"}]
        }),
        "stream_settings": json.dumps({
            "network": "tcp",
            "security": "reality",
            "realitySettings": {
                "serverName": "google.com",
                "publicKey": "pubkey123",
                "shortIds": ["abc12345"]
            }
        })
    }
    vless_client = {"client_uuid_or_pwd": "user-uuid-1", "email": "alice"}
    links = get_client_links(vless_inbound, vless_client, "my-vpn-domain.com")
    
    assert len(links) == 1
    assert "vless://user-uuid-1@my-vpn-domain.com:443" in links[0]
    assert "security=reality" in links[0]
    assert "pbk=pubkey123" in links[0]
    assert "sni=google.com" in links[0]
    assert "sid=abc12345" in links[0]
    assert "flow=xtls-rprx-vision" in links[0]

    # VLESS gRPC
    vless_grpc_inbound = {
        "protocol": "vless",
        "port": 443,
        "remark": "TestgRPC",
        "settings": json.dumps({"clients": []}),
        "stream_settings": json.dumps({
            "network": "grpc",
            "security": "none",
            "grpcSettings": {"serviceName": "my-grpc-service"}
        })
    }
    vless_grpc_client = {"client_uuid_or_pwd": "user-uuid-grpc", "email": "bob"}
    grpc_links = get_client_links(vless_grpc_inbound, vless_grpc_client, "my-vpn-domain.com")
    assert "serviceName=my-grpc-service" in grpc_links[0]
    assert "type=grpc" in grpc_links[0]

    # Hysteria 2
    hyst_inbound = {
        "protocol": "hysteria2",
        "port": 8443,
        "remark": "TestHysteria",
        "settings": "{}",
        "stream_settings": json.dumps({
            "hysteria": {
                "obfsPassword": "obfs_link_pwd",
                "hop": "20000-30000"
            }
        })
    }
    hyst_client = {"client_uuid_or_pwd": "clientpass123", "email": "bob"}
    links = get_client_links(hyst_inbound, hyst_client, "1.2.3.4")
    
    assert len(links) == 1
    assert "hysteria2://bob:clientpass123@1.2.3.4:8443" in links[0]
    assert ("insecure=1" in links[0]) or ("pinSHA256=" in links[0])
    assert "sni=1.2.3.4" not in links[0]
    assert "obfs=salamander" in links[0]
    assert "obfs-password=obfs_link_pwd" in links[0]
    assert "hop=20000-30000" in links[0]


def test_advanced_links_generator():
    """Test link generator outputting advanced transports and VMess client alterId/security."""
    import base64
    # 1. VMess Client settings extraction
    vmess_inbound = {
        "protocol": "vmess",
        "port": 5001,
        "remark": "VMessLink",
        "settings": json.dumps({
            "clients": [{"email": "user1", "alterId": 64, "security": "aes-128-gcm"}]
        }),
        "stream_settings": json.dumps({
            "network": "h2",
            "security": "tls",
            "tlsSettings": {"serverName": "mysni.com"},
            "httpSettings": {"path": "/mypath", "host": ["myhost.com"]}
        })
    }
    client_stat = {"client_uuid_or_pwd": "my-uuid-xyz", "email": "user1"}
    
    links = get_client_links(vmess_inbound, client_stat, "myvpn.com")
    assert len(links) == 1
    
    # Decrypt base64 vmess link
    link = links[0]
    assert link.startswith("vmess://")
    b64_part = link.split("vmess://")[1]
    decoded = json.loads(base64.b64decode(b64_part.encode('utf-8')).decode('utf-8'))
    
    assert decoded["aid"] == 64
    assert decoded["scy"] == "aes-128-gcm"
    assert decoded["net"] == "h2"
    assert decoded["path"] == "/mypath"
    assert decoded["host"] == "myhost.com"
    assert decoded["sni"] == "mysni.com"

    # 2. Hysteria 2 Port Hopping link
    hyst_inbound = {
        "protocol": "hysteria2",
        "port": 6002,
        "remark": "HystLink",
        "settings": "{}",
        "stream_settings": json.dumps({
            "hysteria": {
                "obfsPassword": "obfspass",
                "hop": "10000-20000"
            }
        })
    }
    hyst_client = {"client_uuid_or_pwd": "pass", "email": "user1"}
    
    links = get_client_links(hyst_inbound, hyst_client, "1.1.1.1")
    assert "hop=10000-20000" in links[0]


def test_vless_encryption_link():
    """Test generated connection link containing VLESS Encryption key."""
    vless_inbound = {
        "protocol": "vless",
        "port": 443,
        "remark": "VlessEncLink",
        "settings": json.dumps({
            "clients": [{"email": "alice", "flow": "xtls-rprx-vision"}],
            "encryption": "mlkem768x25519plus.native.0rtt.myclientenckey"
        }),
        "stream_settings": json.dumps({
            "network": "tcp",
            "security": "reality",
            "realitySettings": {
                "serverName": "google.com",
                "publicKey": "pubkey123",
                "shortIds": ["abc12345"]
            }
        })
    }
    vless_client = {"client_uuid_or_pwd": "user-uuid-1", "email": "alice"}
    links = get_client_links(vless_inbound, vless_client, "my-vpn-domain.com")
    
    assert len(links) == 1
    assert "encryption=mlkem768x25519plus.native.0rtt.myclientenckey" in links[0]

