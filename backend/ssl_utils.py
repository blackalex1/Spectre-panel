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
    """Выпускает SSL сертификат Let's Encrypt с помощью Certbot в автономном (standalone) режиме"""
    logging.info(f"[SSL] Issuing Let's Encrypt certificate for domain {domain}...")
    
    # 1. Проверяем наличие certbot
    certbot_bin = shutil.which("certbot")
    if not certbot_bin:
        return False, "Certbot не установлен в системе. Пожалуйста, установите его (например: apt install certbot)."
        
    # 2. Вызываем certbot в standalone режиме (требует свободный порт 80)
    cmd = [
        certbot_bin, "certonly",
        "--standalone",
        "--non-interactive",
        "--agree-tos",
    ]
    if email:
        cmd.extend(["-m", email])
    else:
        cmd.append("--register-unsafely-without-email")
        
    cmd.extend([
        "-d", domain,
        "--preferred-challenges", "http",
        "--keep-until-expiring"
    ])
    
    try:
        # Увеличиваем таймаут, так как проверка Let's Encrypt может занимать время
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)  # nosec B603
        if result.returncode != 0:
            return False, f"Ошибка Certbot: {result.stderr or result.stdout}"
            
        # 3. Ищем пути к выпущенным файлам
        live_dir = Path(f"/etc/letsencrypt/live/{domain}")
        fullchain = live_dir / "fullchain.pem"
        privkey = live_dir / "privkey.pem"
        
        # Альтернативный путь на Windows
        if os.name == "nt":
            program_data = os.getenv("ProgramData", r"C:\Certbot")
            live_dir = Path(program_data) / "live" / domain
            fullchain = live_dir / "fullchain.pem"
            privkey = live_dir / "privkey.pem"
            
        if not fullchain.exists() or not privkey.exists():
            return False, "Сертификаты были успешно выпущены, но файлы не найдены по ожидаемому пути."
            
        # 4. Копируем файлы в директорию конфигурации панели
        shutil.copy(fullchain, SSL_CERT_PATH)
        shutil.copy(privkey, SSL_KEY_PATH)
        
        # Настройка прав
        try:
            os.chmod(SSL_CERT_PATH, 0o644)
            os.chmod(SSL_KEY_PATH, 0o600)
        except Exception as e:
            logging.error(f"Failed to set SSL certificate permissions: {e}")
            
        logging.info(f"[SSL] Certificate for {domain} successfully saved to {SSL_CERT_PATH}")
        return True, "Сертификат успешно выпущен и установлен."
    except subprocess.TimeoutExpired:
        return False, "Превышено время ожидания Certbot (60 сек). Убедитесь, что порт 80 открыт наружу и не занят другими процессами."
    except Exception as e:
        return False, f"Исключение при выпуске сертификата: {e}"
