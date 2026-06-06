import time
from backend.database import db_session
from backend.models import AuditLog

def test_audit_logging(client, monkeypatch):
    """Test backend audit logging creation and API retrieval."""
    import backend.routes.system
    monkeypatch.setattr(backend.routes.system, "check_auth", lambda r: True)
    
    with db_session() as session:
        # Clear existing logs for a predictable test
        session.query(AuditLog).delete()
        
        # Add a couple of audit logs
        log1 = AuditLog(timestamp=int(time.time()) - 10, username="test_admin", action="test_action_1", target="client1", details="details1")
        log2 = AuditLog(timestamp=int(time.time()), username="test_admin", action="test_action_2", target="client2", details="details2")
        session.add(log1)
        session.add(log2)
        
    # Get audit logs via API
    response = client.get("/api/audit-logs?page=1&limit=10")
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["success"] is True
    logs = res_data["obj"]["logs"]
    assert len(logs) >= 2
    # Check ordering (descending)
    assert logs[0]["action"] == "test_action_2"
    assert logs[1]["action"] == "test_action_1"
    
    # Test search query
    response = client.get("/api/audit-logs?search=test_action_1")
    assert response.status_code == 200
    res_data = response.json()
    assert len(res_data["obj"]["logs"]) == 1
    assert res_data["obj"]["logs"][0]["action"] == "test_action_1"
