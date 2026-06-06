import os
import logging
import zipfile
import shutil
import subprocess
import requests
import platform
import backend.xray

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

def get_latest_xray_version_info():
    """Получает информацию о последнем релизе Xray-core с GitHub"""
    url = "https://api.github.com/repos/XTLS/Xray-core/releases/latest"
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            tag_name = data.get("tag_name")
            assets = data.get("assets", [])
            
            arch = platform.machine().lower()
            is_arm = "arm64" in arch or "aarch64" in arch
            if backend.xray.IS_WINDOWS:
                target_name = "Xray-windows-arm64-v8a.zip" if is_arm else "Xray-windows-64.zip"
            else:
                target_name = "Xray-linux-arm64-v8a.zip" if is_arm else "Xray-linux-64.zip"
                
            download_url = None
            for asset in assets:
                if asset.get("name") == target_name:
                    download_url = asset.get("browser_download_url")
                    break
            
            return {"version": tag_name, "download_url": download_url}
    except Exception as e:
        logging.error(f"Failed to fetch Xray version info from GitHub: {e}")
    return None

def download_xray_core(download_url: str = None):
    """Скачивает и распаковывает ядро Xray"""
    if not download_url:
        info = backend.xray.get_latest_xray_version_info()
        if not info or not info["download_url"]:
            raise Exception("Could not find Xray download URL automatically.")
        download_url = info["download_url"]
        version = info["version"]
    else:
        from urllib.parse import urlparse
        try:
            parsed = urlparse(download_url)
            is_safe = (
                parsed.scheme == "https"
                and parsed.netloc.lower() == "github.com"
                and parsed.path.startswith("/XTLS/Xray-core/releases/download/")
            )
        except Exception:
            is_safe = False
            
        if not is_safe:
            raise ValueError("Недопустимый URL для скачивания. Разрешены только официальные релизы Xray-core на GitHub.")
            
        version = "custom"

    zip_path = backend.xray.BIN_DIR / "xray_temp.zip"
    temp_extract_dir = backend.xray.BIN_DIR / "xray_temp_extract"
    
    logging.info(f"Downloading Xray from {download_url}...")
    try:
        response = requests.get(download_url, stream=True, timeout=30)
        response.raise_for_status()
        with open(zip_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
                
        logging.info("Extracting Xray archive to temporary directory...")
        if temp_extract_dir.exists():
            shutil.rmtree(temp_extract_dir)
        temp_extract_dir.mkdir(parents=True, exist_ok=True)
        
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(temp_extract_dir)
            
        temp_xray_bin_path = temp_extract_dir / backend.xray.XRAY_BIN_NAME
        if not temp_xray_bin_path.exists():
            raise Exception(f"Xray binary '{backend.xray.XRAY_BIN_NAME}' not found in the downloaded archive.")
            
        if not backend.xray.IS_WINDOWS:
            try:
                os.chmod(temp_xray_bin_path, 0o755)  # nosec B103
                logging.info("Chmod +x set on temporary Xray binary.")
            except Exception as e:
                logging.error(f"Failed to set executable permission on temporary Linux binary: {e}")
                
        # Проверяем работоспособность временного бинарника
        try:
            cmd = [str(temp_xray_bin_path), "version"]
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", timeout=5)  # nosec B603
            if result.returncode != 0:
                err_msg = result.stderr.strip() or result.stdout.strip()
                raise Exception(f"Self-test returned non-zero code {result.returncode}: {err_msg}")
        except Exception as e:
            raise Exception(f"Downloaded Xray binary failed self-test verification: {str(e)}")
            
        # Копируем/переносим файлы в рабочую папку BIN_DIR
        for item in temp_extract_dir.iterdir():
            dest = backend.xray.BIN_DIR / item.name
            if item.is_dir():
                if dest.exists():
                    shutil.rmtree(dest)
                shutil.move(str(item), str(dest))
            else:
                if dest.exists():
                    try:
                        os.remove(dest)
                    except Exception as e:
                        logging.warning(f"Could not remove old file {dest.name} before replacing: {e}")
                shutil.move(str(item), str(dest))
                
        if not backend.xray.IS_WINDOWS:
            try:
                os.chmod(backend.xray.XRAY_BIN_PATH, 0o755)  # nosec B103
            except Exception:
                pass
                
        logging.info("Xray core successfully verified and installed.")
    finally:
        if zip_path.exists():
            try:
                os.remove(zip_path)
            except Exception:
                pass
        if temp_extract_dir.exists():
            try:
                shutil.rmtree(temp_extract_dir)
            except Exception:
                pass
                
    return version

def ensure_xray_installed():
    """Проверяет наличие Xray, скачивает при необходимости"""
    need_install = False
    if not backend.xray.XRAY_BIN_PATH.exists():
        need_install = True
    else:
        try:
            cmd = [str(backend.xray.XRAY_BIN_PATH), "version"]
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3)
            if result.returncode != 0:
                need_install = True
        except Exception:
            need_install = True
            
    if need_install:
        logging.info("Xray core not found or not working (wrong architecture?). Installing/Updating...")
        try:
            backend.xray.download_xray_core()
        except Exception as e:
            logging.error(f"Error during Xray core installation: {e}")

def get_installed_xray_version() -> str:
    """Runs 'xray version' to get the currently installed version dynamically."""
    if not backend.xray.XRAY_BIN_PATH.exists():
        return "Not Installed"
    try:
        cmd = [str(backend.xray.XRAY_BIN_PATH), "version"]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", timeout=5)  # nosec B603
        if result.returncode == 0:
            full_output = (result.stdout or "") + (result.stderr or "")
            lines = [line.strip() for line in full_output.split("\n") if line.strip()]
            
            for line in lines:
                parts = line.split()
                if len(parts) >= 2 and parts[0].lower() == "xray":
                    version = parts[1].strip(",()[]{}")
                    if not version.startswith("v"):
                        version = "v" + version
                    return version
                
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
            logging.warning(f"Xray version command returned non-zero code {result.returncode}: {result.stderr}")
            return f"Error (code {result.returncode}): {result.stderr.strip() or result.stdout.strip()}"
    except Exception as e:
        logging.error(f"Failed to check Xray version: {e}")
        return f"Error: {str(e)}"
