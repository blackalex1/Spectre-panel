import os
import re
import ssl
import json
import time
import base64
import logging
import hashlib
import urllib.request
from typing import Dict, Tuple, Optional
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

# Global store for active ACME HTTP-01 challenges (token -> key_authorization)
ACME_CHALLENGES: Dict[str, str] = {}

def b64url(data: bytes) -> str:
    """Encodes bytes into base64url string as specified by RFC 7515."""
    return base64.urlsafe_b64encode(data).decode('utf-8').rstrip('=')

class AcmeClient:
    def __init__(self, use_staging: bool = False):
        if use_staging:
            self.directory_url = "https://acme-staging-v02.api.letsencrypt.org/directory"
        else:
            self.directory_url = "https://acme-v02.api.letsencrypt.org/directory"
        self.directory = {}
        self.account_url = None
        self.nonce = None
        
        # Generate new ES256 account key for ACME interactions
        self.account_key = ec.generate_private_key(ec.SECP256R1())
        
        # Calculate JWK and thumbprint
        pub_numbers = self.account_key.public_key().public_numbers()
        x_bytes = pub_numbers.x.to_bytes(32, 'big')
        y_bytes = pub_numbers.y.to_bytes(32, 'big')
        self.jwk = {
            "crv": "P-256",
            "kty": "EC",
            "x": b64url(x_bytes),
            "y": b64url(y_bytes)
        }
        jwk_json = json.dumps(self.jwk, sort_keys=True, separators=(',', ':'))
        self.thumbprint = b64url(hashlib.sha256(jwk_json.encode('utf-8')).digest())
        
    def _send_request(self, url: str, data: bytes = None, headers: dict = None, method: str = "POST") -> Tuple[int, dict, dict]:
        """Sends HTTP request to the ACME server."""
        if headers is None:
            headers = {}
        # Disable certificate verification only if needed, but for Let's Encrypt we keep it verified.
        ctx = ssl.create_default_context()
        
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
                res_headers = {k.lower(): v for k, v in resp.getheaders()}
                res_body = resp.read()
                try:
                    res_json = json.loads(res_body.decode('utf-8')) if res_body else {}
                except Exception:
                    res_json = {"raw": res_body.decode('utf-8', errors='ignore')}
                return resp.status, res_json, res_headers
        except urllib.request.HTTPError as e:
            res_headers = {k.lower(): v for k, v in e.headers.items()}
            res_body = e.read()
            try:
                res_json = json.loads(res_body.decode('utf-8')) if res_body else {}
            except Exception:
                res_json = {"raw": res_body.decode('utf-8', errors='ignore')}
            return e.code, res_json, res_headers
        except Exception as e:
            logging.error(f"[ACME Client] Network error to {url}: {e}")
            return 0, {}, {}

    def fetch_directory(self) -> bool:
        """Retrieves directories endpoints from Let's Encrypt."""
        status, res_json, _ = self._send_request(self.directory_url, method="GET")
        if status == 200:
            self.directory = res_json
            return True
        return False

    def get_nonce(self) -> str:
        """Fetches a fresh anti-replay nonce."""
        nonce_url = self.directory.get("newNonce")
        if not nonce_url:
            raise Exception("newNonce endpoint not found in directory")
        status, _, headers = self._send_request(nonce_url, method="HEAD")
        if "replay-nonce" in headers:
            self.nonce = headers["replay-nonce"]
            return self.nonce
        raise Exception("Failed to retrieve fresh nonce from ACME server")

    def _sign_and_post(self, url: str, payload: dict) -> Tuple[int, dict, dict]:
        """Wraps payload in JWS and sends POST request to URL."""
        if not self.nonce:
            self.get_nonce()
            
        protected = {
            "alg": "ES256",
            "nonce": self.nonce,
            "url": url
        }
        if self.account_url:
            protected["kid"] = self.account_url
        else:
            protected["jwk"] = self.jwk
            
        protected_b64 = b64url(json.dumps(protected).encode('utf-8'))
        payload_b64 = b64url(json.dumps(payload).encode('utf-8')) if payload is not None else ""
        
        signing_input = f"{protected_b64}.{payload_b64}".encode('utf-8')
        
        # Cryptography ES256 signing
        sig_der = self.account_key.sign(signing_input, ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(sig_der)
        sig_bytes = r.to_bytes(32, 'big') + s.to_bytes(32, 'big')
        sig_b64 = b64url(sig_bytes)
        
        jws = {
            "protected": protected_b64,
            "payload": payload_b64,
            "signature": sig_b64
        }
        
        jws_data = json.dumps(jws).encode('utf-8')
        headers = {"Content-Type": "application/jose+json"}
        
        status, res_json, headers = self._send_request(url, data=jws_data, headers=headers, method="POST")
        
        # Save returned nonce for next call
        if "replay-nonce" in headers:
            self.nonce = headers["replay-nonce"]
        else:
            self.nonce = None
            
        return status, res_json, headers

    def register_account(self, email: str) -> bool:
        """Registers a new ACME account with Let's Encrypt."""
        new_account_url = self.directory.get("newAccount")
        payload = {
            "termsOfServiceAgreed": True,
            "contact": [f"mailto:{email}"]
        }
        status, res_json, headers = self._sign_and_post(new_account_url, payload)
        if status in (200, 201):
            self.account_url = headers.get("location")
            logging.info(f"[ACME Client] Account registered successfully: {self.account_url}")
            return True
        logging.error(f"[ACME Client] Registration failed status={status}: {res_json}")
        return False

    def create_order(self, domain: str) -> Tuple[Optional[str], Optional[list], Optional[str]]:
        """Creates a new certificate order for the domain."""
        new_order_url = self.directory.get("newOrder")
        payload = {
            "identifiers": [{"type": "dns", "value": domain}]
        }
        status, res_json, headers = self._sign_and_post(new_order_url, payload)
        if status == 201:
            order_url = headers.get("location")
            authorizations = res_json.get("authorizations", [])
            finalize_url = res_json.get("finalize")
            return order_url, authorizations, finalize_url
        logging.error(f"[ACME Client] Order creation failed status={status}: {res_json}")
        return None, None, None

    def get_challenge_details(self, auth_url: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        """Retrieves HTTP-01 challenge from authorization URL."""
        status, res_json, _ = self._sign_and_post(auth_url, None)
        if status == 200:
            challenges = res_json.get("challenges", [])
            for chal in challenges:
                if chal.get("type") == "http-01":
                    return chal.get("token"), chal.get("url"), res_json.get("status")
        return None, None, None

    def trigger_challenge(self, chal_url: str) -> bool:
        """Informs the ACME server that the challenge is ready to be validated."""
        status, res_json, _ = self._sign_and_post(chal_url, {})
        if status == 200:
            return True
        logging.error(f"[ACME Client] Challenge trigger failed status={status}: {res_json}")
        return False

    def poll_authorization(self, auth_url: str) -> bool:
        """Polls the authorization status until valid or failed."""
        for _ in range(15):  # 15 attempts, 2 sec interval
            status, res_json, _ = self._sign_and_post(auth_url, None)
            if status == 200:
                auth_status = res_json.get("status")
                logging.info(f"[ACME Client] Authorization status: {auth_status}")
                if auth_status == "valid":
                    return True
                if auth_status in ("invalid", "revoked", "expired"):
                    logging.error(f"[ACME Client] Authorization failed with status: {auth_status}")
                    return False
            time.sleep(2)
        logging.error("[ACME Client] Authorization polling timed out.")
        return False

    def finalize_order(self, finalize_url: str, domain: str, domain_key: ec.EllipticCurvePrivateKey) -> Optional[str]:
        """Submits CSR to finalize certificate order."""
        # Generate CSR using cryptography
        csr = x509.CertificateSigningRequestBuilder().subject_name(x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, domain),
        ])).add_extension(
            x509.SubjectAlternativeName([x509.DNSName(domain)]),
            critical=False,
        ).sign(domain_key, hashes.SHA256())
        
        csr_der = csr.public_bytes(serialization.Encoding.DER)
        payload = {"csr": b64url(csr_der)}
        
        status, res_json, _ = self._sign_and_post(finalize_url, payload)
        if status == 200:
            return res_json.get("certificate")
        logging.error(f"[ACME Client] Finalization failed status={status}: {res_json}")
        return None

    def download_certificate(self, cert_url: str) -> Optional[str]:
        """Downloads certificate chain from URL."""
        status, res_json, _ = self._sign_and_post(cert_url, None)
        if status == 200:
            return res_json.get("raw")
        return None

def run_acme_flow(domain: str, email: str, use_staging: bool = False) -> Tuple[bool, str, Optional[str], Optional[str]]:
    """Runs full Let's Encrypt HTTP-01 flow and returns (success, message, cert_pem, key_pem)."""
    global ACME_CHALLENGES
    client = AcmeClient(use_staging=use_staging)
    
    if not client.fetch_directory():
        return False, "Failed to connect to ACME server directory", None, None
        
    if not client.register_account(email):
        return False, "Failed to register Let's Encrypt account", None, None
        
    # Create order
    order_url, auths, finalize_url = client.create_order(domain)
    if not order_url or not auths or not finalize_url:
        return False, "Failed to create Let's Encrypt order", None, None
        
    auth_url = auths[0]
    token, chal_url, auth_status = client.get_challenge_details(auth_url)
    if not token or not chal_url:
        return False, "Failed to fetch HTTP-01 challenge token", None, None
        
    if auth_status == "valid":
        logging.info("[ACME Client] Domain already authorized.")
    else:
        # Generate Key Authorization
        key_authorization = f"{token}.{client.thumbprint}"
        
        # Publish challenge token for FastAPI router to serve
        ACME_CHALLENGES[token] = key_authorization
        logging.info(f"[ACME Client] Published challenge authorization for token: {token}")
        
        # Trigger validation
        if not client.trigger_challenge(chal_url):
            ACME_CHALLENGES.pop(token, None)
            return False, "Failed to trigger ACME challenge validation", None, None
            
        # Poll authorization status
        success = client.poll_authorization(auth_url)
        ACME_CHALLENGES.pop(token, None)
        if not success:
            return False, "ACME domain authorization validation failed (Let's Encrypt was unable to reach /.well-known/acme-challenge/ over port 80)", None, None
            
    # Finalize certificate
    domain_key = ec.generate_private_key(ec.SECP256R1())
    cert_url = client.finalize_order(finalize_url, domain, domain_key)
    if not cert_url:
        return False, "Failed to finalize certificate order", None, None
        
    # Download PEM certificate chain
    status, res_json, _ = client._sign_and_post(cert_url, None)
    if status != 200:
        return False, "Failed to download certificate chain from ACME", None, None
        
    cert_pem = res_json.get("raw")
    key_pem = domain_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption()
    ).decode('utf-8')
    
    return True, "Certificate issued successfully!", cert_pem, key_pem
