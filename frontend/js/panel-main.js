import { apiFetch } from "./api.js";
import { showToast } from "./ui.js";
import { loadBbrStatus } from "./dashboard.js";
import { t } from "./i18n.js";
import { loadHysteriaCoreInfo, loadHysteriaLogs, setupHysteriaListeners } from "./hysteria.js";
import { loadOutbounds, loadRoutingRules, setupRoutingListeners } from "./routing.js";
import { setupSslListeners } from "./modules/ssl.js";
import { switchTab } from "./modules/router.js";
import { setupSettingsListeners, loadSettings } from "./modules/settings-ui.js";
import { setupInboundListeners, loadInbounds, toggleInbound, deleteInbound, openEditInboundModal } from "./inbound-modal.js";
import { setupClientListeners, openClientsModal, setLoadInboundsCallback } from "./clients.js";

import { loadXrayConfig, setupXrayConfigListeners } from "./modules/xray-config.js";
import { loadCoreInfo, loadLogs, setupXrayCoreListeners } from "./modules/xray-core.js";

export async function initPanel() {
    // Expose functions to window scope for HTML inline events compatibility
    window.openClientsModal = openClientsModal;
    window.deleteInbound = deleteInbound;
    window.toggleInbound = toggleInbound;
    window.openEditInboundModal = openEditInboundModal;

    setupAuthorizedEventListeners();
    setLoadInboundsCallback(loadInbounds);

    switchTab("dashboard", loadInbounds, loadCoreInfo, loadLogs);
    loadBbrStatus();
}

function setupAuthorizedEventListeners() {
    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", () => switchTab(item.getAttribute("data-tab"), loadInbounds, loadCoreInfo, loadLogs));
    });
    
    document.getElementById("logout-btn").addEventListener("click", async () => {
        await apiFetch("/api/logout", { method: "POST" });
        location.reload();
    });
    
    document.querySelectorAll(".copy-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const targetId = btn.getAttribute("data-target");
            const element = document.getElementById(targetId);
            if (!element) return;
            if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
                element.select();
                document.execCommand("copy");
            } else {
                navigator.clipboard.writeText(element.innerText || element.textContent);
            }
            showToast(t("copied_to_clipboard", "Скопировано в буфер обмена!"));
        });
    });
    
    document.querySelectorAll(".close-modal-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            btn.closest(".modal").classList.remove("active");
        });
    });

    setupSslListeners();
    setupSettingsListeners();
    setupInboundListeners(loadInbounds);
    setupClientListeners(loadInbounds);
    setupHysteriaListeners();
    setupRoutingListeners();
    
    // Bind split xray sub-listeners
    setupXrayCoreListeners();
    setupXrayConfigListeners();
}
