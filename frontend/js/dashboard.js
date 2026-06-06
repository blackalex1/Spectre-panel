import { apiFetch } from "./api.js";
import { showToast, formatBytes } from "./ui.js";
import { t } from "./i18n.js";

let sysChart = null;
const chartData = { cpu: [], ram: [], labels: [] };

export async function loadStats() {
    const res = await apiFetch("/panel/api/server/status");
    if (!res || !res.success) return;
    
    const obj = res.obj;
    
    // Render Xray status badge
    const badge = document.getElementById("xray-status-badge");
    const statusText = badge ? badge.querySelector(".status-text") : null;
    if (badge && statusText) {
        if (obj.xray.state === "running") {
            badge.className = "status-badge running";
            statusText.innerText = t("xray_status_active", "Xray: Активен");
            const stateEl = document.getElementById("sys-xray-state");
            if (stateEl) stateEl.innerText = t("xray_state_running", "Запущен");
        } else {
            badge.className = "status-badge stopped";
            statusText.innerText = t("xray_status_stopped", "Xray: Остановлен");
            const stateEl = document.getElementById("sys-xray-state");
            if (stateEl) stateEl.innerText = t("xray_state_stopped", "Остановлен");
        }
    }
    
    // Render Hysteria status badge
    const hBadge = document.getElementById("hysteria-status-badge");
    const hStatusText = hBadge ? hBadge.querySelector(".status-text") : null;
    if (hBadge && hStatusText) {
        if (obj.hysteria.state === "running") {
            hBadge.className = "status-badge running";
            hStatusText.innerText = t("hysteria_status_active", "Hysteria: Активен");
            const stateEl = document.getElementById("sys-hysteria-state");
            if (stateEl) stateEl.innerText = t("hysteria_state_running", "Запущен");
        } else {
            hBadge.className = "status-badge stopped";
            hStatusText.innerText = t("hysteria_status_stopped", "Hysteria: Остановлен");
            const stateEl = document.getElementById("sys-hysteria-state");
            if (stateEl) stateEl.innerText = t("hysteria_state_stopped", "Остановлен");
        }
    }
    
    // Metrics values
    const cpuVal = document.getElementById("cpu-value");
    if (cpuVal) cpuVal.innerText = `${obj.cpu.toFixed(1)}%`;
    
    const ramVal = document.getElementById("ram-value");
    const memCurrent = obj.mem.current / (1024**3);
    const memTotal = obj.mem.total / (1024**3);
    if (ramVal) ramVal.innerText = `${memCurrent.toFixed(1)} / ${memTotal.toFixed(1)} GB`;
    
    const netUpVal = document.getElementById("net-up-value");
    if (netUpVal) netUpVal.innerText = formatBytes(obj.netIO.up);
    
    const netDownVal = document.getElementById("net-down-value");
    if (netDownVal) netDownVal.innerText = formatBytes(obj.netIO.down);
    
    const diskVal = document.getElementById("disk-value");
    if (diskVal && obj.disk) {
        const diskCurrent = obj.disk.current / (1024**3);
        const diskTotal = obj.disk.total / (1024**3);
        diskVal.innerText = `${diskCurrent.toFixed(1)} / ${diskTotal.toFixed(1)} GB (${obj.disk.percent.toFixed(1)}%)`;
    }
    
    // Uptime and version
    const hours = Math.floor(obj.uptime / 3600);
    const minutes = Math.floor((obj.uptime % 3600) / 60);
    const uptimeEl = document.getElementById("sys-uptime");
    if (uptimeEl) uptimeEl.innerText = t("uptime_format", "{hours}ч {minutes}м").replace("{hours}", hours).replace("{minutes}", minutes);
    
    const xrayVerEl = document.getElementById("sys-xray-version");
    if (xrayVerEl) xrayVerEl.innerText = obj.xray.version;
    
    const hysteriaVerEl = document.getElementById("sys-hysteria-version");
    if (hysteriaVerEl) hysteriaVerEl.innerText = obj.hysteria.version;
    
    const sysIpEl = document.getElementById("sys-ip");
    if (sysIpEl) sysIpEl.innerText = window.location.hostname;
    
    // Update chart
    updateChart(obj.cpu, (memCurrent / memTotal) * 100);
    await loadGlobalTrafficChart();
}

export async function loadBbrStatus() {
    const bbrRes = await apiFetch("/api/system/bbr");
    const bbrEl = document.getElementById("sys-bbr");
    const enableBtn = document.getElementById("enable-bbr-btn");
    if (bbrRes && bbrRes.success && bbrEl && enableBtn) {
        if (bbrRes.bbr_enabled) {
            bbrEl.innerText = t("bbr_status_active", "Активно");
            bbrEl.style.color = "var(--accent-green)";
            enableBtn.style.display = "none";
        } else {
            bbrEl.innerText = t("bbr_status_disabled", "Отключено");
            bbrEl.style.color = "var(--accent-rose)";
            enableBtn.style.display = "inline-block";
        }
    } else if (bbrEl && enableBtn) {
        bbrEl.innerText = t("bbr_status_error", "Ошибка");
        bbrEl.style.color = "var(--accent-rose)";
        enableBtn.style.display = "none";
    }
}

function updateChart(cpu, ram) {
    const canvas = document.getElementById("sysChart");
    if (!canvas) return;
    
    if (!sysChart && window.Chart) {
        const ctx = canvas.getContext("2d");
        sysChart = new window.Chart(ctx, {
            type: 'line',
            data: {
                labels: chartData.labels,
                datasets: [
                    {
                        label: 'CPU (%)',
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37, 99, 235, 0.1)',
                        data: chartData.cpu,
                        borderWidth: 2,
                        tension: 0.3,
                        fill: true
                    },
                    {
                        label: 'RAM (%)',
                        borderColor: '#a855f7',
                        backgroundColor: 'rgba(168, 85, 247, 0.1)',
                        data: chartData.ram,
                        borderWidth: 2,
                        tension: 0.3,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' } },
                    x: { grid: { display: false } }
                },
                plugins: {
                    legend: { labels: { color: '#e2e8f0' } }
                }
            }
        });
    }
    
    const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    chartData.labels.push(timeLabel);
    chartData.cpu.push(cpu);
    chartData.ram.push(ram);
    
    if (chartData.labels.length > 15) {
        chartData.labels.shift();
        chartData.cpu.shift();
        chartData.ram.shift();
    }
    
    if (sysChart) {
        sysChart.update();
    }
}

let globalTrafficChartInstance = null;

export async function loadGlobalTrafficChart() {
    const canvas = document.getElementById("globalTrafficChart");
    if (!canvas) return;
    
    const res = await apiFetch("/panel/api/system/global-traffic");
    if (!res || !res.success) return;
    
    const records = res.obj || [];
    const labels = records.map(r => r.date);
    // Convert bytes to GB for the chart
    const uploadData = records.map(r => r.up / (1024 * 1024 * 1024));
    const downloadData = records.map(r => r.down / (1024 * 1024 * 1024));
    
    const ctx = canvas.getContext("2d");
    
    if (globalTrafficChartInstance) {
        globalTrafficChartInstance.destroy();
    }
    
    if (window.Chart) {
        globalTrafficChartInstance = new window.Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: `${t("traffic_upload", "Загрузка")} (GB)`,
                        data: uploadData,
                        borderColor: '#2ed573',
                        backgroundColor: 'rgba(46, 213, 115, 0.1)',
                        tension: 0.3,
                        fill: true
                    },
                    {
                        label: `${t("traffic_download", "Скачивание")} (GB)`,
                        data: downloadData,
                        borderColor: '#ff4757',
                        backgroundColor: 'rgba(255, 71, 87, 0.1)',
                        tension: 0.3,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: {
                            color: 'rgba(255, 255, 255, 0.7)'
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.6)'
                        }
                    },
                    y: {
                        min: 0,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.6)'
                        }
                    }
                }
            }
        });
    }
}
