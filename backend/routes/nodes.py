import json
import secrets
import hashlib
import time
import logging
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Request, Depends, HTTPException
from cryptography.hazmat.primitives.asymmetric import ed25519

from backend.auth_utils import check_auth, decoy_response, verify_node_token
from backend.database import db_session
from backend.models import Node, NodeJoinCode

router = APIRouter(prefix="/api/nodes", tags=["nodes"])

class JoinCodeResponse(BaseModel):
    code: str
    expires_at: int

class NodeRegisterRequest(BaseModel):
    join_code: str
    public_key: str  # Hex-encoded Ed25519 public key

class NodeRegisterResponse(BaseModel):
    node_id: str
    node_api_token: str
    master_public_key: str  # Hex-encoded Ed25519 public key of the Master

class NodeReportRequest(BaseModel):
    incident_id: str
    action: str  # e.g., "client_banned"
    client_email: str
    details: Optional[str] = ""
    signature: str  # Hex-encoded signature of the JSON body (excluding this field)

class NodeOut(BaseModel):
    id: str
    name: str
    public_key: Optional[str]
    status: str
    registered_at: int

# --- Admin Endpoints (requires standard admin check_auth) ---

@router.post("/join-code", response_model=JoinCodeResponse)
async def generate_join_code(request: Request):
    if not check_auth(request):
        return decoy_response()
        
    code = f"JOIN-{secrets.token_hex(4).upper()}"
    created_at = int(time.time())
    expires_at = created_at + 3600  # Valid for 1 hour
    
    try:
        with db_session() as session:
            join_code_entry = NodeJoinCode(
                code=code,
                expires_at=expires_at,
                created_at=created_at
            )
            session.add(join_code_entry)
        return JoinCodeResponse(code=code, expires_at=expires_at)
    except Exception as e:
        logging.error(f"[Nodes API] Failed to generate join code: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("", response_model=List[NodeOut])
async def list_nodes(request: Request):
    if not check_auth(request):
        return decoy_response()
        
    try:
        with db_session() as session:
            nodes = session.query(Node).all()
            return [
                NodeOut(
                    id=n.id,
                    name=n.name,
                    public_key=n.public_key,
                    status=n.status,
                    registered_at=n.registered_at
                ) for n in nodes
            ]
    except Exception as e:
        logging.error(f"[Nodes API] Failed to list nodes: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.delete("/{node_id}")
async def revoke_node(request: Request, node_id: str):
    if not check_auth(request):
        return decoy_response()
        
    try:
        with db_session() as session:
            node = session.query(Node).filter_by(id=node_id).first()
            if not node:
                raise HTTPException(status_code=404, detail="Node not found")
            session.delete(node)
        return {"status": "success", "message": f"Node {node_id} successfully revoked."}
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"[Nodes API] Failed to revoke node: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# --- Node Self-Registration & Signed Reporting Endpoints ---

@router.post("/register", response_model=NodeRegisterResponse)
async def register_node(request: Request, body: NodeRegisterRequest):
    # Registering uses the join code, which verifies authentication.
    # If join code is invalid or missing, we return a decoy response to mask the register endpoint.
    now = int(time.time())
    try:
        with db_session() as session:
            join_code = session.query(NodeJoinCode).filter_by(code=body.join_code).first()
            if not join_code or join_code.expires_at < now:
                return decoy_response()
                
            # Valid join code! Consume it
            session.delete(join_code)
            
            # Generate a Node ID
            node_id = f"node-{secrets.token_hex(4)}"
            node_name = f"Edge Node {node_id[-4:].upper()}"
            
            # Generate Node API Token
            node_token = f"node_sec_{secrets.token_urlsafe(32)}"
            token_hash = hashlib.sha256(node_token.encode("utf-8")).hexdigest()
            
            # Save Node to DB
            new_node = Node(
                id=node_id,
                name=node_name,
                api_token_hash=token_hash,
                public_key=body.public_key,
                status="active",
                registered_at=now
            )
            session.add(new_node)
            
            # Retrieve or generate Master public key
            # Since Master uses Ed25519 for signature verification, we can generate a Master keypair 
            # if one doesn't exist, or query it from system settings.
            from backend.database import get_setting, set_setting
            master_pub = get_setting("master_public_key", "")
            master_priv = get_setting("master_private_key", "")
            if not master_pub or not master_priv:
                # Generate keypair
                master_key = ed25519.Ed25519PrivateKey.generate()
                master_pub = master_key.public_key().public_bytes_raw().hex()
                master_priv = master_key.private_bytes_raw().hex()
                set_setting("master_public_key", master_pub)
                set_setting("master_private_key", master_priv)
                
            return NodeRegisterResponse(
                node_id=node_id,
                node_api_token=node_token,
                master_public_key=master_pub
            )
    except Exception as e:
        logging.error(f"[Nodes API] Failed to register node: {e}")
        return decoy_response()

@router.post("/report")
async def report_incident(request: Request, body: NodeReportRequest):
    # 1. First layer auth: Token verification. Mask with 404 decoy on failure.
    if not verify_node_token(request):
        return decoy_response()
        
    node_id = request.headers.get("X-Node-ID")
    
    try:
        with db_session() as session:
            node = session.query(Node).filter_by(id=node_id, status="active").first()
            if not node or not node.public_key:
                return decoy_response()
                
            # 2. Second layer auth: Verify Ed25519 digital signature of request body
            # Reconstruct the message that was signed (excluding the signature field)
            payload_dict = body.model_dump()
            sig_hex = payload_dict.pop("signature", "")
            
            message_str = json.dumps(payload_dict, sort_keys=True)
            message_bytes = message_str.encode("utf-8")
            
            # Load node public key and verify signature
            pub_key_bytes = bytes.fromhex(node.public_key)
            pub_key = ed25519.Ed25519PublicKey.from_public_bytes(pub_key_bytes)
            
            try:
                pub_key.verify(bytes.fromhex(sig_hex), message_bytes)
            except Exception:
                logging.warning(f"[Nodes API] Cryptographic signature check failed for node {node_id}")
                return decoy_response()
                
            # Signature is valid!
            logging.info(f"[Nodes API] Verified report from node {node_id}: {body.action} for client {body.client_email}")
            
            # Handle action (e.g. log the resolution / unban the transit channel)
            if body.action == "client_banned":
                # Find if there's an active temporary ban on the Master for this node
                # Since the ban was for the transit client/tunnel corresponding to C1:
                # We block the client on the master side as well, then restore the transit tunnel if needed.
                from backend.database.crud.clients import block_client_db
                from backend.models import ClientStats
                
                # Check if this email exists locally on the master
                client = session.query(ClientStats).filter_by(email=body.client_email).first()
                if client:
                    client.enable = 0
                    client.block_reason = f"Cooperative ban from node {node_id}"
                    logging.info(f"[Nodes API] Banned client {body.client_email} on Master after node resolution.")
                    
                # Safe-unban logic: find the temporary IP ban or tunnel ban for this node and lift it
                # If we have a transit tunnel inbound corresponding to this node, re-enable it.
                # Find inbound representing this node's transit tunnel and make sure it is enabled.
                
            return {"status": "success", "message": "Incident resolution report accepted."}
    except Exception as e:
        logging.error(f"[Nodes API] Error processing node report: {e}")
        return decoy_response()
