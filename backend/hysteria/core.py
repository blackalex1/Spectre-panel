import os
import logging
import subprocess
import requests
import shutil
import platform
import backend.hysteria

def _get_bin_suffix():
    arch = platform.machine().lower()
    return "arm64" if ("arm64" in arch or "aarch64" in arch) else "amd64"

def get_latest_hysteria_version_info():
    """Получает последний релиз Hysteria с GitHub"""
    url = "https://api.github.com/repos/apernet/hysteria/releases/latest"
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            tag_name = data.get("tag_name")
            if tag_name and tag_name.startswith("app/"):
                tag_name = tag_name[4:]
            assets = data.get("assets", [])
            
            target_name = backend.hysteria.HYSTERIA_BIN_NAME
            download_url = None
            for asset in assets:
                if asset.get("name") == target_name:
                    download_url = asset.get("browser_download_url")
                    break
            
            return {"version": tag_name, "download_url": download_url}
    except Exception as e:
        logging.error(f"Failed to fetch Hysteria version info from GitHub: {e}")
    return None

def download_hysteria_core(download_url: str = None):
    """Скачивает и устанавливает бинарник Hysteria"""
    if not download_url:
        info = backend.hysteria.get_latest_hysteria_version_info()
        if not info or not info["download_url"]:
            raise Exception("Could not find Hysteria download URL automatically.")
        download_url = info["download_url"]
        version = info["version"]
    else:
        from urllib.parse import urlparse
        try:
            parsed = urlparse(download_url)
            is_safe = (
                parsed.scheme == "https"
                and parsed.netloc.lower() == "github.com"
                and parsed.path.startswith("/apernet/hysteria/releases/download/")
            )
        except Exception:
            is_safe = False
            
        if not is_safe:
            raise ValueError("Недопустимый URL для скачивания. Разрешены только официальные релизы Hysteria на GitHub.")
            
        version = "custom"
        
    logging.info(f"Downloading Hysteria 2 from {download_url}...")
    response = requests.get(download_url, stream=True, timeout=30)
    response.raise_for_status()
    
    temp_bin_path = backend.hysteria.HYSTERIA_BIN_PATH.with_suffix(".tmp")
    try:
        with open(temp_bin_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
                
        if not backend.hysteria.IS_WINDOWS:
            try:
                os.chmod(temp_bin_path, 0o755)  # nosec B103
                logging.info("Chmod +x set on temporary Hysteria binary.")
            except Exception as e:
                logging.error(f"Failed to set executable on temporary Hysteria binary: {e}")
                
        # Проверяем работоспособность временного бинарника
        try:
            cmd = [str(temp_bin_path), "version"]
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", timeout=5)  # nosec B603
            if result.returncode != 0:
                err_msg = result.stderr.strip() or result.stdout.strip()
                raise Exception(f"Self-test returned non-zero code {result.returncode}: {err_msg}")
        except Exception as e:
            raise Exception(f"Downloaded Hysteria binary failed self-test verification: {str(e)}")
            
        if backend.hysteria.HYSTERIA_BIN_PATH.exists():
            try:
                os.remove(backend.hysteria.HYSTERIA_BIN_PATH)
            except Exception as e:
                logging.warning(f"Could not remove old Hysteria binary before replacing: {e}")
        
        shutil.move(str(temp_bin_path), str(backend.hysteria.HYSTERIA_BIN_PATH))
        logging.info("Hysteria core successfully verified and installed.")
    finally:
        if temp_bin_path.exists():
            try:
                os.remove(temp_bin_path)
            except Exception:
                pass
                
    return version

def ensure_hysteria_installed():
    need_install = False
    if not backend.hysteria.HYSTERIA_BIN_PATH.exists():
        need_install = True
    else:
        try:
            cmd = [str(backend.hysteria.HYSTERIA_BIN_PATH), "version"]
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
            if result.returncode != 0:
                need_install = True
        except Exception:
            need_install = True
            
    if need_install:
        logging.info("Hysteria 2 core not found or not working (wrong architecture?). Installing/Updating...")
        try:
            backend.hysteria.download_hysteria_core()
        except Exception as e:
            logging.error(f"Error installing Hysteria core: {e}")

def get_installed_hysteria_version() -> str:
    """Runs 'hysteria version' to get the currently installed version dynamically."""
    if not backend.hysteria.HYSTERIA_BIN_PATH.exists():
        return "Not Installed"
    try:
        cmd = [str(backend.hysteria.HYSTERIA_BIN_PATH), "version"]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", timeout=5)  # nosec B603
        if result.returncode == 0:
            full_output = (result.stdout or "") + (result.stderr or "")
            lines = [line.strip() for line in full_output.split("\n") if line.strip()]
            
            for line in lines:
                if line.lower().startswith("version:"):
                    parts = line.split(":", 1)
                    if len(parts) == 2:
                        val = parts[1].strip()
                        if val.startswith("v") and len(val) > 1 and val[1].isdigit():
                            return val
                        if len(val) > 0 and val[0].isdigit() and "." in val:
                            return "v" + val
                        return val
                
                parts = line.split()
                for part in parts:
                    part_clean = part.strip(",()[]{}")
                    if part_clean.startswith("v") and len(part_clean) > 1 and part_clean[1].isdigit():
                        return part_clean
                    if len(part_clean) > 0 and part_clean[0].isdigit() and "." in part_clean:
                        return "v" + part_clean
            
            if lines:
                parts = lines[0].split()
                if len(parts) >= 2:
                    return parts[1].strip(",()[]{}")
                return lines[0]
            return "Unknown"
        else:
            logging.warning(f"Hysteria version command returned non-zero code {result.returncode}: {result.stderr}")
            return f"Error (code {result.returncode}): {result.stderr.strip() or result.stdout.strip()}"
    except Exception as e:
        logging.error(f"Failed to check Hysteria version: {e}")
        return f"Error: {str(e)}"

def generate_self_signed_cert():
    """Генерирует самоподписанный сертификат для Hysteria, если его нет"""
    if backend.hysteria.HYSTERIA_CERT_PATH.exists() and backend.hysteria.HYSTERIA_KEY_PATH.exists():
        return
        
    logging.info("Generating self-signed SSL certificate for Hysteria 2...")
    try:
        if backend.hysteria.IS_WINDOWS:
            openssl_path = shutil.which("openssl") or "openssl"
            cmd = [
                openssl_path, "req", "-x509", "-newkey", "rsa:2048", 
                "-keyout", str(backend.hysteria.HYSTERIA_KEY_PATH), "-out", str(backend.hysteria.HYSTERIA_CERT_PATH), 
                "-days", "365", "-nodes", "-subj", "/CN=localhost"
            ]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # nosec B603
        else:
            openssl_path = shutil.which("openssl") or "/usr/bin/openssl"
            cmd = [
                openssl_path, "req", "-x509", "-newkey", "rsa:2048", 
                "-keyout", str(backend.hysteria.HYSTERIA_KEY_PATH), "-out", str(backend.hysteria.HYSTERIA_CERT_PATH), 
                "-days", "365", "-nodes", "-subj", "/CN=localhost"
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # nosec B603
        logging.info("Self-signed SSL certificate generated.")
    except Exception as e:
        logging.warning(f"Could not generate self-signed certificate using OpenSSL: {e}. Hysteria 2 might require a manual certificate config.")
