from backend.database import get_all_outbounds, get_all_routing_rules, add_outbound, get_outbound_by_id, delete_outbound, add_routing_rule, get_routing_rule_by_id, delete_routing_rule

def test_routing_tab_features(client):
    """Test custom outbounds, routing rules, config builder integration, and API routes."""
    # 1. Verify default outbounds and rules seeded
    outbounds = get_all_outbounds()
    rules = get_all_routing_rules()
    
    assert len(outbounds) >= 2  # direct, blocked
    
    # Verify Direct (Freedom) exists
    direct_ob = next((ob for ob in outbounds if ob["tag"] == "direct"), None)
    assert direct_ob is not None
    assert direct_ob["protocol"] == "freedom"
    assert direct_ob["is_system"] == 1
    
    # 2. Test Outbounds Database CRUD
    ob_id = add_outbound(remark="Test SOCKS", protocol="socks", tag="test-socks", settings_dict={"servers": [{"address": "1.1.1.1", "port": 1080}]})
    assert ob_id is not None
    
    ob = get_outbound_by_id(ob_id)
    assert ob["remark"] == "Test SOCKS"
    assert ob["tag"] == "test-socks"
    
    # Try deleting system outbound (should fail)
    assert delete_outbound(direct_ob["id"]) is False
    
    # 3. Test Routing Rules Database CRUD
    rule_id = add_routing_rule(remark="Test Rule", outbound_tag="test-socks", domains=["domain:google.com"], ips=["8.8.8.8"])
    assert rule_id is not None
    
    rule = get_routing_rule_by_id(rule_id)
    assert rule["remark"] == "Test Rule"
    assert rule["outbound_tag"] == "test-socks"
    assert "domain:google.com" in rule["domains"]
    
    # 4. Test API routing endpoints
    headers = {"Authorization": "Bearer test_bearer_token"}
    
    # Get outbounds
    response = client.get("/api/routing/outbounds", headers=headers)
    assert response.status_code == 200
    assert response.json()["success"] is True
    
    # Create custom outbound
    payload = {
        "remark": "My Custom SOCKS",
        "protocol": "socks",
        "tag": "my-custom-socks",
        "settings": {"servers": [{"address": "2.2.2.2", "port": 1080}]},
        "enable": 1
    }
    response = client.post("/api/routing/outbounds/create", json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json()["success"] is True
    new_ob_id = response.json()["id"]
    
    # Delete custom outbound
    response = client.post(f"/api/routing/outbounds/delete/{new_ob_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["success"] is True
    
    # Create custom routing rule
    rule_payload = {
        "remark": "My Custom Rule",
        "outbound_tag": "direct",
        "domains": ["geosite:google"],
        "users": ["client@example.com"],
        "enable": 1
    }
    response = client.post("/api/routing/rules/create", json=rule_payload, headers=headers)
    assert response.status_code == 200
    assert response.json()["success"] is True
    new_rule_id = response.json()["id"]
    
    rule = get_routing_rule_by_id(new_rule_id)
    assert rule["users"] == ["client@example.com"]
    
    # Check Xray configuration includes user
    from backend.xray import generate_xray_config_json
    xray_config = generate_xray_config_json()
    rule_found = next((r for r in xray_config["routing"]["rules"] if r.get("outboundTag") == "direct" and "geosite:google" in r.get("domain", [])), None)
    assert rule_found is not None
    assert rule_found["user"] == ["client@example.com"]
    
    # Update sorting order
    response = client.post("/api/routing/rules/sort", json={"rule_ids": [new_rule_id, rule_id]}, headers=headers)
    assert response.status_code == 200
    assert response.json()["success"] is True
    
    # Clean up DB
    delete_routing_rule(rule_id)
    delete_routing_rule(new_rule_id)
    delete_outbound(ob_id)


def test_outbound_new_features(client, monkeypatch):
    """Test outbound traffic tracking, gRPC stats delta integration, and test endpoints."""
    headers = {"Authorization": "Bearer test_bearer_token"}
    
    # 1. Test outbound traffic increment helper in crud/outbounds
    from backend.database import add_outbound, get_outbound_by_id, update_outbound_traffic, delete_outbound
    ob_id = add_outbound(
        remark="Traffic Test SOCKS",
        protocol="socks",
        tag="traffic-socks",
        settings_dict={"servers": [{"address": "1.1.1.1", "port": 1080}]}
    )
    assert ob_id is not None
    
    # Initial traffic should be 0
    ob = get_outbound_by_id(ob_id)
    assert ob["up"] == 0
    assert ob["down"] == 0
    
    # Update traffic
    update_outbound_traffic("traffic-socks", 1000, 2000)
    ob = get_outbound_by_id(ob_id)
    assert ob["up"] == 1000
    assert ob["down"] == 2000
    
    # 2. Test integration with process_stats_deltas
    from backend.xray.service import process_stats_deltas, _last_session_stats
    _last_session_stats.clear() # clear mock session stats
    
    stats_list = [
        {"name": "outbound>>>traffic-socks>>>traffic>>>uplink", "value": "1500"},
        {"name": "outbound>>>traffic-socks>>>traffic>>>downlink", "value": "3500"}
    ]
    process_stats_deltas(stats_list)
    
    ob = get_outbound_by_id(ob_id)
    # 1000 + 1500 = 2500, 2000 + 3500 = 5500
    assert ob["up"] == 2500
    assert ob["down"] == 5500
    
    # 3. Test outbound test endpoint (TCP mock)
    # Mock tcp_ping in backend.routes.routing
    monkeypatch.setattr("backend.routes.routing.tcp_ping", lambda host, port: {"success": True, "ping": 12.34})
    
    payload = {
        "protocol": "socks",
        "settings": {"servers": [{"address": "1.1.1.1", "port": 1080}]},
        "test_type": "tcp"
    }
    response = client.post("/api/routing/outbounds/test", json=payload, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["ping"] == 12.34
    
    # 4. Test outbound test endpoint (HTTP mock)
    monkeypatch.setattr(
        "backend.routes.routing.test_outbound_transit",
        lambda protocol, settings, stream_settings=None: {"success": True, "ping": 56.78}
    )
    
    payload["test_type"] = "http"
    response = client.post("/api/routing/outbounds/test", json=payload, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["ping"] == 56.78
    
    # 5. Test outbound test by id endpoint
    response = client.post(f"/api/routing/outbounds/test/{ob_id}?test_type=tcp", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["ping"] == 12.34
    
    response = client.post(f"/api/routing/outbounds/test/{ob_id}?test_type=http", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["ping"] == 56.78
    
    # Clean up
    delete_outbound(ob_id)

