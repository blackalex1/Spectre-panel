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
