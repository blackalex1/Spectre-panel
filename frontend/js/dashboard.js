import { apiFetch } from "./api.js";
import { showToast, formatBytes } from "./ui.js";
import { t } from "./i18n.js";
import { openLinksModal, openEditClientModal, deleteClient } from "./clients.js";

let cpuCircularChart = null;
let ramCircularChart = null;
let swapCircularChart = null;
let diskCircularChart = null;

let dashboardClients = [];
let isDashboardSearchInitialized = false;
let lastOnlines = [];

let lastNetUp = null;
let lastNetDown = null;
let lastStatsTime = null;

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
    
    const swapVal = document.getElementById("swap-value");
    let swapPercent = 0;
    if (swapVal && obj.swap) {
        const swapCurrent = obj.swap.current / (1024**3);
        const swapTotal = obj.swap.total / (1024**3);
        swapVal.innerText = `${swapCurrent.toFixed(1)} / ${swapTotal.toFixed(1)} GB`;
        swapPercent = obj.swap.percent || 0;
    }
    
    const netUpVal = document.getElementById("net-up-value");
    if (netUpVal) netUpVal.innerText = formatBytes(obj.netIO.up);
    
    const netDownVal = document.getElementById("net-down-value");
    if (netDownVal) netDownVal.innerText = formatBytes(obj.netIO.down);
    
    const now = Date.now();
    if (lastNetUp !== null && lastNetDown !== null && lastStatsTime !== null) {
        const elapsedSeconds = (now - lastStatsTime) / 1000;
        if (elapsedSeconds > 0) {
            const diffUp = obj.netIO.up - lastNetUp;
            const diffDown = obj.netIO.down - lastNetDown;
            const speedUp = diffUp >= 0 ? diffUp / elapsedSeconds : 0;
            const speedDown = diffDown >= 0 ? diffDown / elapsedSeconds : 0;
            
            const netSpeedUpVal = document.getElementById("net-speed-up-value");
            if (netSpeedUpVal) netSpeedUpVal.innerText = `${formatBytes(speedUp)}/s`;
            
            const netSpeedDownVal = document.getElementById("net-speed-down-value");
            if (netSpeedDownVal) netSpeedDownVal.innerText = `${formatBytes(speedDown)}/s`;
        }
    }
    lastNetUp = obj.netIO.up;
    lastNetDown = obj.netIO.down;
    lastStatsTime = now;
    
    const diskVal = document.getElementById("disk-value");
    if (diskVal && obj.disk) {
        const diskCurrent = obj.disk.current / (1024**3);
        const diskTotal = obj.disk.total / (1024**3);
        diskVal.innerText = `${diskCurrent.toFixed(1)} / ${diskTotal.toFixed(1)} GB`;
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
    updateChart(obj.cpu, (memCurrent / memTotal) * 100, swapPercent, obj.disk ? obj.disk.percent : 0);
    await loadGlobalTrafficChart();
    await loadDashboardClients();
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

function updateChart(cpu, ram, swap, disk) {
    const cpuCanvas = document.getElementById("cpuCircularChart");
    const ramCanvas = document.getElementById("ramCircularChart");
    const swapCanvas = document.getElementById("swapCircularChart");
    const diskCanvas = document.getElementById("diskCircularChart");
    if (!cpuCanvas || !ramCanvas || !swapCanvas || !diskCanvas) return;
    
    if (!cpuCircularChart && window.Chart) {
        const ctx = cpuCanvas.getContext("2d");
        cpuCircularChart = new window.Chart(ctx, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [cpu, 100 - cpu],
                    backgroundColor: [
                        '#8b5cf6', // Неоновый фиолетовый (Theme Accent)
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
    
    if (!swapCircularChart && window.Chart) {
        const ctx = swapCanvas.getContext("2d");
        swapCircularChart = new window.Chart(ctx, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [swap, 100 - swap],
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
    
    if (!diskCircularChart && window.Chart) {
        const ctx = diskCanvas.getContext("2d");
        diskCircularChart = new window.Chart(ctx, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [disk, 100 - disk],
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
    
    const NORMAL_COLOR = '#8b5cf6'; // Единый неоновый фиолетовый
    const WARNING_COLOR = '#f43f5e'; // Предупреждающий неоновый красный (>90%)
    
    if (cpuCircularChart) {
        cpuCircularChart.data.datasets[0].data = [cpu, 100 - cpu];
        cpuCircularChart.data.datasets[0].backgroundColor[0] = (cpu >= 90) ? WARNING_COLOR : NORMAL_COLOR;
        cpuCircularChart.update();
    }
    if (ramCircularChart) {
        ramCircularChart.data.datasets[0].data = [ram, 100 - ram];
        ramCircularChart.data.datasets[0].backgroundColor[0] = (ram >= 90) ? WARNING_COLOR : NORMAL_COLOR;
        ramCircularChart.update();
    }
    if (swapCircularChart) {
        swapCircularChart.data.datasets[0].data = [swap, 100 - swap];
        swapCircularChart.data.datasets[0].backgroundColor[0] = (swap >= 90) ? WARNING_COLOR : NORMAL_COLOR;
        swapCircularChart.update();
    }
    if (diskCircularChart) {
        diskCircularChart.data.datasets[0].data = [disk, 100 - disk];
        diskCircularChart.data.datasets[0].backgroundColor[0] = (disk >= 90) ? WARNING_COLOR : NORMAL_COLOR;
        diskCircularChart.update();
    }
    
    const cpuText = document.getElementById("cpu-chart-text");
    if (cpuText) {
        cpuText.innerText = `${cpu.toFixed(1)}%`;
        cpuText.style.color = (cpu >= 90) ? WARNING_COLOR : 'var(--text-primary)';
    }
    
    const ramText = document.getElementById("ram-chart-text");
    if (ramText) {
        ramText.innerText = `${ram.toFixed(1)}%`;
        ramText.style.color = (ram >= 90) ? WARNING_COLOR : 'var(--text-primary)';
    }
    
    const swapText = document.getElementById("swap-chart-text");
    if (swapText) {
        swapText.innerText = `${swap.toFixed(1)}%`;
        swapText.style.color = (swap >= 90) ? WARNING_COLOR : 'var(--text-primary)';
    }
    
    const diskText = document.getElementById("disk-chart-text");
    if (diskText) {
        diskText.innerText = `${disk.toFixed(1)}%`;
        diskText.style.color = (disk >= 90) ? WARNING_COLOR : 'var(--text-primary)';
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
                            font: { family: "'Outfit', 'Inter', 'Segoe UI', sans-serif", size: 12, weight: 600 }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        borderColor: 'rgba(255, 255, 255, 0.08)',
                        borderWidth: 1,
                        titleFont: { family: "'Outfit', 'Inter', 'Segoe UI', sans-serif", size: 12, weight: 600 },
                        bodyFont: { family: "'Outfit', 'Inter', 'Segoe UI', sans-serif", size: 12 },
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
                            font: { family: "'Outfit', 'Inter', 'Segoe UI', sans-serif", size: 10 }
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
                            font: { family: "'Outfit', 'Inter', 'Segoe UI', sans-serif", size: 10 }
                        }
                    }
                }
            }
        });
    }
}

export async function loadDashboardClients() {
    try {
        const inboundsRes = await apiFetch("/panel/api/inbounds/list");
        const onlinesRes = await apiFetch("/panel/api/clients/onlines", { method: "POST" });
        if (!inboundsRes || !inboundsRes.success || !onlinesRes || !onlinesRes.success) return;

        lastOnlines = onlinesRes.obj || [];
        const tempClients = [];

        inboundsRes.obj.forEach(ib => {
            let settings = {};
            try {
                settings = JSON.parse(ib.settings);
            } catch (e) {
                console.error("Error parsing settings for inbound", ib.id, e);
            }
            const clients = settings.clients || [];
            clients.forEach(c => {
                const stats = ib.clientStats.find(s => s.email === c.email) || { up: 0, down: 0 };
                tempClients.push({
                    email: c.email,
                    enable: c.enable,
                    limitIp: c.limitIp,
                    totalGB: c.totalGB,
                    expiryTime: c.expiryTime,
                    up: stats.up,
                    down: stats.down,
                    inboundId: ib.id,
                    inboundRemark: ib.remark,
                    inboundProtocol: ib.protocol,
                    rawClient: c
                });
            });
        });

        // Stable sort alphabetically by email
        tempClients.sort((a, b) => a.email.localeCompare(b.email));
        dashboardClients = tempClients;

        filterAndRenderClients();
        setupDashboardClientsListeners();
    } catch (err) {
        console.error("Error loading dashboard clients:", err);
    }
}

function filterAndRenderClients() {
    const tableBody = document.getElementById("dashboard-clients-table-body");
    if (!tableBody) return;

    const searchInput = document.getElementById("dashboard-clients-search");
    const onlineFilter = document.getElementById("dashboard-filter-online");
    const blockedFilter = document.getElementById("dashboard-filter-blocked");

    const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : "";
    const showOnlyOnline = onlineFilter ? onlineFilter.checked : false;
    const showOnlyBlocked = blockedFilter ? blockedFilter.checked : false;

    // Filter
    const filtered = dashboardClients.filter(c => {
        const isOnline = lastOnlines.includes(c.email);
        const matchesSearch = c.email.toLowerCase().includes(searchQuery) || 
                              c.inboundRemark.toLowerCase().includes(searchQuery) ||
                              c.inboundProtocol.toLowerCase().includes(searchQuery);

        if (!matchesSearch) return false;
        if (showOnlyOnline && !isOnline) return false;
        if (showOnlyBlocked && c.enable) return false;

        return true;
    });

    // Render
    tableBody.innerHTML = "";
    if (filtered.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">
                    ${t("no_matching_clients", "Клиенты не найдены")}
                </td>
            </tr>
        `;
        return;
    }

    filtered.forEach(c => {
        const isOnline = lastOnlines.includes(c.email);
        
        let statusHtml = "";
        if (isOnline) {
            statusHtml = `<span class="badge" style="background: rgba(46, 213, 115, 0.15); color: #2ed573; box-shadow: 0 0 8px rgba(46, 213, 115, 0.2);"><span style="display: inline-block; width: 6px; height: 6px; background: #2ed573; border-radius: 50%; margin-right: 6px; vertical-align: middle;"></span>${t("client_status_online", "Онлайн")}</span>`;
        } else if (c.enable) {
            statusHtml = `<span class="badge" style="background: rgba(255, 255, 255, 0.05); color: var(--text-secondary);"><span style="display: inline-block; width: 6px; height: 6px; background: var(--text-muted); border-radius: 50%; margin-right: 6px; vertical-align: middle; opacity: 0.5;"></span>${t("client_status_offline", "Офлайн")}</span>`;
        } else {
            statusHtml = `<span class="badge inactive" style="cursor: help;">${t("client_status_blocked", "Бан ⚠️")}</span>`;
        }

        const trafficLimit = c.totalGB > 0 ? `${c.totalGB} GB` : t("client_status_unlimited", "Безлимит");
        const ipLimit = c.limitIp > 0 ? `IP: ${c.limitIp}` : "IP: ♾️";
        const limitText = `
            <div style="display: flex; flex-direction: column; font-size: 13px; gap: 2px;">
                <span>📊 ${trafficLimit}</span>
                <span style="color: var(--text-secondary);">🖥️ ${ipLimit}</span>
            </div>
        `;

        const expiryDate = c.expiryTime > 0 
            ? new Date(c.expiryTime * 1000).toLocaleDateString() 
            : t("client_status_never_expires", "Бессрочно");

        const emailSafe = c.email.replace(/@/g, '_').replace(/\./g, '_');

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td class="client-email-cell" title="${c.email}"><strong>${c.email}</strong></td>
            <td>${statusHtml}</td>
            <td>
                <a href="#" class="inbound-link" id="db-link-inbound-${c.inboundId}-${emailSafe}">
                    ${c.inboundProtocol.toUpperCase()} (${c.inboundRemark})
                </a>
            </td>
            <td>⬆️ ${formatBytes(c.up)} | ⬇️ ${formatBytes(c.down)}</td>
            <td>${limitText}</td>
            <td>${expiryDate}</td>
            <td>
                <div class="actions-group">
                    <button class="table-action-btn links-btn" id="db-btn-links-${c.inboundId}-${emailSafe}" title="${t("links_modal_title", "Ссылки подключения")}"><i class="fa-solid fa-qrcode"></i></button>
                    <button class="table-action-btn edit-btn" id="db-btn-edit-${c.inboundId}-${emailSafe}" title="${t("inbound_btn_edit", "Редактировать")}"><i class="fa-regular fa-pen-to-square"></i></button>
                    <button class="table-action-btn delete-btn" id="db-btn-del-${c.inboundId}-${emailSafe}" title="${t("inbound_btn_delete", "Удалить")}"><i class="fa-regular fa-trash-can"></i></button>
                </div>
            </td>
        `;

        tableBody.appendChild(tr);

        // Add event listeners to the inline elements
        const inboundLink = document.getElementById(`db-link-inbound-${c.inboundId}-${emailSafe}`);
        if (inboundLink) {
            inboundLink.addEventListener("click", (e) => {
                e.preventDefault();
                if (window.openClientsModal) {
                    window.openClientsModal(c.inboundId);
                }
            });
        }

        const linksBtn = document.getElementById(`db-btn-links-${c.inboundId}-${emailSafe}`);
        if (linksBtn) {
            linksBtn.addEventListener("click", () => openLinksModal(c.inboundId, c.email));
        }

        const editBtn = document.getElementById(`db-btn-edit-${c.inboundId}-${emailSafe}`);
        if (editBtn) {
            editBtn.addEventListener("click", () => openEditClientModal(c.inboundId, c.rawClient));
        }

        const delBtn = document.getElementById(`db-btn-del-${c.inboundId}-${emailSafe}`);
        if (delBtn) {
            delBtn.addEventListener("click", () => deleteClient(
                c.inboundId, 
                c.rawClient.id || c.rawClient.password || c.rawClient.client_uuid_or_pwd, 
                async () => {
                    await loadDashboardClients();
                }
            ));
        }
    });
}

function setupDashboardClientsListeners() {
    if (isDashboardSearchInitialized) return;
    
    const searchInput = document.getElementById("dashboard-clients-search");
    const onlineFilter = document.getElementById("dashboard-filter-online");
    const blockedFilter = document.getElementById("dashboard-filter-blocked");
    const refreshBtn = document.getElementById("dashboard-clients-refresh");

    if (searchInput) {
        searchInput.addEventListener("input", () => filterAndRenderClients());
    }
    if (onlineFilter) {
        onlineFilter.addEventListener("change", () => filterAndRenderClients());
    }
    if (blockedFilter) {
        blockedFilter.addEventListener("change", () => filterAndRenderClients());
    }
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const spinIcon = refreshBtn.querySelector("i");
            if (spinIcon) spinIcon.classList.add("fa-spin");
            await loadDashboardClients();
            if (spinIcon) spinIcon.classList.remove("fa-spin");
        });
    }

    isDashboardSearchInitialized = true;
}
