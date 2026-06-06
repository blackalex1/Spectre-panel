import { apiFetch } from "../api.js";
import { showToast } from "../ui.js";
import { t } from "../i18n.js";

export async function loadWarpStatus() {
    const installedBadge = document.getElementById("settings-warp-installed-badge");
    const statusBadge = document.getElementById("settings-warp-status-badge");
    const accountBadge = document.getElementById("settings-warp-account-badge");
    const quotaBadge = document.getElementById("settings-warp-quota-badge");
    const statusRow = document.getElementById("settings-warp-status-row");
    const accountRow = document.getElementById("settings-warp-account-row");
    const quotaRow = document.getElementById("settings-warp-quota-row");
    const installBtn = document.getElementById("btn-warp-install");
    const configPanel = document.getElementById("settings-warp-config-panel");
    const licenseInput = document.getElementById("settings-warp-license");
    const registerFreeBtn = document.getElementById("btn-warp-register-free");
    
    if (!installedBadge) return;
    
    const res = await apiFetch("/api/system/warp/status");
    if (res) {
        if (res.installed) {
            installedBadge.innerText = t("settings_warp_badge_installed", "Установлен");
            installedBadge.className = "badge success-badge";
            installedBadge.style.background = "rgba(46, 213, 115, 0.15)";
            installedBadge.style.color = "#2ed573";
            
            if (installBtn) installBtn.style.display = "none";
            if (configPanel) configPanel.style.display = "flex";
            if (statusRow) statusRow.style.display = "flex";
            if (accountRow) accountRow.style.display = "flex";
            
            if (res.connected) {
                if (statusBadge) {
                    statusBadge.innerText = t("settings_warp_badge_connected", "Подключен");
                    statusBadge.className = "badge success-badge";
                    statusBadge.style.background = "rgba(46, 213, 115, 0.15)";
                    statusBadge.style.color = "#2ed573";
                }
                
                const btnConnect = document.getElementById("btn-warp-connect");
                const btnDisconnect = document.getElementById("btn-warp-disconnect");
                if (btnConnect) btnConnect.style.display = "none";
                if (btnDisconnect) btnDisconnect.style.display = "block";
            } else {
                if (statusBadge) {
                    statusBadge.innerText = t("settings_warp_badge_disconnected", "Отключен");
                    statusBadge.className = "badge warning-badge";
                    statusBadge.style.background = "rgba(255, 165, 2, 0.15)";
                    statusBadge.style.color = "#ffa502";
                }
                
                const btnConnect = document.getElementById("btn-warp-connect");
                const btnDisconnect = document.getElementById("btn-warp-disconnect");
                if (btnConnect) btnConnect.style.display = "block";
                if (btnDisconnect) btnDisconnect.style.display = "none";
            }
            
            const isPlus = res.type === "plus";
            if (accountBadge) {
                accountBadge.innerText = isPlus ? "WARP+" : "Free";
                accountBadge.className = isPlus ? "badge success-badge" : "badge secondary-badge";
                if (isPlus) {
                    accountBadge.style.background = "rgba(52, 152, 219, 0.15)";
                    accountBadge.style.color = "#3498db";
                } else {
                    accountBadge.style.background = "rgba(255, 255, 255, 0.05)";
                    accountBadge.style.color = "var(--text-secondary)";
                }
            }
            
            // Handle quota display
            if (isPlus) {
                if (quotaRow) quotaRow.style.display = "flex";
                if (quotaBadge) {
                    if (res.quota > 0) {
                        const totalGb = (res.quota / (1024 * 1024 * 1024)).toFixed(1);
                        const remainingBytes = Math.max(0, res.quota - res.usage);
                        const remainingGb = (remainingBytes / (1024 * 1024 * 1024)).toFixed(1);
                        quotaBadge.innerText = `${remainingGb} GB / ${totalGb} GB`;
                    } else {
                        quotaBadge.innerText = t("settings_warp_quota_unlimited", "Безлимитно");
                    }
                    quotaBadge.className = "badge success-badge";
                    quotaBadge.style.background = "rgba(52, 152, 219, 0.15)";
                    quotaBadge.style.color = "#3498db";
                }
            } else {
                if (quotaRow) quotaRow.style.display = "none";
            }
            
            if (registerFreeBtn) {
                registerFreeBtn.style.display = isPlus ? "block" : "none";
            }
            
            if (licenseInput) {
                licenseInput.value = res.license || "";
            }
            
            window.warpDependentRules = res.dependent_rules || [];
        } else {
            installedBadge.innerText = t("settings_warp_badge_not_installed", "Не установлен");
            installedBadge.className = "badge warning-badge";
            installedBadge.style.background = "rgba(255, 165, 2, 0.15)";
            installedBadge.style.color = "#ffa502";
            
            if (installBtn) installBtn.style.display = "block";
            if (configPanel) configPanel.style.display = "none";
            if (statusRow) statusRow.style.display = "none";
            if (accountRow) accountRow.style.display = "none";
            if (quotaRow) quotaRow.style.display = "none";
            
            window.warpDependentRules = [];
        }
    }
}

export function setupWarpListeners() {
    const btnWarpInstall = document.getElementById("btn-warp-install");
    if (btnWarpInstall) {
        btnWarpInstall.addEventListener("click", async () => {
            btnWarpInstall.disabled = true;
            const originalText = btnWarpInstall.innerHTML;
            btnWarpInstall.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${t("settings_warp_installing", "Установка...")}`;
            
            const res = await apiFetch("/api/system/warp/install", { method: "POST" });
            btnWarpInstall.disabled = false;
            btnWarpInstall.innerHTML = originalText;
            
            if (res && res.success) {
                showToast(t("settings_warp_toast_install_success", "Cloudflare WARP успешно установлен!"));
                await loadWarpStatus();
            } else {
                showToast(res ? res.msg : "Не удалось установить WARP", "error");
            }
        });
    }

    const btnWarpConnect = document.getElementById("btn-warp-connect");
    if (btnWarpConnect) {
        btnWarpConnect.addEventListener("click", async () => {
            btnWarpConnect.disabled = true;
            const originalText = btnWarpConnect.innerHTML;
            btnWarpConnect.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${t("settings_warp_connecting", "Подключение...")}`;
            
            const res = await apiFetch("/api/system/warp/connect", { method: "POST" });
            btnWarpConnect.disabled = false;
            btnWarpConnect.innerHTML = originalText;
            
            if (res && res.success) {
                showToast(t("settings_warp_toast_connect_success", "WARP успешно подключен!"));
                await loadWarpStatus();
            } else {
                showToast(res ? res.msg : "Не удалось подключить WARP", "error");
            }
        });
    }

    const btnWarpDisconnect = document.getElementById("btn-warp-disconnect");
    if (btnWarpDisconnect) {
        btnWarpDisconnect.addEventListener("click", async () => {
            const rules = window.warpDependentRules || [];
            if (rules.length > 0) {
                const ruleNames = rules.map(r => `• ${r.remark}`).join("\n");
                const warningMsg = t(
                    "settings_warp_warn_disconnect_body",
                    "Внимание! Отключение WARP приведет к временной деактивации следующих правил маршрутизации:\n\n{rules}\n\nДоступ к ресурсам в этих правилах пропадет! Вы уверены, что хотите продолжить?"
                ).replace("{rules}", ruleNames);
                
                if (!confirm(warningMsg)) {
                    return;
                }
            }
            
            btnWarpDisconnect.disabled = true;
            const originalText = btnWarpDisconnect.innerHTML;
            btnWarpDisconnect.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${t("settings_warp_disconnecting", "Отключение...")}`;
            
            const res = await apiFetch("/api/system/warp/disconnect", { method: "POST" });
            btnWarpDisconnect.disabled = false;
            btnWarpDisconnect.innerHTML = originalText;
            
            if (res && res.success) {
                showToast(t("settings_warp_toast_disconnect_success", "WARP успешно отключен!"));
                await loadWarpStatus();
            } else {
                showToast(res ? res.msg : "Не удалось отключить WARP", "error");
            }
        });
    }

    const btnWarpUninstall = document.getElementById("btn-warp-uninstall");
    if (btnWarpUninstall) {
        btnWarpUninstall.addEventListener("click", async () => {
            const rules = window.warpDependentRules || [];
            if (rules.length > 0) {
                const ruleNames = rules.map(r => `• ${r.remark}`).join("\n");
                const warningMsg = t(
                    "settings_warp_warn_uninstall_body",
                    "Внимание! Удаление WARP приведет к временной деактивации следующих правил маршрутизации:\n\n{rules}\n\nДоступ к ресурсам в этих правилах пропадет! Вы уверены, что хотите продолжить?"
                ).replace("{rules}", ruleNames);
                
                if (!confirm(warningMsg)) {
                    return;
                }
            }
            
            if (!confirm("Вы действительно хотите полностью удалить Cloudflare WARP с сервера?")) {
                return;
            }
            
            btnWarpUninstall.disabled = true;
            const originalText = btnWarpUninstall.innerHTML;
            btnWarpUninstall.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${t("settings_warp_uninstalling", "Удаление...")}`;
            
            const res = await apiFetch("/api/system/warp/uninstall", { method: "POST" });
            btnWarpUninstall.disabled = false;
            btnWarpUninstall.innerHTML = originalText;
            
            if (res && res.success) {
                showToast(t("settings_warp_toast_uninstall_success", "Cloudflare WARP успешно удален!"));
                await loadWarpStatus();
            } else {
                showToast(res ? res.msg : "Не удалось удалить WARP", "error");
            }
        });
    }

    const btnWarpApplyKey = document.getElementById("btn-warp-apply-key");
    if (btnWarpApplyKey) {
        btnWarpApplyKey.addEventListener("click", async () => {
            const licenseInput = document.getElementById("settings-warp-license");
            const key = licenseInput ? licenseInput.value.trim() : "";
            if (!key) {
                showToast("Пожалуйста, введите лицензионный ключ WARP+", "error");
                return;
            }
            
            btnWarpApplyKey.disabled = true;
            const originalText = btnWarpApplyKey.innerHTML;
            btnWarpApplyKey.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${t("settings_warp_registering", "Регистрация...")}`;
            
            const res = await apiFetch("/api/system/warp/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ license_key: key })
            });
            btnWarpApplyKey.disabled = false;
            btnWarpApplyKey.innerHTML = originalText;
            
            if (res && res.success) {
                showToast(t("settings_warp_toast_register_success", "Лицензионный ключ успешно применен!"));
                await loadWarpStatus();
            } else {
                showToast(res ? res.msg : "Не удалось применить лицензионный ключ", "error");
            }
        });
    }

    const btnWarpRegisterFree = document.getElementById("btn-warp-register-free");
    if (btnWarpRegisterFree) {
        btnWarpRegisterFree.addEventListener("click", async () => {
            if (!confirm("Вы действительно хотите сбросить аккаунт WARP+ на бесплатный?")) {
                return;
            }
            btnWarpRegisterFree.disabled = true;
            const originalText = btnWarpRegisterFree.innerHTML;
            btnWarpRegisterFree.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${t("settings_warp_registering", "Сброс...")}`;
            
            const res = await apiFetch("/api/system/warp/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ license_key: "" })
            });
            btnWarpRegisterFree.disabled = false;
            btnWarpRegisterFree.innerHTML = originalText;
            
            if (res && res.success) {
                showToast(t("settings_warp_toast_register_success", "Регистрация бесплатного аккаунта выполнена!"));
                await loadWarpStatus();
            } else {
                showToast(res ? res.msg : "Не удалось зарегистрировать бесплатный аккаунт", "error");
            }
        });
    }
}
