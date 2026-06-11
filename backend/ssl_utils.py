import os
import shutil
import subprocess
import logging
from pathlib import Path
from backend.config import CONFIG_DIR

SSL_CERT_PATH = CONFIG_DIR / "cert.pem"
SSL_KEY_PATH = CONFIG_DIR / "key.pem"

def generate_default_self_signed_cert():
    """Генерирует дефолтный самоподписанный сертификат для панели, если сертификатов нет"""
    if SSL_CERT_PATH.exists() and SSL_KEY_PATH.exists():
        return
        
    logging.info("Generating default self-signed SSL certificate for the panel...")
    try:
        openssl_bin = shutil.which("openssl") or "/usr/bin/openssl"
        if os.name == "nt":
            openssl_bin = shutil.which("openssl") or "openssl"
            
        cmd = [
            openssl_bin, "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", str(SSL_KEY_PATH), "-out", str(SSL_CERT_PATH),
            "-days", "365", "-nodes", "-subj", "/CN=localhost"
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # nosec B603
        
        try:
            os.chmod(SSL_CERT_PATH, 0o644)
            os.chmod(SSL_KEY_PATH, 0o600)
        except Exception:
            pass
            
        logging.info("Default self-signed SSL certificate generated successfully.")
    except Exception as e:
        logging.warning(f"Could not generate default self-signed certificate: {e}")

def request_ssl_cert(domain: str, email: str) -> tuple[bool, str]:
    """Выпускает SSL сертификат Let's Encrypt с помощью встроенного ACME HTTP-01 клиента"""
    logging.info(f"[SSL] Issuing Let's Encrypt certificate for domain {domain} via built-in ACME client...")
    from backend.acme_client import run_acme_flow
    try:
        # Выпускаем через Let's Encrypt Production
        success, msg, cert_pem, key_pem = run_acme_flow(domain, email, use_staging=False)
        if not success:
            return False, f"Ошибка выпуска сертификата: {msg}"
            
        # Записываем файлы сертификатов
        with open(SSL_CERT_PATH, "w", encoding="utf-8") as f:
            f.write(cert_pem)
        with open(SSL_KEY_PATH, "w", encoding="utf-8") as f:
            f.write(key_pem)
            
        try:
            os.chmod(SSL_CERT_PATH, 0o644)
            os.chmod(SSL_KEY_PATH, 0o600)
        except Exception as e:
            logging.error(f"Failed to set SSL certificate permissions: {e}")
            
        logging.info(f"[SSL] Certificate for {domain} successfully saved to {SSL_CERT_PATH}")
        return True, "Сертификат успешно выпущен и установлен."
    except Exception as e:
        return False, f"Исключение при выпуске сертификата: {e}"
