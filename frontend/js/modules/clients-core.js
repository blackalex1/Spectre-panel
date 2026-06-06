import { apiFetch } from "../api.js";
import { showToast, formatBytes } from "../ui.js";
import { t } from "../i18n.js";
import { showClientTrafficChart } from "./clients-chart.js";
import { openEditClientModal } from "./clients-form.js";

export let activeInboundId = null;
export let activeInboundProtocol = "";
export let editModeClientEmail = null;
export let loadInboundsCallbackGlobal = null;

export function setEditModeEmail(email) {
    editModeClientEmail = email;
}

export function setLoadInboundsCallback(cb) {
    loadInboundsCallbackGlobal = cb;
}

export function setActiveInboundProtocol(proto) {
    activeInboundProtocol = proto;
}

export function setActiveInboundId(id) {
    activeInboundId = id;
}

export async function openClientsModal(inboundId) {
    activeInboundId = inboundId;
    editModeClientEmail = null; // Reset edit mode on modal open
    
    const chartContainer = document.getElementById("client-traffic-chart-container");
    if (chartContainer) chartContainer.style.display = "none";
    
    const inboundsRes = await apiFetch("/panel/api/inbounds/list");
    if (!inboundsRes || !inboundsRes.success) return;
    
    const ib = inboundsRes.obj.find(x => x.id === inboundId);
    if (!ib) return;
    
    activeInboundProtocol = ib.protocol;
    document.getElementById("clients-modal-ib-remark").innerText = ib.remark;
    
    const tableBody = document.getElementById("clients-table-body");
    if (tableBody) {
        tableBody.innerHTML = "";
        
        // Query online clients
        const onlinesRes = await apiFetch("/panel/api/clients/onlines", { method: "POST" });
        const onlines = onlinesRes ? onlinesRes.obj : [];
        
        // Parse settings and clients stats
        const settings = JSON.parse(ib.settings);
        const clients = settings.clients || [];
        
        clients.forEach(c => {
            const stats = ib.clientStats.find(s => s.email === c.email) || { up: 0, down: 0, total: 0, enable: true, limitIp: 0, blockReason: "" };
            
            const isOnline = onlines.includes(c.email);
            
            let statusHtml = "";
            if (isOnline) {
                statusHtml = `<span class="badge" style="background: rgba(46, 213, 115, 0.15); color: #2ed573; box-shadow: 0 0 8px rgba(46, 213, 115, 0.2);"><span style="display: inline-block; width: 6px; height: 6px; background: #2ed573; border-radius: 50%; margin-right: 6px; vertical-align: middle;"></span>${t("client_status_online", "Онлайн")}</span>`;
            } else if (c.enable) {
                statusHtml = `<span class="badge" style="background: rgba(255, 255, 255, 0.05); color: var(--text-secondary);"><span style="display: inline-block; width: 6px; height: 6px; background: var(--text-muted); border-radius: 50%; margin-right: 6px; vertical-align: middle; opacity: 0.5;"></span>${t("client_status_offline", "Офлайн")}</span>`;
            } else {
                const reasonStr = stats.blockReason || c.blockReason || t("client_status_blocked", "Заблокирован");
                statusHtml = `<span class="badge inactive" title="Причина: ${reasonStr}" style="cursor: help;">${t("client_status_blocked", "Бан ⚠️")}</span>`;
            }
            
            let statusCol = `
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <label class="switch-toggle mini-switch" style="transform: scale(0.8); transform-origin: left center; width: 46px; height: 24px; margin-bottom: 0;">
                            <input type="checkbox" id="toggle-client-${inboundId}-${c.email.replace(/@/g, '_')}" ${c.enable ? 'checked' : ''}>
                            <span class="switch-slider"></span>
                        </label>
                        ${statusHtml}
                    </div>
            `;
            const blockReason = stats.blockReason || c.blockReason;
            if (!c.enable && blockReason) {
                statusCol += `<span style="font-size: 11px; color: var(--accent-rose); opacity: 0.9; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${blockReason}">${blockReason}</span>`;
            }
            statusCol += `</div>`;
                
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
                
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${c.email}</strong></td>
                <td>${statusCol}</td>
                <td>⬆️ ${formatBytes(stats.up)} | ⬇️ ${formatBytes(stats.down)}</td>
                <td>${limitText}</td>
                <td>${expiryDate}</td>
                <td>
                    <div class="actions-group">
                        <button class="table-action-btn chart-btn" id="btn-chart-${inboundId}-${c.email.replace(/@/g, '_')}" title="${t("clients_traffic_chart_btn", "График")}"><i class="fa-solid fa-chart-line"></i></button>
                        <button class="table-action-btn links-btn" id="btn-links-${inboundId}-${c.email.replace(/@/g, '_')}" title="${t("links_modal_title", "Ссылки подключения")}"><i class="fa-solid fa-qrcode"></i></button>
                        <button class="table-action-btn edit-btn" id="btn-edit-${inboundId}-${c.email.replace(/@/g, '_')}" title="${t("inbound_btn_edit", "Редактировать")}"><i class="fa-regular fa-pen-to-square"></i></button>
                        <button class="table-action-btn delete-btn" id="btn-del-${inboundId}-${c.email.replace(/@/g, '_')}" title="${t("inbound_btn_delete", "Удалить")}"><i class="fa-regular fa-trash-can"></i></button>
                    </div>
                </td>
            `;
            tableBody.appendChild(tr);
            
            // Register event listeners
            document.getElementById(`btn-chart-${inboundId}-${c.email.replace(/@/g, '_')}`).addEventListener("click", () => showClientTrafficChart(c.email));
            document.getElementById(`btn-links-${inboundId}-${c.email.replace(/@/g, '_')}`).addEventListener("click", () => openLinksModal(inboundId, c.email));
            document.getElementById(`btn-edit-${inboundId}-${c.email.replace(/@/g, '_')}`).addEventListener("click", () => openEditClientModal(inboundId, c));
            document.getElementById(`btn-del-${inboundId}-${c.email.replace(/@/g, '_')}`).addEventListener("click", () => deleteClient(inboundId, c.id || c.password || c.client_uuid_or_pwd, loadInboundsCallbackGlobal));
            
            document.getElementById(`toggle-client-${inboundId}-${c.email.replace(/@/g, '_')}`).addEventListener("change", (e) => {
                toggleClientActiveStatus(inboundId, c, e.target.checked);
            });
        });
    }
    
    document.getElementById("clients-modal").classList.add("active");
}

export async function toggleClientActiveStatus(inboundId, clientData, enabled) {
    const email = clientData.email;
    
    const settingsPayload = {
        clients: [{
            id: clientData.id || clientData.password || clientData.client_uuid_or_pwd,
            email: email,
            enable: enabled,
            limitIp: clientData.limitIp || 0,
            totalGB: clientData.totalGB || 0,
            expiryTime: clientData.expiryTime || 0,
            flow: clientData.flow || "",
            alterId: clientData.alterId || 0,
            security: clientData.security || "auto"
        }]
    };
    
    const res = await apiFetch(`/panel/api/inbounds/updateClient/${email}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            id: inboundId,
            settings: JSON.stringify(settingsPayload)
        })
    });
    
    if (res && res.success) {
        showToast(enabled ? t("client_unblocked_toast", "Клиент успешно разблокирован!") : t("client_blocked_toast", "Клиент успешно заблокирован!"));
        openClientsModal(inboundId);
        if (loadInboundsCallbackGlobal) loadInboundsCallbackGlobal();
    } else {
        showToast(res ? res.msg : t("client_status_error_toast", "Не удалось изменить статус клиента"), "error");
        openClientsModal(inboundId); // Reload to reset switch
    }
}

export async function deleteClient(inboundId, clientId, loadInboundsCallback) {
    if (!confirm(t("confirm_delete_client", "Вы уверены, что хотите удалить этого клиента?"))) return;
    
    const res = await apiFetch(`/panel/api/inbounds/${inboundId}/delClient/${clientId}`, { method: "POST" });
    if (res && res.success) {
        showToast(t("client_deleted_toast", "Клиент успешно удален"));
        openClientsModal(inboundId);
        if (loadInboundsCallback) loadInboundsCallback();
    }
}

export async function openLinksModal(inboundId, email) {
    const res = await apiFetch(`/panel/api/inbounds/getClientLinks/${inboundId}/${email}`);
    if (!res || !res.success || !res.obj.length) {
        showToast(t("links_generation_error_toast", "Ошибка генерации ссылок"), "error");
        return;
    }
    
    const link = res.obj[0];
    document.getElementById("import-link-input").value = link;
    
    // Render QR-code
    const qrContainer = document.getElementById("qrcode-container");
    if (qrContainer && window.QRCode) {
        qrContainer.innerHTML = "";
        
        new window.QRCode(qrContainer, {
            text: link,
            width: 200,
            height: 200,
            colorDark : "#020617",
            colorLight : "#ffffff",
            correctLevel : window.QRCode.CorrectLevel.H
        });
    }
    
    document.getElementById("links-modal").classList.add("active");
}
