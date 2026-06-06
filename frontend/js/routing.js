import { apiFetch } from "./api.js";
import { showToast } from "./ui.js";
import { t } from "./i18n.js";
import {
    outboundsCache,
    loadOutbounds,
    openOutboundModal,
    toggleOutbound,
    deleteOutbound,
    updateOutboundFormFields,
    populateOutboundDropdowns,
    validateOutboundForm,
    parseProxyLink
} from "./modules/routing-outbounds.js";
import {
    loadRoutingRules,
    openRoutingRuleModal,
    toggleRoutingRule,
    deleteRoutingRule,
    setupRoutingRulesListeners
} from "./modules/routing-rules.js";
import "./modules/drag-drop.js";

// Re-export outbounds and rules for outside use
export { loadOutbounds, loadRoutingRules };

// Global functions exposed to window scope for HTML onclick bindings
window.openOutboundModal = openOutboundModal;
window.toggleOutbound = toggleOutbound;
window.deleteOutbound = deleteOutbound;
window.openRoutingRuleModal = openRoutingRuleModal;
window.toggleRoutingRule = toggleRoutingRule;
window.deleteRoutingRule = deleteRoutingRule;

window.testOutbound = async function(id, testType, btnElement) {
    const icon = btnElement.querySelector("i");
    const originalClass = icon.className;
    icon.className = "fa-solid fa-spinner fa-spin";
    btnElement.disabled = true;
    
    try {
        const res = await apiFetch(`/api/routing/outbounds/test/${id}?test_type=${testType}`, { method: "POST" });
        if (res && res.success) {
            showToast(t("routing_test_success", "Соединение успешно!") + ` (${res.ping} ms)`);
            const settingsCell = btnElement.closest("tr").querySelector("td:nth-child(4)");
            if (settingsCell) {
                const originalText = settingsCell.innerText.split(" (")[0];
                const typeLabel = testType.toUpperCase();
                settingsCell.innerHTML = `${originalText} <span style="color: var(--accent-green); font-size: 12px; font-weight: 600;">(${typeLabel}: ${res.ping} ms)</span>`;
            }
        } else {
            showToast(res ? res.msg : "Ошибка проверки", "error");
            const settingsCell = btnElement.closest("tr").querySelector("td:nth-child(4)");
            if (settingsCell) {
                const originalText = settingsCell.innerText.split(" (")[0];
                const typeLabel = testType.toUpperCase();
                const errMsg = res && res.msg ? res.msg : "Error";
                settingsCell.innerHTML = `${originalText} <span style="color: var(--accent-rose); font-size: 11px; font-weight: 600;" title="${errMsg}">(${typeLabel}: Error)</span>`;
            }
        }
    } catch(e) {
        showToast("Error testing outbound", "error");
    } finally {
        icon.className = originalClass;
        btnElement.disabled = false;
    }
};

export function setupRoutingListeners() {
    setupRoutingRulesListeners();

    const addObBtn = document.getElementById("add-outbound-btn");
    if (addObBtn) {
        addObBtn.addEventListener("click", () => openOutboundModal());
    }
    
    const protocolSelect = document.getElementById("ob-protocol");
    if (protocolSelect) {
        protocolSelect.addEventListener("change", updateOutboundFormFields);
    }
    
    const securitySelect = document.getElementById("ob-security");
    if (securitySelect) {
        securitySelect.addEventListener("change", updateOutboundFormFields);
    }
    
    const importLinkInput = document.getElementById("ob-import-link");
    if (importLinkInput) {
        importLinkInput.addEventListener("input", (e) => {
            const val = e.target.value.trim();
            if (!val) return;
            
            const lowerVal = val.toLowerCase();
            if (lowerVal.startsWith("vless://") || 
                lowerVal.startsWith("ss://") || 
                lowerVal.startsWith("socks://") || 
                lowerVal.startsWith("socks5://") || 
                lowerVal.startsWith("http://") || 
                lowerVal.startsWith("hysteria2://") || 
                lowerVal.startsWith("hysteria://")) {
                
                const parsed = parseProxyLink(val);
                if (parsed) {
                    document.getElementById("ob-protocol").value = parsed.protocol;
                    document.getElementById("ob-remark").value = parsed.remark || "";
                    
                    const sanitizedHost = (parsed.host || "").replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
                    document.getElementById("ob-tag").value = `${parsed.protocol}-${sanitizedHost || Math.floor(Math.random() * 1000)}`;
                    
                    document.getElementById("ob-address").value = parsed.host || "";
                    document.getElementById("ob-port").value = parsed.port || "";
                    
                    document.getElementById("ob-username").value = "";
                    document.getElementById("ob-password").value = "";
                    
                    if (parsed.protocol === "vless") {
                        document.getElementById("ob-password").value = parsed.uuid || "";
                        document.getElementById("ob-security").value = parsed.security || "none";
                        document.getElementById("ob-sni").value = parsed.sni || "";
                        document.getElementById("ob-pbk").value = parsed.pbk || "";
                        document.getElementById("ob-shortid").value = parsed.sid || "";
                        document.getElementById("ob-fingerprint").value = parsed.fp || "chrome";
                        document.getElementById("ob-alpn").value = parsed.alpn || "";
                        document.getElementById("ob-flow").value = parsed.flow || "";
                        document.getElementById("ob-encryption").value = parsed.encryption || "";
                    } else if (parsed.protocol === "hysteria") {
                        document.getElementById("ob-password").value = parsed.password || "";
                        document.getElementById("ob-sni").value = parsed.sni || "";
                        document.getElementById("ob-alpn").value = parsed.alpn || "";
                        document.getElementById("ob-up-mbps").value = parsed.up || "";
                        document.getElementById("ob-down-mbps").value = parsed.down || "";
                    } else if (parsed.protocol === "shadowsocks") {
                        document.getElementById("ob-password").value = parsed.password || "";
                        document.getElementById("ob-ss-method").value = parsed.method || "aes-256-gcm";
                    } else if (parsed.protocol === "socks" || parsed.protocol === "http") {
                        document.getElementById("ob-username").value = parsed.username || "";
                        document.getElementById("ob-password").value = parsed.password || "";
                    }
                    
                    e.target.value = ""; 
                    updateOutboundFormFields();
                    
                    const inputs = document.querySelectorAll("#outbound-form input, #outbound-form select, #outbound-form textarea");
                    inputs.forEach(el => el.classList.remove("input-invalid"));
                    
                    showToast(t("routing_modal_import_success", "Ссылка успешно импортирована!"));
                } else {
                    showToast(t("routing_modal_import_error", "Не удалось распознать ссылку. Проверьте формат."), "warning");
                }
            }
        });
    }

    const testObBtn = document.getElementById("ob-test-btn");
    if (testObBtn) {
        testObBtn.addEventListener("click", async () => {
            if (!validateOutboundForm()) return;
            
            const icon = testObBtn.querySelector("i");
            const btnText = testObBtn.querySelector("span");
            const originalClass = icon.className;
            const originalText = btnText.innerText;
            
            icon.className = "fa-solid fa-spinner fa-spin";
            btnText.innerText = t("routing_testing", "Проверка...");
            testObBtn.disabled = true;
            
            try {
                const protocol = document.getElementById("ob-protocol").value;
                const test_type = document.getElementById("ob-test-type").value;
                const address = document.getElementById("ob-address").value.trim();
                const port = parseInt(document.getElementById("ob-port").value);
                const password = document.getElementById("ob-password").value.trim();
                
                let settings = {};
                let streamSettings = {};
                
                if (protocol === "shadowsocks") {
                    const method = document.getElementById("ob-ss-method").value;
                    settings = {
                        "servers": [{ "address": address, "port": port, "password": password, "method": method }]
                    };
                } else if (protocol === "vless") {
                    const flow = document.getElementById("ob-flow").value;
                    const encryption = document.getElementById("ob-encryption").value.trim() || "none";
                    settings = {
                        "vnext": [{
                            "address": address,
                            "port": port,
                            "users": [{ "id": password, "encryption": encryption, "flow": flow }]
                        }]
                    };
                    
                    const security = document.getElementById("ob-security").value;
                    const sni = document.getElementById("ob-sni").value.trim();
                    streamSettings = {
                        "network": "tcp",
                        "security": security
                    };
                    
                    if (security === "tls") {
                        const alpnInput = document.getElementById("ob-alpn").value.trim();
                        const alpn = alpnInput ? alpnInput.split(",").map(s => s.trim()).filter(Boolean) : [];
                        streamSettings.tlsSettings = {
                            "serverName": sni,
                            "allowInsecure": false
                        };
                        if (alpn.length > 0) {
                            streamSettings.tlsSettings.alpn = alpn;
                        }
                    } else if (security === "reality") {
                        const pbk = document.getElementById("ob-pbk").value.trim();
                        const shortId = document.getElementById("ob-shortid").value.trim();
                        const fp = document.getElementById("ob-fingerprint").value;
                        streamSettings.realitySettings = {
                            "serverName": sni,
                            "publicKey": pbk,
                            "shortId": shortId,
                            "fingerprint": fp
                        };
                    }
                } else if (protocol === "hysteria") {
                    settings = { "version": 2, "address": address, "port": port };
                    
                    const sni = document.getElementById("ob-sni").value.trim();
                    const alpnInput = document.getElementById("ob-alpn").value.trim() || "h3";
                    const alpn = alpnInput.split(",").map(s => s.trim()).filter(Boolean);
                    
                    const upMbps = parseInt(document.getElementById("ob-up-mbps").value);
                    const downMbps = parseInt(document.getElementById("ob-down-mbps").value);
                    
                    let hysteriaSettings = { "version": 2, "auth": password };
                    if (!isNaN(upMbps) && upMbps > 0) hysteriaSettings.up = `${upMbps} mbps`;
                    if (!isNaN(downMbps) && downMbps > 0) hysteriaSettings.down = `${downMbps} mbps`;
                    
                    streamSettings = {
                        "network": "hysteria",
                        "security": "tls",
                        "tlsSettings": { "serverName": sni, "alpn": alpn },
                        "hysteriaSettings": hysteriaSettings
                    };
                } else if (protocol === "socks" || protocol === "http") {
                    const username = document.getElementById("ob-username").value.trim();
                    const users = username || password ? [{"user": username, "pass": password}] : [];
                    settings = {
                        "servers": [{ "address": address, "port": port, "users": users }]
                    };
                }
                
                const res = await apiFetch("/api/routing/outbounds/test", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ protocol, settings, streamSettings, test_type })
                });
                
                if (res && res.success) {
                    showToast(t("routing_test_success", "Соединение успешно!") + ` (${res.ping} ms)`);
                } else {
                    showToast(res ? res.msg : "Ошибка соединения", "error");
                }
            } catch (err) {
                showToast("Error: " + err.message, "error");
            } finally {
                icon.className = originalClass;
                btnText.innerText = originalText;
                testObBtn.disabled = false;
            }
        });
    }
    
    const outboundForm = document.getElementById("outbound-form");
    if (outboundForm) {
        outboundForm.querySelectorAll("input, select, textarea").forEach(el => {
            el.addEventListener("input", () => {
                el.classList.remove("input-invalid");
            });
            el.addEventListener("change", () => {
                el.classList.remove("input-invalid");
            });
        });

        outboundForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            
            if (!validateOutboundForm()) {
                return;
            }
            
            const id = document.getElementById("ob-id").value;
            const remark = document.getElementById("ob-remark").value.trim();
            const protocol = document.getElementById("ob-protocol").value;
            const tag = document.getElementById("ob-tag").value.trim();
            const enable = document.getElementById("ob-enable").checked ? 1 : 0;
            
            // Prepare settings JSON
            let settings = {};
            let streamSettings = {};
            
            if (protocol === "socks" || protocol === "http" || protocol === "shadowsocks" || protocol === "vless" || protocol === "hysteria") {
                const address = document.getElementById("ob-address").value.trim();
                const port = parseInt(document.getElementById("ob-port").value);
                const password = document.getElementById("ob-password").value.trim();
                
                if (!address || isNaN(port)) {
                    showToast(t("routing_err_host_port", "Укажите адрес и порт сервера прокси"), "warning");
                    return;
                }
                
                if (protocol === "shadowsocks") {
                    const method = document.getElementById("ob-ss-method").value;
                    settings = {
                        "servers": [{
                            "address": address,
                            "port": port,
                            "password": password,
                            "method": method
                        }]
                    };
                } else if (protocol === "vless") {
                    const flow = document.getElementById("ob-flow").value;
                    const encryption = document.getElementById("ob-encryption").value.trim() || "none";
                    settings = {
                        "vnext": [{
                            "address": address,
                            "port": port,
                            "users": [{
                                "id": password,
                                "encryption": encryption,
                                "flow": flow
                            }]
                        }]
                    };
                    
                    const security = document.getElementById("ob-security").value;
                    const sni = document.getElementById("ob-sni").value.trim();
                    streamSettings = {
                        "network": "tcp",
                        "security": security
                    };
                    
                    if (security === "tls") {
                        const alpnInput = document.getElementById("ob-alpn").value.trim();
                        const alpn = alpnInput ? alpnInput.split(",").map(s => s.trim()).filter(Boolean) : [];
                        streamSettings.tlsSettings = {
                            "serverName": sni,
                            "allowInsecure": false
                        };
                        if (alpn.length > 0) {
                            streamSettings.tlsSettings.alpn = alpn;
                        }
                    } else if (security === "reality") {
                        const pbk = document.getElementById("ob-pbk").value.trim();
                        const shortId = document.getElementById("ob-shortid").value.trim();
                        const fp = document.getElementById("ob-fingerprint").value;
                        streamSettings.realitySettings = {
                            "serverName": sni,
                            "publicKey": pbk,
                            "shortId": shortId,
                            "fingerprint": fp
                        };
                    }
                } else if (protocol === "hysteria") {
                    settings = {
                        "version": 2,
                        "address": address,
                        "port": port
                    };
                    
                    const sni = document.getElementById("ob-sni").value.trim();
                    const alpnInput = document.getElementById("ob-alpn").value.trim() || "h3";
                    const alpn = alpnInput.split(",").map(s => s.trim()).filter(Boolean);
                    
                    const upMbps = parseInt(document.getElementById("ob-up-mbps").value);
                    const downMbps = parseInt(document.getElementById("ob-down-mbps").value);
                    
                    let hysteriaSettings = {
                        "version": 2,
                        "auth": password
                    };
                    if (!isNaN(upMbps) && upMbps > 0) {
                        hysteriaSettings.up = `${upMbps} mbps`;
                    }
                    if (!isNaN(downMbps) && downMbps > 0) {
                        hysteriaSettings.down = `${downMbps} mbps`;
                    }
                    
                    streamSettings = {
                        "network": "hysteria",
                        "security": "tls",
                        "tlsSettings": {
                            "serverName": sni,
                            "alpn": alpn
                        },
                        "hysteriaSettings": hysteriaSettings
                    };
                } else {
                    const username = document.getElementById("ob-username").value.trim();
                    const users = username || password ? [{"user": username, "pass": password}] : [];
                    settings = {
                        "servers": [{
                            "address": address,
                            "port": port,
                            "users": users
                        }]
                    };
                }
            }
            
            const url = id ? `/api/routing/outbounds/update/${id}` : "/api/routing/outbounds/create";
            const res = await apiFetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ remark, protocol, tag, settings, streamSettings, enable })
            });
            
            if (res && res.success) {
                showToast(id ? t("routing_outbound_updated", "Исходящее подключение обновлено") : t("routing_outbound_created", "Исходящее подключение создано"));
                document.getElementById("outbound-modal").classList.remove("active");
                loadOutbounds();
            } else {
                showToast(res ? res.msg : "Error", "error");
            }
        });
    }
}
