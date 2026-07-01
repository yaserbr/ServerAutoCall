const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'index.html');
console.log('Reading:', filePath);
let content = fs.readFileSync(filePath, 'utf8');

// Normalize line endings to avoid CRLF / LF mismatches in regex/replace
const originalContent = content;

const replacements = [
    {
        name: "CSS Selector 1",
        old: `        #deviceActionOverlay,
        #contactSaveOverlay {
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.22s ease;
        }

        #deviceActionOverlay.is-visible,
        #contactSaveOverlay.is-visible {
            opacity: 1;
            pointer-events: auto;
        }

        #deviceActionOverlay .instructions-modal,
        #contactSaveOverlay .instructions-modal {
            position: relative;
            opacity: 0;
            transform: translateY(10px) scale(0.985);
            border-radius: 20px;
            border: 1px solid var(--glass-border);
            border-bottom: 1px solid rgba(255, 255, 255, 0.22);
            background: var(--glass);
            box-shadow: var(--glass-shadow);
            backdrop-filter: var(--glass-blur);
            -webkit-backdrop-filter: var(--glass-blur);
            transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
        }

        #deviceActionOverlay.is-visible .instructions-modal,
        #contactSaveOverlay.is-visible .instructions-modal {
            opacity: 1;
            transform: translateY(0) scale(1);
        }`,
        new: `        #deviceActionOverlay,
        #contactSaveOverlay,
        #contactDeleteOverlay {
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.22s ease;
        }

        #deviceActionOverlay.is-visible,
        #contactSaveOverlay.is-visible,
        #contactDeleteOverlay.is-visible {
            opacity: 1;
            pointer-events: auto;
        }

        #deviceActionOverlay .instructions-modal,
        #contactSaveOverlay .instructions-modal,
        #contactDeleteOverlay .instructions-modal {
            position: relative;
            opacity: 0;
            transform: translateY(10px) scale(0.985);
            border-radius: 20px;
            border: 1px solid var(--glass-border);
            border-bottom: 1px solid rgba(255, 255, 255, 0.22);
            background: var(--glass);
            box-shadow: var(--glass-shadow);
            backdrop-filter: var(--glass-blur);
            -webkit-backdrop-filter: var(--glass-blur);
            transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
        }

        #deviceActionOverlay.is-visible .instructions-modal,
        #contactSaveOverlay.is-visible .instructions-modal,
        #contactDeleteOverlay.is-visible .instructions-modal {
            opacity: 1;
            transform: translateY(0) scale(1);
        }`
    },
    {
        name: "CSS Selector 2",
        old: `        #deviceActionOverlay .instructions-modal::before,
        #contactSaveOverlay .instructions-modal::before {
            content: none;
        }`,
        new: `        #deviceActionOverlay .instructions-modal::before,
        #contactSaveOverlay .instructions-modal::before,
        #contactDeleteOverlay .instructions-modal::before {
            content: none;
        }`
    },
    {
        name: "HTML Definition Placement",
        old: `        <div
            id="contactSaveOverlay"
            class="instructions-overlay panel-hidden"
            onclick="handleContactSaveOverlayClick(event)">
            <div class="instructions-modal device-action-modal" role="dialog" aria-modal="true" aria-labelledby="contactSaveTitle">
                <div class="instructions-header">
                    <h3 id="contactSaveTitle" class="instructions-title">Save Contact</h3>
                    <button
                        type="button"
                        class="instructions-close"
                        aria-label="Close contact save dialog"
                        onclick="cancelContactSaveDialog()">
                        X
                    </button>
                </div>
                <div class="device-action-body">
                    <p id="contactSaveMessage" class="device-action-message"></p>
                    <div id="contactSaveInputWrap" class="device-action-input-wrap">
                        <label class="field-label" for="contactSaveNameInput">Contact Name</label>
                        <input id="contactSaveNameInput" type="text" maxlength="60" placeholder="Enter contact name" />
                    </div>
                    <div class="device-action-actions">
                        <button type="button" class="subtle-button" onclick="cancelContactSaveDialog()">Cancel</button>
                        <button id="contactSaveConfirmBtn" type="button" onclick="confirmContactSaveDialog()">Save</button>
                    </div>
                </div>
            </div>
        </div>`,
        new: `        <div
            id="contactSaveOverlay"
            class="instructions-overlay panel-hidden"
            onclick="handleContactSaveOverlayClick(event)">
            <div class="instructions-modal device-action-modal" role="dialog" aria-modal="true" aria-labelledby="contactSaveTitle">
                <div class="instructions-header">
                    <h3 id="contactSaveTitle" class="instructions-title">Save Contact</h3>
                    <button
                        type="button"
                        class="instructions-close"
                        aria-label="Close contact save dialog"
                        onclick="cancelContactSaveDialog()">
                        X
                    </button>
                </div>
                <div class="device-action-body">
                    <p id="contactSaveMessage" class="device-action-message"></p>
                    <div id="contactSaveInputWrap" class="device-action-input-wrap">
                        <label class="field-label" for="contactSaveNameInput">Contact Name</label>
                        <input id="contactSaveNameInput" type="text" maxlength="60" placeholder="Enter contact name" />
                    </div>
                    <div class="device-action-actions">
                        <button type="button" class="subtle-button" onclick="cancelContactSaveDialog()">Cancel</button>
                        <button id="contactSaveConfirmBtn" type="button" onclick="confirmContactSaveDialog()">Save</button>
                    </div>
                </div>
            </div>
        </div>

        <div
            id="contactDeleteOverlay"
            class="instructions-overlay panel-hidden"
            onclick="handleContactDeleteOverlayClick(event)">
            <div class="instructions-modal device-action-modal" role="dialog" aria-modal="true" aria-labelledby="contactDeleteTitle">
                <div class="instructions-header">
                    <h3 id="contactDeleteTitle" class="instructions-title">Delete Contact</h3>
                    <button
                        type="button"
                        class="instructions-close"
                        aria-label="Close contact delete dialog"
                        onclick="cancelContactDeleteDialog()">
                        X
                    </button>
                </div>
                <div class="device-action-body">
                    <p id="contactDeleteMessage" class="device-action-message"></p>
                    <div class="device-action-actions">
                        <button type="button" class="subtle-button" onclick="cancelContactDeleteDialog()">Cancel</button>
                        <button id="contactDeleteConfirmBtn" type="button" class="danger-button" onclick="confirmContactDeleteDialog()">Delete</button>
                    </div>
                </div>
            </div>
        </div>`
    },
    {
        name: "JS Constants & Dialog State",
        old: `        const CONTACT_SAVE_OVERLAY_ANIMATION_MS = 220;
        let contactSaveOverlayCloseTimerId = null;
        const contactSaveDialogState = {
            resolver: null
        };`,
        new: `        const CONTACT_SAVE_OVERLAY_ANIMATION_MS = 220;
        let contactSaveOverlayCloseTimerId = null;
        const contactSaveDialogState = {
            resolver: null
        };
        const CONTACT_DELETE_OVERLAY_ANIMATION_MS = 220;
        let contactDeleteOverlayCloseTimerId = null;
        const contactDeleteDialogState = {
            resolver: null
        };`
    },
    {
        name: "Scroll Lock Sync",
        old: `        function syncOverlayScrollLock() {
            const instructionsOverlay = document.getElementById("instructionsOverlay");
            const claimDeviceOverlay = document.getElementById("claimDeviceOverlay");
            const deviceActionOverlay = document.getElementById("deviceActionOverlay");
            const commandConfirmOverlay = document.getElementById("commandConfirmOverlay");
            const contactSaveOverlay = document.getElementById("contactSaveOverlay");
            const isInstructionsOpen = Boolean(instructionsOverlay && !instructionsOverlay.classList.contains("panel-hidden"));
            const isClaimDeviceOpen = Boolean(claimDeviceOverlay && !claimDeviceOverlay.classList.contains("panel-hidden"));
            const isDeviceActionOpen = Boolean(deviceActionOverlay && !deviceActionOverlay.classList.contains("panel-hidden"));
            const isCommandConfirmOpen = Boolean(commandConfirmOverlay && !commandConfirmOverlay.classList.contains("panel-hidden"));
            const isContactSaveOpen = Boolean(contactSaveOverlay && !contactSaveOverlay.classList.contains("panel-hidden"));
            document.body.style.overflow =
                isInstructionsOpen || isClaimDeviceOpen || isDeviceActionOpen || isCommandConfirmOpen || isContactSaveOpen
                    ? "hidden"
                    : "";
        }`,
        new: `        function syncOverlayScrollLock() {
            const instructionsOverlay = document.getElementById("instructionsOverlay");
            const claimDeviceOverlay = document.getElementById("claimDeviceOverlay");
            const deviceActionOverlay = document.getElementById("deviceActionOverlay");
            const commandConfirmOverlay = document.getElementById("commandConfirmOverlay");
            const contactSaveOverlay = document.getElementById("contactSaveOverlay");
            const contactDeleteOverlay = document.getElementById("contactDeleteOverlay");
            const isInstructionsOpen = Boolean(instructionsOverlay && !instructionsOverlay.classList.contains("panel-hidden"));
            const isClaimDeviceOpen = Boolean(claimDeviceOverlay && !claimDeviceOverlay.classList.contains("panel-hidden"));
            const isDeviceActionOpen = Boolean(deviceActionOverlay && !deviceActionOverlay.classList.contains("panel-hidden"));
            const isCommandConfirmOpen = Boolean(commandConfirmOverlay && !commandConfirmOverlay.classList.contains("panel-hidden"));
            const isContactSaveOpen = Boolean(contactSaveOverlay && !contactSaveOverlay.classList.contains("panel-hidden"));
            const isContactDeleteOpen = Boolean(contactDeleteOverlay && !contactDeleteOverlay.classList.contains("panel-hidden"));
            document.body.style.overflow =
                isInstructionsOpen || isClaimDeviceOpen || isDeviceActionOpen || isCommandConfirmOpen || isContactSaveOpen || isContactDeleteOpen
                    ? "hidden"
                    : "";
        }`
    },
    {
        name: "Escape Keydown Event Listener",
        old: `        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeInstructions();
                closeClaimDeviceModal();
                cancelDeviceActionDialog();
                cancelCommandConfirmDialog();
                cancelContactSaveDialog();
                closeAddressBookModal();
            }
        });`,
        new: `        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeInstructions();
                closeClaimDeviceModal();
                cancelDeviceActionDialog();
                cancelCommandConfirmDialog();
                cancelContactSaveDialog();
                cancelContactDeleteDialog();
                closeAddressBookModal();
            }
        });`
    },
    {
        name: "Contact Dialog JS Logic Functions Placement",
        old: `        function initializeContactSaveDialog() {
            const input = document.getElementById("contactSaveNameInput");
            if (!input) return;
            input.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                confirmContactSaveDialog();
            });
        }`,
        new: `        function initializeContactSaveDialog() {
            const input = document.getElementById("contactSaveNameInput");
            if (!input) return;
            input.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                confirmContactSaveDialog();
            });
        }

        function closeContactDeleteDialog(result = { confirmed: false }) {
            const overlay = document.getElementById("contactDeleteOverlay");

            if (contactDeleteOverlayCloseTimerId) {
                clearTimeout(contactDeleteOverlayCloseTimerId);
                contactDeleteOverlayCloseTimerId = null;
            }

            if (overlay && !overlay.classList.contains("panel-hidden")) {
                overlay.classList.remove("is-visible");
                contactDeleteOverlayCloseTimerId = setTimeout(() => {
                    overlay.classList.add("panel-hidden");
                    contactDeleteOverlayCloseTimerId = null;
                    syncOverlayScrollLock();
                }, CONTACT_DELETE_OVERLAY_ANIMATION_MS);
            }

            const resolver = contactDeleteDialogState.resolver;
            contactDeleteDialogState.resolver = null;
            if (typeof resolver === "function") {
                resolver(result);
            }
            syncOverlayScrollLock();
        }

        function cancelContactDeleteDialog() {
            closeContactDeleteDialog({ confirmed: false });
        }

        function handleContactDeleteOverlayClick(event) {
            const overlay = document.getElementById("contactDeleteOverlay");
            if (!overlay) return;
            if (event.target === overlay) {
                cancelContactDeleteDialog();
            }
        }

        async function openContactDeleteDialog(config = {}) {
            const overlay = document.getElementById("contactDeleteOverlay");
            const title = document.getElementById("contactDeleteTitle");
            const message = document.getElementById("contactDeleteMessage");
            const confirmBtn = document.getElementById("contactDeleteConfirmBtn");
            if (!overlay || !title || !message || !confirmBtn) {
                return { confirmed: false };
            }

            if (contactDeleteOverlayCloseTimerId) {
                clearTimeout(contactDeleteOverlayCloseTimerId);
                contactDeleteOverlayCloseTimerId = null;
            }

            if (typeof contactDeleteDialogState.resolver === "function") {
                contactDeleteDialogState.resolver({ confirmed: false });
            }

            const contactName = toNonEmptyString(config.contactName) || "Unknown contact";
            const safeName = escapeHtml(contactName);

            title.textContent = "Delete Contact";
            message.innerHTML = \`Are you sure you want to delete the contact <span class="device-action-target">\${safeName}</span>?\`;
            confirmBtn.textContent = "Delete";

            overlay.classList.remove("panel-hidden");

            requestAnimationFrame(() => {
                overlay.classList.add("is-visible");
                confirmBtn.focus();
            });

            syncOverlayScrollLock();

            return new Promise((resolve) => {
                contactDeleteDialogState.resolver = resolve;
            });
        }

        function confirmContactDeleteDialog() {
            closeContactDeleteDialog({
                confirmed: true
            });
        }`
    },
    {
        name: "renderContactsTable Button Onclick Event",
        old: `                            <button
                                type="button"
                                class="device-delete-btn contact-delete-btn"
                                onclick="deleteContactByUI('\${id}')">
                                Delete
                            </button>`,
        new: `                            <button
                                type="button"
                                class="device-delete-btn contact-delete-btn"
                                onclick="deleteContactByUI('\${id}', '\${name}')">
                                Delete
                            </button>`
    },
    {
        name: "deleteContactByUI function implementation",
        old: `        async function deleteContactByUI(contactId) {
            if (!confirm("Are you sure you want to delete this contact?")) {
                return;
            }

            try {
                const res = await apiFetch(\`/contacts/\${contactId}\`, {
                    method: "DELETE"
                });

                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || "Failed to delete contact");
                }

                showToast("Contact deleted successfully!", "success");

                await loadContacts();
                const contactsOverlay = document.getElementById("contactsOverlay");
                if (contactsOverlay && !contactsOverlay.classList.contains("panel-hidden")) {
                    await loadContactsList();
                }
            } catch (error) {
                showToast(error.message || "Failed to delete contact", "error");
            }
        }`,
        new: `        async function deleteContactByUI(contactId, contactName) {
            const dialogResult = await openContactDeleteDialog({ contactName });
            if (!dialogResult || !dialogResult.confirmed) {
                return;
            }

            try {
                const res = await apiFetch(\`/contacts/\${contactId}\`, {
                    method: "DELETE"
                });

                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || "Failed to delete contact");
                }

                showToast("Contact deleted successfully!", "success");

                await loadContacts();
                const contactsOverlay = document.getElementById("contactsOverlay");
                if (contactsOverlay && !contactsOverlay.classList.contains("panel-hidden")) {
                    await loadContactsList();
                }
            } catch (error) {
                showToast(error.message || "Failed to delete contact", "error");
            }
        }`
    }
];

// Helper to normalize line breaks for safe string comparison
function normalize(str) {
    return str.replace(/\r\n/g, '\n').trim();
}

let patchError = false;

// First pass: Validate that every single 'old' pattern exists exactly once
for (const rep of replacements) {
    const normContent = normalize(content);
    const normOld = normalize(rep.old);
    
    const index = normContent.indexOf(normOld);
    if (index === -1) {
        console.error(`ERROR: Could not find exact match for: "${rep.name}"`);
        patchError = true;
    } else {
        const nextIndex = normContent.indexOf(normOld, index + normOld.length);
        if (nextIndex !== -1) {
            console.error(`ERROR: Ambiguous match. Found multiple occurrences of: "${rep.name}"`);
            patchError = true;
        } else {
            console.log(`PASS: Exact match verified for "${rep.name}"`);
        }
    }
}

if (patchError) {
    console.error('Aborting patch application to prevent any partial or incorrect modifications.');
    process.exit(1);
}

// Second pass: Perform the replacements
console.log('All verification checks passed. Applying replacements...');

// Let's do a robust replacement: convert the file to \n line endings, apply replacements, and save.
let normalizedFile = originalContent.replace(/\r\n/g, '\n');
for (const rep of replacements) {
    const targetOld = rep.old.replace(/\r\n/g, '\n');
    const targetNew = rep.new.replace(/\r\n/g, '\n');
    const parts = normalizedFile.split(targetOld);
    if (parts.length !== 2) {
        console.error(`ERROR: Split verification failed during application for: "${rep.name}". Split count was ${parts.length}`);
        process.exit(1);
    }
    normalizedFile = parts.join(targetNew);
    console.log(`Applied: "${rep.name}"`);
}

// Write the patched content back
fs.writeFileSync(filePath, normalizedFile, 'utf8');
console.log('Successfully wrote patched file back to', filePath);
