import { apiFetch } from "../api.js";
import { showToast, formatBytes } from "../ui.js";
import { t } from "../i18n.js";

export async function loadInbounds() {
    const res = await apiFetch("/panel/api/inbounds/list");
    if (!res || !res.success) return;
    
    const container = document.getElementById("inbounds-list");
    if (!container) return;
    container.innerHTML = "";
    
    res.obj.forEach(ib => {
        const card = document.createElement("div");
        card.className = "glass-card inbound-card";
        
        const settings = JSON.parse(ib.settings);
        const clientsCount = settings.clients ? settings.clients.length : 0;
        
        card.innerHTML = `
            <div class="inbound-header">
                <div class="inbound-title-wrap">
                    <h4>${ib.remark}</h4>
                    <span class="inbound-proto-badge">${ib.protocol}</span>
                </div>
                <label class="switch-toggle">
                    <input type="checkbox" ${ib.enable ? 'checked' : ''} onchange="toggleInbound(${ib.id}, this.checked)">
                    <span class="switch-slider"></span>
                </label>
            </div>
            
            <div class="inbound-details">
                <div class="inbound-detail-row">
                    <span>${t("inbound_port", "Порт")}:</span>
                    <span class="val">${ib.port}</span>
                </div>
                <div class="inbound-detail-row">
                    <span>${t("inbound_users", "Пользователи")}:</span>
                    <span class="val">${clientsCount}</span>
                </div>
                <div class="inbound-detail-row">
                    <span>${t("inbound_traffic", "Расход трафика")}:</span>
                    <span class="val">⬆️ ${formatBytes(ib.up)} | ⬇️ ${formatBytes(ib.down)}</span>
                </div>
            </div>
            
            <div class="inbound-footer">
                <button class="btn secondary-btn" onclick="openClientsModal(${ib.id})"><i class="fa-solid fa-users"></i> ${t("inbound_btn_clients", "Клиенты")}</button>
                <button class="table-action-btn edit-btn" onclick="openEditInboundModal(${ib.id})" title="${t("inbound_btn_edit", "Редактировать")}"><i class="fa-regular fa-pen-to-square"></i></button>
                <button class="table-action-btn delete-btn" onclick="deleteInbound(${ib.id})" title="${t("inbound_btn_delete", "Удалить")}"><i class="fa-regular fa-trash-can"></i></button>
            </div>
        `;
        
        container.appendChild(card);
    });
}

export async function toggleInbound(id, state) {
    const listRes = await apiFetch("/panel/api/inbounds/list");
    if (!listRes || !listRes.success) return;
    const target = listRes.obj.find(x => x.id === id);
    if (!target) return;
    
    const res = await apiFetch(`/panel/api/inbounds/update/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            remark: target.remark,
            port: target.port,
            protocol: target.protocol,
            settings: JSON.parse(target.settings),
            streamSettings: JSON.parse(target.streamSettings),
            sniffing: JSON.parse(target.sniffing),
            enable: state ? 1 : 0
        })
    });
    
    if (res && res.success) {
        showToast(state ? t("inbound_enabled", "Подключение включено") : t("inbound_disabled", "Подключение выключено"));
        loadInbounds();
    }
}

export async function deleteInbound(id) {
    if (!confirm(t("confirm_delete_inbound", "Вы уверены, что хотите удалить это подключение? Все связанные клиенты будут также удалены."))) return;
    
    const res = await apiFetch(`/api/inbounds/delete/${id}`, { method: "POST" });
    if (res && res.success) {
        showToast(t("inbound_deleted", "Подключение успешно удалено"));
        loadInbounds();
    }
}
