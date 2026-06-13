import { apiFetch, getCsrfToken } from "../../api.js";
import { showToast } from "../../ui.js";
import { t } from "../../i18n.js";
import { populateOutboundDropdowns } from "../routing-outbounds.js";

export async function loadRoutingRules() {
    const res = await apiFetch("/api/routing/rules");
    if (!res || !res.success) return;
    
    const tbody = document.getElementById("routing-rules-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    
    const rules = res.obj;
    rules.forEach((rule, idx) => {
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid var(--border-color)";
        
        let conditions = [];
        if (rule.inbound_tags && rule.inbound_tags.length > 0) {
            conditions.push(`<span style="color:var(--accent-orange); font-size:12px; margin-right:4px;">Inbounds:</span>${rule.inbound_tags.join(", ")}`);
        }
        if (rule.users && rule.users.length > 0) {
            conditions.push(`<span style="color:#eccc68; font-size:12px; margin-right:4px;">Users:</span>${rule.users.join(", ")}`);
        }
        if (rule.domains && rule.domains.length > 0) {
            conditions.push(`<span style="color:var(--accent-blue); font-size:12px; margin-right:4px;">Domains:</span>${rule.domains.length} шт.`);
        }
        if (rule.ips && rule.ips.length > 0) {
            conditions.push(`<span style="color:var(--accent-purple); font-size:12px; margin-right:4px;">IPs:</span>${rule.ips.join(", ")}`);
        }
        if (rule.protocols && rule.protocols.length > 0) {
            conditions.push(`<span style="color:#2ed573; font-size:12px; margin-right:4px;">Protos:</span>${rule.protocols.join(", ")}`);
        }
        
        const conditionsHtml = conditions.length > 0 
            ? conditions.map(c => `<div style="margin-bottom: 4px; font-size: 13px;">${c}</div>`).join("") 
            : `<span style="color: var(--text-secondary); font-size:13px;">Any (Всегда)</span>`;
            
        let badgeClass = "tag-badge";
        const destLower = rule.outbound_tag.toLowerCase();
        if (destLower === "direct") {
            badgeClass += " tag-badge-direct";
        } else if (destLower === "blocked") {
            badgeClass += " tag-badge-blocked";
        } else if (destLower === "warp") {
            badgeClass += " tag-badge-warp";
        } else if (destLower === "api") {
            badgeClass += " tag-badge-api";
        } else {
            badgeClass += " tag-badge-proxy";
        }

        const isFirst = idx === 0;
        const isLast = idx === rules.length - 1;
        const upBtn = `<button class="table-action-btn move-btn" ${isFirst ? 'disabled' : ''} onclick="window.moveRule(${rule.id}, 'up')" title="${t("routing_btn_move_up", "Вверх")}"><i class="fa-solid fa-arrow-up"></i></button>`;
        const downBtn = `<button class="table-action-btn move-btn" ${isLast ? 'disabled' : ''} onclick="window.moveRule(${rule.id}, 'down')" title="${t("routing_btn_move_down", "Вниз")}"><i class="fa-solid fa-arrow-down"></i></button>`;
        
        const deleteBtn = (rule.inbound_tags && rule.inbound_tags.includes("api") && rule.outbound_tag === "api")
            ? `<button class="table-action-btn delete-btn" disabled><i class="fa-regular fa-trash-can"></i></button>`
            : `<button class="table-action-btn delete-btn" onclick="window.deleteRoutingRule(${rule.id})" title="${t("routing_btn_delete", "Удалить")}"><i class="fa-regular fa-trash-can"></i></button>`;

        tr.innerHTML = `
            <td style="padding: 12px 15px; text-align: center; font-weight: 600; color: var(--text-secondary);">${idx + 1}</td>
            <td style="padding: 12px 15px; font-weight: 500;">${rule.remark || "-"}</td>
            <td style="padding: 12px 15px;">${conditionsHtml}</td>
            <td style="padding: 12px 15px;"><span class="${badgeClass}">${rule.outbound_tag}</span></td>
            <td style="padding: 12px 15px;">
                <label class="switch-toggle">
                    <input type="checkbox" ${rule.enable === 1 ? 'checked' : ''} onchange="window.toggleRoutingRule(${rule.id}, this.checked)">
                    <span class="switch-slider"></span>
                </label>
            </td>
            <td style="padding: 12px 15px;">
                <div style="display: flex; gap: 8px; align-items: center;">
                    ${upBtn}
                    ${downBtn}
                    <button class="table-action-btn edit-btn" onclick="window.openRoutingRuleModal(${rule.id})" title="${t("routing_btn_edit", "Редактировать")}"><i class="fa-regular fa-pen-to-square"></i></button>
                    ${deleteBtn}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Load Quick Security Rules settings
    try {
        const setRes = await fetch("/api/settings", {
            headers: { "Authorization": `Bearer ${getCsrfToken()}` }
        });
        if (setRes.status === 200) {
            const setObj = await setRes.json();
            const bittorrentCb = document.getElementById("quick-block-bittorrent");
            if (bittorrentCb) bittorrentCb.checked = setObj.block_bittorrent || false;
            
            const adsCb = document.getElementById("quick-block-ads");
            if (adsCb) adsCb.checked = setObj.block_ads || false;
            
            const cnCb = document.getElementById("quick-block-cn");
            if (cnCb) cnCb.checked = setObj.block_cn || false;
            
            const ruCb = document.getElementById("quick-block-ru");
            if (ruCb) ruCb.checked = setObj.block_ru || false;
            
            const usCb = document.getElementById("quick-block-us");
            if (usCb) usCb.checked = setObj.block_us || false;
        }
    } catch (err) {
        console.error("Failed to load quick security rules:", err);
    }
}

export async function openRoutingRuleModal(id = null) {
    const form = document.getElementById("routing-rule-form");
    if (!form) return;
    form.reset();
    populateOutboundDropdowns(false);
    
    const clientSelectGroup = document.getElementById("rule-client-select-group");
    if (clientSelectGroup) clientSelectGroup.style.display = "none";
    
    const inboundsRes = await apiFetch("/panel/api/inbounds/list");
    const inbounds = (inboundsRes && inboundsRes.success) ? inboundsRes.obj : [];
    
    const inboundSelect = document.getElementById("rule-inbound-select");
    if (inboundSelect) {
        inboundSelect.innerHTML = '<option value="">Все подключения (Any)</option>';
        
        const apiOpt = document.createElement("option");
        apiOpt.value = "api";
        apiOpt.innerText = "api (Internal API traffic)";
        inboundSelect.appendChild(apiOpt);
        
        inbounds.forEach(ib => {
            if (ib.protocol === "hysteria2") {
                const streamSettings = JSON.parse(ib.streamSettings || "{}");
                const hysteria = streamSettings.hysteria || {};
                if (hysteria.routingViaXray) {
                    const opt = document.createElement("option");
                    opt.value = `inbound-${ib.id}-socks`;
                    opt.innerText = `Hysteria 2 - ${ib.remark} (через Xray)`;
                    inboundSelect.appendChild(opt);
                }
            } else {
                const opt = document.createElement("option");
                opt.value = `inbound-${ib.id}`;
                opt.innerText = `${ib.protocol.toUpperCase()} - ${ib.remark}`;
                inboundSelect.appendChild(opt);
            }
        });
        
        inboundSelect.onchange = function() {
            const selectedVal = inboundSelect.value;
            const clientSelect = document.getElementById("rule-client-select");
            
            if (!selectedVal || selectedVal === "api") {
                if (clientSelectGroup) clientSelectGroup.style.display = "none";
                if (clientSelect) clientSelect.innerHTML = '<option value="">Все клиенты (All)</option>';
                return;
            }
            
            const parts = selectedVal.split("-");
            const ibId = parseInt(parts[1]);
            const selectedIb = inbounds.find(x => x.id === ibId);
            
            if (selectedIb && selectedIb.clientStats && selectedIb.clientStats.length > 0) {
                if (clientSelect) {
                    clientSelect.innerHTML = '<option value="">Все клиенты (All)</option>';
                    selectedIb.clientStats.forEach(c => {
                        const opt = document.createElement("option");
                        opt.value = c.email;
                        opt.innerText = c.email;
                        clientSelect.appendChild(opt);
                    });
                }
                if (clientSelectGroup) clientSelectGroup.style.display = "block";
            } else {
                if (clientSelectGroup) clientSelectGroup.style.display = "none";
                if (clientSelect) clientSelect.innerHTML = '<option value="">Все клиенты (All)</option>';
            }
        };
    }
    
    if (id) {
        document.getElementById("routing-rule-modal-title").innerText = t("routing_rule_modal_edit", "Редактирование правила маршрутизации");
        const res = await apiFetch(`/api/routing/rules`);
        const rule = res.obj.find(x => x.id === id);
        if (rule) {
            const isApiRule = rule.inbound_tags && rule.inbound_tags.includes("api") && rule.outbound_tag === "api";
            if (isApiRule) {
                populateOutboundDropdowns(true);
            }
            document.getElementById("rule-id").value = rule.id;
            document.getElementById("rule-remark").value = rule.remark || "";
            document.getElementById("rule-outbound").value = rule.outbound_tag;
            document.getElementById("rule-protocols").value = rule.protocols ? rule.protocols.join(", ") : "";
            
            const inboundTag = rule.inbound_tags && rule.inbound_tags.length > 0 ? rule.inbound_tags[0] : "";
            if (inboundSelect) {
                inboundSelect.value = inboundTag;
                inboundSelect.onchange();
            }
            
            const clientSelect = document.getElementById("rule-client-select");
            const ruleUser = rule.users && rule.users.length > 0 ? rule.users[0] : "";
            if (clientSelect && ruleUser) {
                clientSelect.value = ruleUser;
            }
            
            document.getElementById("rule-domains").value = rule.domains ? rule.domains.join("\n") : "";
            document.getElementById("rule-ips").value = rule.ips ? rule.ips.join("\n") : "";
            document.getElementById("rule-enable").checked = rule.enable === 1;
        }
    } else {
        document.getElementById("routing-rule-modal-title").innerText = t("routing_rule_modal_create", "Создание правила маршрутизации");
        document.getElementById("rule-id").value = "";
        document.getElementById("rule-enable").checked = true;
    }
    
    document.getElementById("routing-rule-modal").classList.add("active");
}

export async function toggleRoutingRule(id, checked) {
    const listRes = await apiFetch("/api/routing/rules");
    if (!listRes || !listRes.success) return;
    const rule = listRes.obj.find(x => x.id === id);
    if (!rule) return;
    
    const res = await apiFetch(`/api/routing/rules/update/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            remark: rule.remark,
            outbound_tag: rule.outbound_tag,
            inbound_tags: rule.inbound_tags,
            users: rule.users || [],
            domains: rule.domains,
            ips: rule.ips,
            protocols: rule.protocols,
            enable: checked ? 1 : 0,
            sort_order: rule.sort_order
        })
    });
    
    if (res && res.success) {
        showToast(checked ? t("routing_rule_enabled", "Правило маршрутизации включено") : t("routing_rule_disabled", "Правило маршрутизации выключено"));
        loadRoutingRules();
    }
}

export async function deleteRoutingRule(id) {
    if (!confirm(t("routing_confirm_delete_rule", "Вы уверены, что хотите удалить это правило маршрутизации?"))) return;
    
    const res = await apiFetch(`/api/routing/rules/delete/${id}`, { method: "POST" });
    if (res && res.success) {
        showToast(t("routing_rule_deleted", "Правило успешно удалено"));
        loadRoutingRules();
    } else {
        showToast(res ? res.msg : "Error", "error");
    }
}

window.openRoutingRuleModal = openRoutingRuleModal;
window.toggleRoutingRule = toggleRoutingRule;
window.deleteRoutingRule = deleteRoutingRule;
