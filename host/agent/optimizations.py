import os
import sys
import logging
import subprocess
from pathlib import Path

def get_bbr_status() -> bool:
    """Checks if BBR congestion control is active in the kernel."""
    try:
        cc_path = "/proc/sys/net/ipv4/tcp_congestion_control"
        if os.path.exists(cc_path):
            with open(cc_path, "r") as f:
                content = f.read().strip()
                return content == "bbr"
    except Exception as e:
        logging.error(f"Failed to read BBR status: {e}")
    return False

def enable_bbr() -> tuple[bool, str]:
    """Enables BBR on the Linux host by writing to sysctl.conf and reloading."""
    if sys.platform != "linux":
        return False, "BBR is only supported on Linux host."

    cc_path = "/proc/sys/net/ipv4/tcp_congestion_control"
    qdisc_path = "/proc/sys/net/core/default_qdisc"

    if not os.path.exists(cc_path) or not os.path.exists(qdisc_path):
        return False, (
            "BBR cannot be configured inside a container (LXC/OpenVZ) or the kernel module tcp_bbr is not loaded. "
            "Please run 'sudo modprobe tcp_bbr' on the host machine, and if this is an LXC container, "
            "enable BBR on the physical Proxmox/parent host."
        )

    try:
        sysctl_path = "/etc/sysctl.conf"
        lines = []
        if os.path.exists(sysctl_path):
            with open(sysctl_path, "r") as f:
                lines = f.readlines()

        has_qdisc = False
        has_bbr = False
        for line in lines:
            if "net.core.default_qdisc" in line and not line.strip().startswith("#"):
                has_qdisc = True
            if "net.ipv4.tcp_congestion_control" in line and not line.strip().startswith("#"):
                has_bbr = True

        modified = False
        with open(sysctl_path, "a") as f:
            if not has_qdisc:
                f.write("\n# Enabled by VPN Panel Host Agent\nnet.core.default_qdisc=fq\n")
                modified = True
            if not has_bbr:
                f.write("net.ipv4.tcp_congestion_control=bbr\n")
                modified = True

        try:
            subprocess.run(["sysctl", "-p"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except subprocess.CalledProcessError as e:
            if get_bbr_status():
                return True, "BBR enabled successfully (sysctl reload reported warnings but BBR is active)."
            return False, f"Failed to reload sysctl config: {e}. If this is a container, BBR must be enabled on the parent host."
        
        if get_bbr_status():
            return True, "BBR enabled successfully."
        else:
            return False, "BBR settings written, but BBR is not active (kernel reload failed)."

    except Exception as e:
        return False, f"Error configuring sysctl.conf: {e}"

def get_optimization_status() -> bool:
    """Checks if the networking optimizations are active."""
    try:
        fastopen_path = "/proc/sys/net/ipv4/tcp_fastopen"
        if os.path.exists(fastopen_path):
            with open(fastopen_path, "r") as f:
                val = f.read().strip()
                return val == "3"
    except Exception:
        pass
    return False

def apply_network_optimizations() -> tuple[bool, str]:
    """Applies kernel networking sysctl presets and nofile limits for high loads."""
    if sys.platform != "linux":
        return False, "Network optimization is only supported on Linux hosts."
        
    try:
        sysctl_conf_dir = Path("/etc/sysctl.d")
        sysctl_conf_dir.mkdir(parents=True, exist_ok=True)
        conf_file = sysctl_conf_dir / "99-vpn-panel.conf"
        
        presets = """# Tuning for high throughput VPN panel
fs.file-max = 65535000
net.core.somaxconn = 32768
net.ipv4.tcp_max_syn_backlog = 16384
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.core.netdev_max_backlog = 16384
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_keepalive_time = 1200
net.ipv4.tcp_keepalive_intvl = 15
net.ipv4.tcp_keepalive_probes = 5
net.ipv4.tcp_fastopen = 3
"""
        with open(conf_file, "w") as f:
            f.write(presets)
            
        try:
            subprocess.run(["sysctl", "--system"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except subprocess.CalledProcessError as e:
            # sysctl --system can exit with 1 if there are unsupported/invalid keys in other/existing config files.
            # We check if our FastOpen setting is active, which indicates that our sysctl presets were applied.
            if get_optimization_status():
                logging.warning(f"sysctl --system returned non-zero code ({e}), but our vpn-panel settings are active.")
            else:
                logging.warning(f"sysctl --system failed: {e}. If this is a container, optimizations should be applied on the host.")
        
        limits_conf_dir = Path("/etc/security/limits.d")
        limits_conf_dir.mkdir(parents=True, exist_ok=True)
        limits_file = limits_conf_dir / "99-vpn-panel.conf"
        
        limits_content = """# Open file limits for high load
root soft nofile 1000000
root hard nofile 1000000
* soft nofile 1000000
* hard nofile 1000000
"""
        with open(limits_file, "w") as f:
            f.write(limits_content)
            
        return True, "Network optimized (sysctl parameters and security limits written)."
    except Exception as e:
        return False, f"Optimization failed: {str(e)}"
