import pytest
import backend.watchdog_state
from backend.database import db_session, set_setting, get_setting
from backend.models import Inbound, ClientStats
from backend.scheduler import run_service_watchdog
from backend.watchdog_state import reset_xray_watchdog, reset_hysteria_watchdog

def test_free_port_selection(client):
    """Test that free port API successfully searches and returns a free port."""
    headers = {"Authorization": "Bearer test_bearer_token"}
    response = client.get("/api/system/free-port", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert 20000 <= data["port"] <= 65535

def test_backup_settings_update(client):
    """Test that settings GET and POST API endpoints support backup options."""
    headers = {"Authorization": "Bearer test_bearer_token"}
    
    # 1. Update settings with backup options
    payload = {
        "backup_enable": True,
        "backup_interval": "hourly",
        "backup_rotation": 5,
        "backup_telegram": True
    }
    response = client.post("/api/settings/update", json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json()["success"] is True
    
    # 2. Get settings and verify
    response = client.get("/api/settings", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["backup_enable"] is True
    assert data["backup_interval"] == "hourly"
    assert data["backup_rotation"] == 5
    assert data["backup_telegram"] is True

def test_watchdog_restart_behavior(monkeypatch):
    """Test that watchdog attempts to restart core service when it is dead and active inbounds exist."""
    # Reset watchdog counters
    backend.watchdog_state.reset_xray_watchdog()
    backend.watchdog_state.reset_hysteria_watchdog()
    
    # 1. Create active xray inbound in the db
    with db_session() as session:
        # Clear existing to be sure
        session.query(Inbound).delete()
        ib = Inbound(
            remark="Watchdog test inbound",
            port=31244,
            protocol="vless",
            settings="{}",
            stream_settings="{}",
            sniffing="{}",
            enable=1
        )
        session.add(ib)
        session.commit()

    # 2. Mock state and functions
    monkeypatch.setattr("backend.scheduler.is_xray_running", lambda: False)
    
    restarts_called = 0
    def mock_restart_xray():
        nonlocal restarts_called
        restarts_called += 1
        
    monkeypatch.setattr("backend.scheduler.restart_xray", mock_restart_xray)
    
    # 3. Trigger watchdog
    run_service_watchdog()
    assert restarts_called == 1
    assert backend.watchdog_state.consecutive_xray_restarts == 1

    # 4. Trigger again, should call restart again
    run_service_watchdog()
    assert restarts_called == 2
    assert backend.watchdog_state.consecutive_xray_restarts == 2

    # 5. Trigger again, should call restart again (restarts_called = 3, counter = 3)
    run_service_watchdog()
    assert restarts_called == 3
    assert backend.watchdog_state.consecutive_xray_restarts == 3

    # 6. Trigger again, should NOT call restart (max 3 consecutive attempts)
    run_service_watchdog()
    assert restarts_called == 3
    assert backend.watchdog_state.consecutive_xray_restarts == 3

def test_global_traffic_history_endpoint(client):
    """Test global traffic history API endpoint."""
    headers = {"Authorization": "Bearer test_bearer_token"}
    response = client.get("/panel/api/system/global-traffic", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert len(data["obj"]) == 30

def test_acme_challenge_endpoint(client):
    """Test the ACME HTTP-01 challenge response route."""
    from backend.acme_client import ACME_CHALLENGES
    
    token = "test-acme-token-123"
    auth_val = "test-key-authorization-xyz"
    
    ACME_CHALLENGES[token] = auth_val
    try:
        # Request non-existing token
        resp_404 = client.get("/.well-known/acme-challenge/non-existent-token")
        assert resp_404.status_code == 404
        
        # Request existing token
        resp_200 = client.get(f"/.well-known/acme-challenge/{token}")
        assert resp_200.status_code == 200
        assert resp_200.text == auth_val
        assert resp_200.headers["content-type"].startswith("text/plain")
    finally:
        ACME_CHALLENGES.pop(token, None)


def test_quick_block_rules_injection():
    """Test that quick blocking rules are successfully injected into Xray config."""
    from backend.xray.config import generate_xray_config_json
    from backend.database import set_setting
    
    # 1. Enable blocking settings
    set_setting("block_bittorrent", "true")
    set_setting("block_ads", "true")
    set_setting("block_cn", "true")
    set_setting("block_ru", "false")
    set_setting("block_us", "true")
    
    try:
        config = generate_xray_config_json()
        routing = config.get("routing", {})
        rules = routing.get("rules", [])
        
        # Verify bittorrent blocks
        bt_proto_rule = next((r for r in rules if r.get("protocol") == ["bittorrent"]), None)
        assert bt_proto_rule is not None
        assert bt_proto_rule["outboundTag"] == "blocked"
        
        bt_domain_rule = next((r for r in rules if "geosite:torrent" in r.get("domain", [])), None)
        assert bt_domain_rule is not None
        assert bt_domain_rule["outboundTag"] == "blocked"
        
        # Verify ads block
        ads_rule = next((r for r in rules if "geosite:category-ads-all" in r.get("domain", [])), None)
        assert ads_rule is not None
        assert ads_rule["outboundTag"] == "blocked"
        
        # Verify country blocks (cn, us enabled; ru disabled)
        country_rule = next((r for r in rules if any("cn" in ip for ip in r.get("ip", []))), None)
        assert country_rule is not None
        assert country_rule["outboundTag"] == "blocked"
        assert "geoip:cn" in country_rule["ip"]
        assert "geoip:us" in country_rule["ip"]
        assert "geoip:ru" not in country_rule["ip"]
        
    finally:
        # Reset settings
        set_setting("block_bittorrent", "false")
        set_setting("block_ads", "false")
        set_setting("block_cn", "false")
        set_setting("block_ru", "false")
        set_setting("block_us", "false")


def test_warp_registration_mock(client, monkeypatch):
    """Test the WARP outbound generation endpoint."""
    headers = {"Authorization": "Bearer test_bearer_token"}
    
    # Mock register_warp helper
    mock_warp_data = {
        "private_key": "mock_priv_key",
        "public_key": "mock_pub_key",
        "address_v4": "172.16.0.2/32",
        "address_v6": "2606:4700::1/128",
        "peer_public_key": "mock_peer_pub_key",
        "endpoint": "engage.cloudflareclient.com:2408",
        "reserved": [1, 2, 3]
    }
    
    monkeypatch.setattr("backend.utils.warp.register_warp", lambda: mock_warp_data)
    
    response = client.post("/api/routing/outbounds/generate-warp", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["obj"] == mock_warp_data


def test_port_scan_detection_logic(monkeypatch, tmp_path):
    """Test that port scan detection blocks clients exceeding unique IP limit."""
    from backend.scheduler import detect_and_block_port_scans
    from backend.database import set_setting, get_setting, db_session
    from backend.models import ClientStats, Inbound
    import backend.scheduler
    import json
    
    # Setup temporary log paths
    xray_log = tmp_path / "xray.log"
    hysteria_log = tmp_path / "hysteria.log"
    
    monkeypatch.setattr(backend.scheduler, "XRAY_LOG_PATH", xray_log)
    monkeypatch.setattr(backend.scheduler, "HYSTERIA_LOG_PATH", hysteria_log)
    
    # 1. Add mock client and inbound in database
    with db_session() as session:
        session.query(ClientStats).delete()
        session.query(Inbound).delete()
        
        ib = Inbound(
            id=123,
            remark="Test Inbound",
            port=50000,
            protocol="vless",
            settings=json.dumps({"clients": [{"email": "scanner@test.com", "enable": True}]}),
            stream_settings="{}",
            sniffing="{}",
            enable=1
        )
        session.add(ib)
        session.commit()
        
        cs = ClientStats(
            email="scanner@test.com",
            inbound_id=123,
            client_uuid_or_pwd="mock-uuid-12345",
            enable=1
        )
        session.add(cs)
        session.commit()
        
    # 2. Write simulated logs (>200 unique IPs targeted in last 10 seconds)
    import datetime
    now_str = datetime.datetime.now().strftime("%Y/%m/%d %H:%M:%S")
    
    log_lines = []
    for i in range(210):
        log_lines.append(f"{now_str} [Info] inbound/vless -> outbound/direct: tcp:10.0.0.{i}:80 accepted email: scanner@test.com\n")
        
    xray_log.write_text("".join(log_lines))
    
    # Mock Telegram notification and core manipulation to avoid network requests or complex dependencies
    monkeypatch.setattr(backend.scheduler, "asyncio_notify_admin", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend.scheduler, "remove_client_api", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend.scheduler, "write_xray_config", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend.scheduler, "restart_hysteria", lambda *args, **kwargs: None)
    
    # 3. Trigger detector
    detect_and_block_port_scans()
    
    # 4. Verify client is banned in DB
    with db_session() as session:
        client_stat = session.query(ClientStats).filter_by(email="scanner@test.com").first()
        assert client_stat is not None
        assert client_stat.enable == 0
        assert "IPS Auto-blocked" in client_stat.block_reason
        
        # Verify inbound settings JSON also disabled the client
        ib = session.query(Inbound).filter_by(id=123).first()
        ib_settings = json.loads(ib.settings)
        assert ib_settings["clients"][0]["enable"] is False

