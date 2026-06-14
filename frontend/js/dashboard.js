import { apiFetch } from "./api.js";
import { showToast, formatBytes } from "./ui.js";
import { t } from "./i18n.js";

let cpuCircularChart = null;
let ramCircularChart = null;

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
    const cpuCanvas = document.getElementById("cpuCircularChart");
    const ramCanvas = document.getElementById("ramCircularChart");
    if (!cpuCanvas || !ramCanvas) return;
    
    if (!cpuCircularChart && window.Chart) {
        const ctx = cpuCanvas.getContext("2d");
        cpuCircularChart = new window.Chart(ctx, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [cpu, 100 - cpu],
                    backgroundColor: [
                        '#06b6d4', // Неоновый голубой
                        'rgba(255, 255, 255, 0.04)'
                    ],
                    borderWidth: 0,
                    cutout: '82%'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
    }
    
    if (!ramCircularChart && window.Chart) {
        const ctx = ramCanvas.getContext("2d");
        ramCircularChart = new window.Chart(ctx, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [ram, 100 - ram],
                    backgroundColor: [
                        '#8b5cf6', // Неоновый фиолетовый
                        'rgba(255, 255, 255, 0.04)'
                    ],
                    borderWidth: 0,
                    cutout: '82%'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
    }
    
    if (cpuCircularChart) {
        cpuCircularChart.data.datasets[0].data = [cpu, 100 - cpu];
        cpuCircularChart.update();
    }
    if (ramCircularChart) {
        ramCircularChart.data.datasets[0].data = [ram, 100 - ram];
        ramCircularChart.update();
    }
    
    const cpuText = document.getElementById("cpu-chart-text");
    if (cpuText) cpuText.innerText = `${cpu.toFixed(1)}%`;
    
    const ramText = document.getElementById("ram-chart-text");
    if (ramText) ramText.innerText = `${ram.toFixed(1)}%`;
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
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: `${t("traffic_upload", "Загрузка")} (GB)`,
                        data: uploadData,
                        borderColor: '#10b981',
                        backgroundColor: (context) => {
                            const chart = context.chart;
                            const {ctx, chartArea} = chart;
                            if (!chartArea) return 'rgba(16, 185, 129, 0.2)';
                            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                            gradient.addColorStop(0, 'rgba(16, 185, 129, 0.3)');
                            gradient.addColorStop(1, 'rgba(16, 185, 129, 0.02)');
                            return gradient;
                        },
                        borderWidth: 1.5,
                        borderRadius: 4,
                        barPercentage: 0.75,
                        categoryPercentage: 0.75
                    },
                    {
                        label: `${t("traffic_download", "Скачивание")} (GB)`,
                        data: downloadData,
                        borderColor: '#f43f5e',
                        backgroundColor: (context) => {
                            const chart = context.chart;
                            const {ctx, chartArea} = chart;
                            if (!chartArea) return 'rgba(244, 63, 94, 0.2)';
                            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                            gradient.addColorStop(0, 'rgba(244, 63, 94, 0.3)');
                            gradient.addColorStop(1, 'rgba(244, 63, 94, 0.02)');
                            return gradient;
                        },
                        borderWidth: 1.5,
                        borderRadius: 4,
                        barPercentage: 0.75,
                        categoryPercentage: 0.75
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: {
                            color: 'rgba(255, 255, 255, 0.7)',
                            font: { family: 'Outfit', size: 12, weight: 600 }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        borderColor: 'rgba(255, 255, 255, 0.08)',
                        borderWidth: 1,
                        titleFont: { family: 'Outfit', size: 12, weight: 600 },
                        bodyFont: { family: 'Outfit', size: 12 },
                        padding: 12,
                        cornerRadius: 8,
                        displayColors: true
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.5)',
                            font: { family: 'Outfit', size: 10 }
                        }
                    },
                    y: {
                        min: 0,
                        suggestedMax: 1,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.03)'
                        },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.5)',
                            font: { family: 'Outfit', size: 10 }
                        }
                    }
                }
            }
        });
    }
}
