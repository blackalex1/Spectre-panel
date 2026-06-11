import { apiFetch, getCsrfToken } from "../api.js";
import { showToast } from "../ui.js";
import { t } from "../i18n.js";
import { loadBbrStatus } from "../dashboard.js";
import { loadWarpStatus, setupWarpListeners } from "./warp-ui.js";
import { loadAuditLogs, setupAuditLogsListeners } from "./audit-logs.js";

export let originalSecretPath = "";

export function setOriginalSecretPath(val) {
    originalSecretPath = val;
}

export async function loadSettings() {
    const setRes = await fetch("/api/settings", {
        headers: { "Authorization": `Bearer ${getCsrfToken()}` }
    });
    
    if (setRes.status === 200) {
        const setObj = await setRes.json();
        document.getElementById("setting-api-token").value = setObj.api_token;
        
        const secretPathInput = document.getElementById("setting-secret-path-input");
        if (secretPathInput) {
            secretPathInput.value = setObj.secret_path;
            originalSecretPath = setObj.secret_path;
        }
        
        const credNewUserInput = document.getElementById("setting-cred-new-user");
        if (credNewUserInput) {
            credNewUserInput.value = setObj.admin_username || "";
        }

        const navUsername = document.getElementById("nav-username");
        if (navUsername && setObj.admin_username) {
            navUsername.innerText = setObj.admin_username;
        }
        
        const badge2fa = document.getElementById("2fa-status-badge");
        const btnSetup2fa = document.getElementById("btn-2fa-setup-trigger");
        const btnDisable2fa = document.getElementById("btn-2fa-disable-trigger");
        const setupPanel2fa = document.getElementById("2fa-setup-panel");
        const disablePanel2fa = document.getElementById("2fa-disable-panel");

        if (badge2fa) {
            if (setObj.totp_enabled) {
                badge2fa.innerText = t("settings_2fa_enabled", "Включена");
                badge2fa.className = "badge success-badge";
                badge2fa.style.background = "rgba(46, 213, 115, 0.15)";
                badge2fa.style.color = "#2ed573";
                
                if (btnSetup2fa) btnSetup2fa.style.display = "none";
                if (btnDisable2fa) btnDisable2fa.style.display = "block";
            } else {
                badge2fa.innerText = t("settings_2fa_disabled", "Выключена");
                badge2fa.className = "badge warning-badge";
                badge2fa.style.background = "rgba(255, 165, 2, 0.15)";
                badge2fa.style.color = "#ffa502";
                
                if (btnSetup2fa) btnSetup2fa.style.display = "block";
                if (btnDisable2fa) btnDisable2fa.style.display = "none";
            }
            if (setupPanel2fa) setupPanel2fa.style.display = "none";
            if (disablePanel2fa) disablePanel2fa.style.display = "none";
        }
        
        const sessionTimeoutInput = document.getElementById("setting-session-timeout");
        if (sessionTimeoutInput) {
            sessionTimeoutInput.value = setObj.session_timeout_days !== undefined ? setObj.session_timeout_days : 7;
        }
        
        const loginMaxAttemptsInput = document.getElementById("setting-login-max-attempts");
        if (loginMaxAttemptsInput) {
            loginMaxAttemptsInput.value = setObj.login_max_attempts !== undefined ? setObj.login_max_attempts : 5;
        }
        
        const loginAttemptsPeriodInput = document.getElementById("setting-login-attempts-period");
        if (loginAttemptsPeriodInput) {
            loginAttemptsPeriodInput.value = setObj.login_attempts_period !== undefined ? setObj.login_attempts_period : 60;
        }
        
        const loginFailDelayInput = document.getElementById("setting-login-fail-delay");
        if (loginFailDelayInput) {
            loginFailDelayInput.value = setObj.login_fail_delay !== undefined ? setObj.login_fail_delay : 1.0;
        }
        
        const decoyType = setObj.decoy_type || "static";
        const decoyTypeSelect = document.getElementById("setting-decoy-type");
        if (decoyTypeSelect) {
            decoyTypeSelect.value = decoyType;
        }
        
        const decoyValueInput = document.getElementById("setting-decoy-value");
        if (decoyValueInput) {
            decoyValueInput.value = setObj.decoy_value || "";
        }
        
        // Load SSL fields
        const sslDomainInput = document.getElementById("setting-ssl-domain");
        if (sslDomainInput) {
            sslDomainInput.value = setObj.ssl_domain || "";
        }
        const sslEmailInput = document.getElementById("setting-ssl-email");
        if (sslEmailInput) {
            sslEmailInput.value = setObj.ssl_email || "";
        }
        // Load Telegram fields
        const telegramTokenInput = document.getElementById("setting-telegram-token");
        if (telegramTokenInput) {
            telegramTokenInput.value = setObj.telegram_bot_token || "";
        }
        const telegramAdminIdsInput = document.getElementById("setting-telegram-admin-ids");
        if (telegramAdminIdsInput) {
            telegramAdminIdsInput.value = setObj.telegram_admin_ids || "";
        }
        const telegram2faEnableInput = document.getElementById("setting-telegram-2fa-enable");
        if (telegram2faEnableInput) {
            telegram2faEnableInput.checked = setObj.telegram_2fa_enabled !== undefined ? setObj.telegram_2fa_enabled : false;
        }
        const telegramBotEnableInput = document.getElementById("setting-telegram-bot-enable");
        if (telegramBotEnableInput) {
            telegramBotEnableInput.checked = setObj.telegram_bot_enabled !== undefined ? setObj.telegram_bot_enabled : true;
        }
        
        const backupEnableInput = document.getElementById("setting-backup-enable");
        if (backupEnableInput) {
            backupEnableInput.checked = setObj.backup_enable !== undefined ? setObj.backup_enable : false;
        }
        const backupTelegramInput = document.getElementById("setting-backup-telegram");
        if (backupTelegramInput) {
            backupTelegramInput.checked = setObj.backup_telegram !== undefined ? setObj.backup_telegram : false;
        }
        const backupIntervalSelect = document.getElementById("setting-backup-interval");
        if (backupIntervalSelect) {
            backupIntervalSelect.value = setObj.backup_interval || "daily";
        }
        const backupRotationInput = document.getElementById("setting-backup-rotation");
        if (backupRotationInput) {
            backupRotationInput.value = setObj.backup_rotation !== undefined ? setObj.backup_rotation : 7;
        }
        
        const backupEncryptInput = document.getElementById("setting-backup-encrypt");
        if (backupEncryptInput) {
            backupEncryptInput.checked = setObj.backup_encrypt !== undefined ? setObj.backup_encrypt : false;
        }
        const currPwd = document.getElementById("setting-backup-current-password");
        if (currPwd) currPwd.value = "";
        const newPwd = document.getElementById("setting-backup-new-password");
        if (newPwd) newPwd.value = "";
        const confirmPwd = document.getElementById("setting-backup-confirm-password");
        if (confirmPwd) confirmPwd.value = "";
        const backupPasswordGroup = document.getElementById("setting-backup-password-group");
        if (backupPasswordGroup) {
            backupPasswordGroup.style.display = setObj.backup_encrypt ? "block" : "none";
        }
        
        updateDecoyUI(decoyType);
        await loadWarpStatus();
        await loadAuditLogs();
        await loadOptimizationStatus();
        await loadActiveSessions();
    }
}

export function updateDecoyUI(decoyType) {
    const valGroup = document.getElementById("setting-decoy-value-group");
    const valLabel = document.getElementById("setting-decoy-value-label");
    const valDesc = document.getElementById("setting-decoy-value-desc");
    
    if (!valGroup) return;
    
    if (decoyType === "none") {
        valGroup.style.display = "none";
    } else {
        valGroup.style.display = "block";
        if (decoyType === "proxy") {
            if (valLabel) valLabel.innerText = "Адрес внешнего сайта (URL)";
            if (valDesc) valDesc.innerText = "Укажите полный адрес сайта для проксирования, включая протокол (например: https://github.com).";
        } else if (decoyType === "redirect") {
            if (valLabel) valLabel.innerText = "Адрес перенаправления (URL)";
            if (valDesc) valDesc.innerText = "Укажите полный URL-адрес внешнего сайта, на который будут перенаправляться все публичные запросы (например: https://google.com).";
        } else {
            if (valLabel) valLabel.innerText = "Имя шаблона заглушки";
            if (valDesc) valDesc.innerText = "Название HTML-файла шаблона в папке frontend/decoy/ (по умолчанию: company_landing).";
        }
    }
}

export async function loadOptimizationStatus() {
    const badge = document.getElementById("optimization-status-badge");
    if (!badge) return;
    
    const res = await apiFetch("/api/system/optimization/status");
    if (res && res.success) {
        if (res.optimized) {
            badge.innerText = t("settings_sys_opt_active", "Оптимизировано (Тюнинг применен)");
            badge.className = "badge success-badge";
            badge.style.background = "rgba(46, 213, 115, 0.15)";
            badge.style.color = "#2ed573";
        } else {
            badge.innerText = t("settings_sys_opt_inactive", "Не оптимизировано (Стандартные настройки)");
            badge.className = "badge warning-badge";
            badge.style.background = "rgba(255, 165, 2, 0.15)";
            badge.style.color = "#ffa502";
        }
    } else {
        badge.innerText = "Error";
        badge.className = "badge danger-badge";
    }
}

export function setupSettingsListeners() {
    const enableBbrBtn = document.getElementById("enable-bbr-btn");
    if (enableBbrBtn) {
        enableBbrBtn.addEventListener("click", async () => {
            enableBbrBtn.disabled = true;
            enableBbrBtn.innerText = "Включение...";
            const res = await apiFetch("/api/system/bbr/enable", { method: "POST" });
            enableBbrBtn.disabled = false;
            enableBbrBtn.innerText = "Включить";
            if (res && res.success) {
                showToast(t("bbr_enabled", "BBR ускорение успешно включено на хост-системе!"));
                loadBbrStatus();
            } else {
                showToast(res ? res.msg : t("bbr_enable_error", "Не удалось включить BBR"), "error");
            }
        });
    }

    const decoyTypeSelect = document.getElementById("setting-decoy-type");
    if (decoyTypeSelect) {
        decoyTypeSelect.addEventListener("change", (e) => {
            updateDecoyUI(e.target.value);
        });
    }

    const telegram2faEnableInput = document.getElementById("setting-telegram-2fa-enable");
    if (telegram2faEnableInput) {
        telegram2faEnableInput.addEventListener("change", async (e) => {
            const isChecked = e.target.checked;
            telegram2faEnableInput.disabled = true;
            
            if (isChecked) {
                const telegramTokenInput = document.getElementById("setting-telegram-token");
                const telegramAdminIdsInput = document.getElementById("setting-telegram-admin-ids");
                const hasToken = telegramTokenInput && telegramTokenInput.value.trim() && telegramTokenInput.value.trim() !== "••••••••";
                const hasAdminIds = telegramAdminIdsInput && telegramAdminIdsInput.value.trim();
                
                if (!hasToken || !hasAdminIds) {
                    showToast(t("telegram_2fa_config_warning", "Внимание: Убедитесь, что настроили токен бота и ID администраторов в блоке интеграции ниже!"), "info");
                }
            }

            const res = await apiFetch("/api/settings/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    telegram_2fa_enabled: isChecked
                })
            });
            telegram2faEnableInput.disabled = false;
            
            if (res && res.success) {
                showToast(t("settings_saved_toast", "Настройки успешно сохранены!"));
            } else {
                showToast(res ? res.msg : t("settings_save_error", "Не удалось сохранить настройки"), "error");
                e.target.checked = !isChecked;
            }
        });
    }

    // Card 1: Access Credentials Save
    const btnSaveAccess = document.getElementById("btn-save-access");
    if (btnSaveAccess) {
        btnSaveAccess.addEventListener("click", async () => {
            const secretPath = document.getElementById("setting-secret-path-input").value.trim();
            const sessionTimeoutInput = document.getElementById("setting-session-timeout");
            const sessionTimeout = sessionTimeoutInput ? parseInt(sessionTimeoutInput.value) : 7;
            const loginMaxAttemptsInput = document.getElementById("setting-login-max-attempts");
            const loginMaxAttempts = loginMaxAttemptsInput ? parseInt(loginMaxAttemptsInput.value) : 5;
            const loginAttemptsPeriodInput = document.getElementById("setting-login-attempts-period");
            const loginAttemptsPeriod = loginAttemptsPeriodInput ? parseInt(loginAttemptsPeriodInput.value) : 60;
            const loginFailDelayInput = document.getElementById("setting-login-fail-delay");
            const loginFailDelay = loginFailDelayInput ? parseFloat(loginFailDelayInput.value) : 1.0;

            if (!secretPath) {
                showToast(t("secret_path_empty", "Секретный путь не может быть пустым"), "error");
                return;
            }
            if (isNaN(sessionTimeout) || sessionTimeout <= 0) {
                showToast(t("settings_session_timeout_invalid", "Срок действия сессии должен быть целым положительным числом"), "error");
                return;
            }
            if (isNaN(loginMaxAttempts) || loginMaxAttempts <= 0) {
                showToast(t("settings_login_max_attempts_invalid", "Максимум попыток входа должен быть целым положительным числом"), "error");
                return;
            }
            if (isNaN(loginAttemptsPeriod) || loginAttemptsPeriod <= 0) {
                showToast(t("settings_login_attempts_period_invalid", "Период блокировки должен быть целым положительным числом секунд"), "error");
                return;
            }
            if (isNaN(loginFailDelay) || loginFailDelay < 0) {
                showToast(t("settings_login_fail_delay_invalid", "Задержка после неверного ввода должна быть неотрицательным числом секунд"), "error");
                return;
            }

            btnSaveAccess.disabled = true;
            const res = await apiFetch("/api/settings/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    secret_path: secretPath,
                    session_timeout_days: sessionTimeout,
                    login_max_attempts: loginMaxAttempts,
                    login_attempts_period: loginAttemptsPeriod,
                    login_fail_delay: loginFailDelay
                })
            });
            btnSaveAccess.disabled = false;

            if (res && res.success) {
                if (secretPath !== originalSecretPath) {
                    showToast(t("settings_saved_redirect", "Настройки сохранены! Перенаправление через 3 секунды..."), "info");
                    setTimeout(() => {
                        window.location.href = `/${secretPath}/`;
                    }, 3000);
                } else {
                    showToast(t("settings_saved_toast", "Настройки успешно сохранены!"));
                    loadSettings();
                }
            } else {
                showToast(res ? res.msg : t("settings_save_error", "Не удалось сохранить настройки"), "error");
            }
        });
    }

    // Card 2: Telegram Settings Save
    const btnSaveTelegram = document.getElementById("btn-save-telegram");
    if (btnSaveTelegram) {
        btnSaveTelegram.addEventListener("click", async () => {
            const telegramTokenInput = document.getElementById("setting-telegram-token");
            const telegramToken = telegramTokenInput ? telegramTokenInput.value.trim() : "";
            const telegramAdminIdsInput = document.getElementById("setting-telegram-admin-ids");
            const telegramAdminIds = telegramAdminIdsInput ? telegramAdminIdsInput.value.trim() : "";
            const telegram2faEnableInput = document.getElementById("setting-telegram-2fa-enable");
            const telegram2faEnable = telegram2faEnableInput ? telegram2faEnableInput.checked : false;
            const telegramBotEnableInput = document.getElementById("setting-telegram-bot-enable");
            const telegramBotEnable = telegramBotEnableInput ? telegramBotEnableInput.checked : true;

            btnSaveTelegram.disabled = true;
            const res = await apiFetch("/api/settings/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    telegram_bot_token: telegramToken,
                    telegram_admin_ids: telegramAdminIds,
                    telegram_2fa_enabled: telegram2faEnable,
                    telegram_bot_enabled: telegramBotEnable
                })
            });
            btnSaveTelegram.disabled = false;

            if (res && res.success) {
                showToast(t("settings_saved_toast", "Настройки успешно сохранены!"));
                loadSettings();
            } else {
                showToast(res ? res.msg : t("settings_save_error", "Не удалось сохранить настройки"), "error");
            }
        });
    }

    // Card 2: Telegram Bot Restart
    const btnRestartTelegramBot = document.getElementById("btn-restart-telegram-bot");
    if (btnRestartTelegramBot) {
        btnRestartTelegramBot.addEventListener("click", async () => {
            btnRestartTelegramBot.disabled = true;
            const originalText = btnRestartTelegramBot.innerHTML;
            btnRestartTelegramBot.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${t("loading", "Ожидание...")}`;
            
            const res = await apiFetch("/api/system/telegram/restart", { method: "POST" });
            btnRestartTelegramBot.disabled = false;
            btnRestartTelegramBot.innerHTML = originalText;
            
            if (res && res.success) {
                showToast(res.msg || "Telegram-бот успешно перезапущен!");
            } else {
                showToast(res ? res.msg : "Не удалось перезапустить бота", "error");
            }
        });
    }

    // Card 3: Decoy Site Save
    const btnSaveDecoy = document.getElementById("btn-save-decoy");
    if (btnSaveDecoy) {
        btnSaveDecoy.addEventListener("click", async () => {
            const decoyType = document.getElementById("setting-decoy-type").value;
            const decoyValue = document.getElementById("setting-decoy-value").value.trim();

            btnSaveDecoy.disabled = true;
            const res = await apiFetch("/api/settings/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    decoy_type: decoyType,
                    decoy_value: decoyValue
                })
            });
            btnSaveDecoy.disabled = false;

            if (res && res.success) {
                showToast(t("settings_saved_toast", "Настройки успешно сохранены!"));
                loadSettings();
            } else {
                showToast(res ? res.msg : t("settings_save_error", "Не удалось сохранить настройки"), "error");
            }
        });
    }

    // Card 4: SSL Settings Save
    const btnSaveSsl = document.getElementById("btn-save-ssl");
    if (btnSaveSsl) {
        btnSaveSsl.addEventListener("click", async () => {
            const sslDomain = document.getElementById("setting-ssl-domain").value.trim();
            const sslEmail = document.getElementById("setting-ssl-email").value.trim();

            btnSaveSsl.disabled = true;
            const res = await apiFetch("/api/settings/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ssl_domain: sslDomain,
                    ssl_email: sslEmail
                })
            });
            btnSaveSsl.disabled = false;

            if (res && res.success) {
                showToast(t("settings_saved_toast", "Настройки успешно сохранены!"));
                loadSettings();
            } else {
                showToast(res ? res.msg : t("settings_save_error", "Не удалось сохранить настройки"), "error");
            }
        });
    }

    const btnApplyOptimizations = document.getElementById("btn-apply-optimizations");
    if (btnApplyOptimizations) {
        btnApplyOptimizations.addEventListener("click", async () => {
            btnApplyOptimizations.disabled = true;
            const originalText = btnApplyOptimizations.innerHTML;
            btnApplyOptimizations.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${t("settings_sys_opt_applying", "Применение...")}`;
            
            const res = await apiFetch("/api/system/optimization/apply", { method: "POST" });
            btnApplyOptimizations.disabled = false;
            btnApplyOptimizations.innerHTML = originalText;
            
            if (res && res.success) {
                showToast(t("settings_sys_opt_success", "Системные оптимизации сети успешно применены!"));
                loadOptimizationStatus();
            } else {
                showToast(res ? res.msg : t("settings_sys_opt_error", "Не удалось применить оптимизации"), "error");
            }
        });
    }

    // Card 6: Backups Settings Save
    const btnSaveBackups = document.getElementById("btn-save-backups");
    if (btnSaveBackups) {
        btnSaveBackups.addEventListener("click", async () => {
            const enable = document.getElementById("setting-backup-enable").checked;
            const telegram = document.getElementById("setting-backup-telegram").checked;
            const interval = document.getElementById("setting-backup-interval").value;
            const rotationInput = document.getElementById("setting-backup-rotation");
            const rotation = rotationInput ? parseInt(rotationInput.value) : 7;
            const encrypt = document.getElementById("setting-backup-encrypt").checked;

            if (isNaN(rotation) || rotation <= 0) {
                showToast("Количество бэкапов для ротации должно быть целым положительным числом", "error");
                return;
            }

            btnSaveBackups.disabled = true;
            const res = await apiFetch("/api/settings/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    backup_enable: enable,
                    backup_telegram: telegram,
                    backup_interval: interval,
                    backup_rotation: rotation,
                    backup_encrypt: encrypt
                })
            });
            btnSaveBackups.disabled = false;

            if (res && res.success) {
                showToast(t("settings_saved_toast", "Настройки успешно сохранены!"));
                const checkInput = document.getElementById("setting-backup-password-check");
                if (checkInput) checkInput.value = "";
                loadSettings();
            } else {
                showToast(res ? res.msg : t("settings_save_error", "Не удалось сохранить настройки"), "error");
            }
        });
    }

    // Card 6: Backups Download
    const btnDownloadBackup = document.getElementById("btn-download-backup");
    if (btnDownloadBackup) {
        btnDownloadBackup.addEventListener("click", () => {
            window.location.href = "/api/system/backup/download";
        });
    }

    // Card 6: Clear all backups
    const btnClearBackups = document.getElementById("btn-clear-backups");
    if (btnClearBackups) {
        btnClearBackups.addEventListener("click", async () => {
            if (!confirm(t("confirm_clear_backups", "Вы уверены, что хотите безвозвратно удалить все локальные резервные копии с сервера?"))) {
                return;
            }
            
            btnClearBackups.disabled = true;
            try {
                const res = await apiFetch("/api/system/backup/clear", { method: "POST" });
                if (res && res.success) {
                    showToast(res.msg || "Локальные бэкапы успешно удалены!");
                } else {
                    showToast(res ? res.msg : "Не удалось удалить локальные бэкапы", "error");
                }
            } catch (err) {
                showToast("Ошибка при удалении бэкапов: " + err, "error");
            } finally {
                btnClearBackups.disabled = false;
            }
        });
    }


    // Card 6: Backups Upload Triggers
    const btnTriggerUpload = document.getElementById("btn-trigger-upload-backup");
    const fileInput = document.getElementById("backup-file-input");
    if (btnTriggerUpload && fileInput) {
        btnTriggerUpload.addEventListener("click", () => {
            fileInput.click();
        });

        fileInput.addEventListener("change", async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!confirm("Вы уверены, что хотите восстановить базу данных? Это сотрет все текущие подключения и пользователей и перезапишет их данными из файла бэкапа!")) {
                fileInput.value = "";
                return;
            }

            const formData = new FormData();
            formData.append("file", file);

            btnTriggerUpload.disabled = true;
            const originalText = btnTriggerUpload.innerHTML;
            btnTriggerUpload.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Восстановление...`;

            try {
                let res = await apiFetch("/api/system/backup/upload", {
                    method: "POST",
                    body: formData
                });
                
                while (res && !res.success && (res.code === "password_required" || res.code === "invalid_password")) {
                    const promptMsg = res.code === "password_required"
                        ? t("settings_backup_pwd_prompt", "Файл бэкапа зашифрован. Введите пароль для расшифровки:")
                        : t("settings_backup_pwd_invalid_prompt", "Неверный пароль. Пожалуйста, введите корректный пароль для расшифровки:");
                    
                    const password = prompt(promptMsg);
                    if (password === null) {
                        break;
                    }
                    
                    formData.set("password", password);
                    res = await apiFetch("/api/system/backup/upload", {
                        method: "POST",
                        body: formData
                    });
                }
                
                if (res && res.success) {
                    showToast(res.msg || "База данных успешно восстановлена!");
                    setTimeout(() => {
                        window.location.reload();
                    }, 2000);
                } else {
                    showToast(res ? res.msg : "Не удалось восстановить бэкап", "error");
                }
            } catch (err) {
                showToast("Ошибка при загрузке бэкапа: " + err, "error");
            } finally {
                btnTriggerUpload.disabled = false;
                btnTriggerUpload.innerHTML = originalText;
                fileInput.value = "";
            }
        });
    }

    // Bind sub-modules listeners
    setupWarpListeners();
    setupAuditLogsListeners();

    // Смена логина и пароля
    const btnSaveCredentials = document.getElementById("btn-save-credentials");
    if (btnSaveCredentials) {
        btnSaveCredentials.addEventListener("click", async () => {
            const currentPassword = document.getElementById("setting-cred-current-pwd").value;
            const newUsername = document.getElementById("setting-cred-new-user").value.trim();
            const newPassword = document.getElementById("setting-cred-new-pwd").value;
            const confirmPassword = document.getElementById("setting-cred-confirm-pwd").value;

            if (!currentPassword) {
                showToast(t("settings_current_password_required", "Введите текущий пароль"), "error");
                return;
            }
            if (!newUsername) {
                showToast(t("settings_new_username_required", "Введите новый логин"), "error");
                return;
            }
            if (newPassword && newPassword !== confirmPassword) {
                showToast(t("settings_passwords_mismatch", "Новые пароли не совпадают"), "error");
                return;
            }

            btnSaveCredentials.disabled = true;
            const res = await apiFetch("/api/settings/credentials", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    current_password: currentPassword,
                    new_username: newUsername,
                    new_password: newPassword || null
                })
            });
            btnSaveCredentials.disabled = false;

            if (res && res.success) {
                showToast(res.msg || t("settings_saved_toast", "Настройки успешно сохранены!"));
                document.getElementById("setting-cred-current-pwd").value = "";
                document.getElementById("setting-cred-new-pwd").value = "";
                document.getElementById("setting-cred-confirm-pwd").value = "";
                
                setTimeout(async () => {
                    await apiFetch("/api/logout", { method: "POST" });
                    window.location.reload();
                }, 2000);
            } else {
                showToast(res ? res.msg : t("settings_save_error", "Не удалось сохранить настройки"), "error");
            }
        });
    }

    // 2FA Setup Panel Trigger
    const btn2faSetupTrigger = document.getElementById("btn-2fa-setup-trigger");
    if (btn2faSetupTrigger) {
        btn2faSetupTrigger.addEventListener("click", async () => {
            const setupPanel = document.getElementById("2fa-setup-panel");
            const disablePanel = document.getElementById("2fa-disable-panel");
            if (!setupPanel) return;

            setupPanel.style.display = "flex";
            if (disablePanel) disablePanel.style.display = "none";

            const res = await apiFetch("/api/settings/2fa/setup");
            if (res && res.success) {
                document.getElementById("setting-2fa-secret").value = res.secret;
                const qrContainer = document.getElementById("2fa-qrcode");
                if (qrContainer) {
                    qrContainer.innerHTML = "";
                    new QRCode(qrContainer, {
                        text: res.qr_uri,
                        width: 160,
                        height: 160,
                        correctLevel: QRCode.CorrectLevel.M
                    });
                }
            } else {
                showToast(res ? res.msg : "Не удалось настроить 2FA", "error");
                setupPanel.style.display = "none";
            }
        });
    }

    // 2FA Enable Confirmation
    const btn2faConfirm = document.getElementById("btn-2fa-confirm");
    if (btn2faConfirm) {
        btn2faConfirm.addEventListener("click", async () => {
            const codeInput = document.getElementById("setting-2fa-code-input");
            const code = codeInput ? codeInput.value.trim() : "";

            if (!code || code.length !== 6 || isNaN(code)) {
                showToast("Введите корректный 6-значный код", "error");
                return;
            }

            btn2faConfirm.disabled = true;
            const res = await apiFetch("/api/settings/2fa/enable", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code })
            });
            btn2faConfirm.disabled = false;

            if (res && res.success) {
                showToast(res.msg || "2FA успешно включена!");
                if (codeInput) codeInput.value = "";
                await loadSettings();
            } else {
                showToast(res ? res.msg : "Ошибка при включении 2FA", "error");
            }
        });
    }

    // 2FA Disable Trigger
    const btn2faDisableTrigger = document.getElementById("btn-2fa-disable-trigger");
    if (btn2faDisableTrigger) {
        btn2faDisableTrigger.addEventListener("click", () => {
            const setupPanel = document.getElementById("2fa-setup-panel");
            const disablePanel = document.getElementById("2fa-disable-panel");
            if (disablePanel) {
                disablePanel.style.display = "flex";
            }
            if (setupPanel) setupPanel.style.display = "none";
        });
    }

    // 2FA Disable Confirmation
    const btn2faDisableConfirm = document.getElementById("btn-2fa-disable-confirm");
    if (btn2faDisableConfirm) {
        btn2faDisableConfirm.addEventListener("click", async () => {
            const codeInput = document.getElementById("setting-2fa-disable-code-input");
            const code = codeInput ? codeInput.value.trim() : "";

            if (!code || code.length !== 6 || isNaN(code)) {
                showToast("Введите корректный 6-значный код", "error");
                return;
            }

            btn2faDisableConfirm.disabled = true;
            const res = await apiFetch("/api/settings/2fa/disable", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code })
            });
            btn2faDisableConfirm.disabled = false;

            if (res && res.success) {
                showToast(res.msg || "2FA успешно отключена!");
                if (codeInput) codeInput.value = "";
                await loadSettings();
            } else {
                showToast(res ? res.msg : "Ошибка при отключении 2FA", "error");
            }
        });
    }

    // Backup Encryption inputs visibility toggle
    const backupEncryptInput = document.getElementById("setting-backup-encrypt");
    if (backupEncryptInput) {
        backupEncryptInput.addEventListener("change", (e) => {
            const backupPasswordGroup = document.getElementById("setting-backup-password-group");
            if (backupPasswordGroup) {
                backupPasswordGroup.style.display = e.target.checked ? "block" : "none";
            }
        });
    }

    // Change Backup Password
    const btnChangeBackupPassword = document.getElementById("btn-change-backup-password");
    if (btnChangeBackupPassword) {
        btnChangeBackupPassword.addEventListener("click", async () => {
            const currentPassword = document.getElementById("setting-backup-current-password").value;
            const newPassword = document.getElementById("setting-backup-new-password").value;
            const confirmPassword = document.getElementById("setting-backup-confirm-password").value;

            if (!currentPassword) {
                showToast(t("settings_backup_current_password_required", "Для смены пароля введите текущий пароль!"), "error");
                return;
            }
            if (!newPassword || !confirmPassword) {
                showToast(t("settings_backup_fields_required", "Заполните все поля для смены пароля!"), "error");
                return;
            }
            if (newPassword !== confirmPassword) {
                showToast(t("settings_backup_passwords_mismatch", "Новые пароли не совпадают!"), "error");
                return;
            }

            btnChangeBackupPassword.disabled = true;
            try {
                const res = await apiFetch("/api/settings/backup/password", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        current_password: currentPassword,
                        new_password: newPassword
                    })
                });

                if (res && res.success) {
                    showToast(res.msg || t("settings_backup_pwd_changed", "Пароль шифрования бэкапов успешно изменен!"));
                    document.getElementById("setting-backup-current-password").value = "";
                    document.getElementById("setting-backup-new-password").value = "";
                    document.getElementById("setting-backup-confirm-password").value = "";
                } else {
                    showToast(res ? res.msg : "Не удалось изменить пароль", "error");
                }
            } catch (err) {
                showToast("Ошибка при смене пароля: " + err, "error");
            } finally {
                btnChangeBackupPassword.disabled = false;
            }
        });
    }

    // Telegram Bot Token visibility toggle & dynamic fetching
    const btnToggleTelegramToken = document.getElementById("btn-toggle-telegram-token");
    if (btnToggleTelegramToken) {
        btnToggleTelegramToken.addEventListener("click", async () => {
            const tokenInput = document.getElementById("setting-telegram-token");
            if (!tokenInput) return;
            
            const isPassword = tokenInput.type === "password";
            if (isPassword) {
                if (tokenInput.value === "••••••••") {
                    btnToggleTelegramToken.disabled = true;
                    try {
                        const res = await apiFetch("/api/settings/telegram/token");
                        if (res && res.success) {
                            tokenInput.value = res.token || "";
                        }
                    } catch (err) {
                        showToast("Ошибка получения токена: " + err, "error");
                    } finally {
                        btnToggleTelegramToken.disabled = false;
                    }
                }
                tokenInput.type = "text";
                btnToggleTelegramToken.innerHTML = '<i class="fa-regular fa-eye-slash"></i>';
            } else {
                tokenInput.type = "password";
                btnToggleTelegramToken.innerHTML = '<i class="fa-regular fa-eye"></i>';
            }
        });
    }

    // Инициализация переключения суб-вкладок настроек
    const navItems = document.querySelectorAll(".settings-nav-item");
    const sections = document.querySelectorAll(".settings-section-panel");
    navItems.forEach(item => {
        item.addEventListener("click", () => {
            const targetSection = item.getAttribute("data-settings-section");
            navItems.forEach(ni => ni.classList.remove("active"));
            sections.forEach(sec => sec.classList.remove("active"));
            item.classList.add("active");
            const targetEl = document.getElementById(`sec-${targetSection}`);
            if (targetEl) targetEl.classList.add("active");
        });
    });
}

export async function loadActiveSessions() {
    const tbody = document.getElementById("active-sessions-tbody");
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Загрузка сессий...</td></tr>';
    
    const res = await apiFetch("/api/security/sessions");
    if (res && res.success) {
        if (!res.sessions || res.sessions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Активных сессий не найдено</td></tr>';
            return;
        }
        
        tbody.innerHTML = "";
        res.sessions.forEach(s => {
            const tr = document.createElement("tr");
            
            const created = new Date(s.created_at * 1000).toLocaleString();
            const expires = new Date(s.expires_at * 1000).toLocaleString();
            
            let deviceText = s.user_agent;
            // Simple parsing to make User Agent user-friendly
            if (s.user_agent.includes("Windows")) {
                deviceText = "Windows / ";
            } else if (s.user_agent.includes("Macintosh")) {
                deviceText = "macOS / ";
            } else if (s.user_agent.includes("Linux")) {
                deviceText = "Linux / ";
            } else if (s.user_agent.includes("iPhone")) {
                deviceText = "iPhone / ";
            } else if (s.user_agent.includes("Android")) {
                deviceText = "Android / ";
            } else {
                deviceText = "";
            }
            
            if (s.user_agent.includes("Chrome")) {
                deviceText += "Chrome";
            } else if (s.user_agent.includes("Firefox")) {
                deviceText += "Firefox";
            } else if (s.user_agent.includes("Safari")) {
                deviceText += "Safari";
            } else if (s.user_agent.includes("Edge")) {
                deviceText += "Edge";
            } else if (s.user_agent.includes("Opera")) {
                deviceText += "Opera";
            } else {
                deviceText += s.user_agent.split(" ")[0] || "Unknown Client";
            }
            
            // Highlight current device
            const currentBadge = s.is_current ? ' <span class="badge success-badge" style="font-size: 10px; background: rgba(46, 213, 115, 0.15); color: #2ed573; padding: 2px 6px; margin-left: 6px;">Это устройство</span>' : '';
            
            // Terminate button
            const actionHtml = s.is_current 
                ? '<span style="color: var(--text-secondary); font-size: 13px;">Текущая сессия</span>' 
                : `<button class="btn danger-btn btn-terminate-session" data-id="${s.session_id}" style="padding: 4px 8px; font-size: 12px; height: auto;"><i class="fa-solid fa-right-from-bracket"></i> Завершить</button>`;
            
            tr.innerHTML = `
                <td style="white-space: nowrap;"><strong>${s.ip_address}</strong>${currentBadge}</td>
                <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${s.user_agent}">${deviceText}</td>
                <td style="white-space: nowrap;">${created}</td>
                <td style="white-space: nowrap;">${expires}</td>
                <td style="text-align: right; white-space: nowrap;">${actionHtml}</td>
            `;
            tbody.appendChild(tr);
        });
        
        // Add click listener for terminate buttons
        document.querySelectorAll(".btn-terminate-session").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const sid = e.currentTarget.getAttribute("data-id");
                if (!confirm("Вы уверены, что хотите принудительно завершить эту сессию?")) return;
                
                const deleteRes = await apiFetch("/api/security/sessions/terminate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ session_id: sid })
                });
                
                if (deleteRes && deleteRes.success) {
                    showToast("Сессия успешно завершена!");
                    loadActiveSessions();
                } else {
                    showToast(deleteRes ? deleteRes.msg : "Не удалось завершить сессию", "error");
                }
            });
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--danger-color);">Не удалось загрузить активные сессии</td></tr>';
    }
}
