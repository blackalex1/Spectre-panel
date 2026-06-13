import { apiFetch } from "../../api.js";
import { showToast } from "../../ui.js";
import { t } from "../../i18n.js";
import { loadSettings } from "./core.js";

export function setupBackupsListeners() {
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
}
