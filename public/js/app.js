        // --- Day/Night Mode Switch Logic ---
        document.addEventListener("DOMContentLoaded", () => {
            const themeToggleCheckbox = document.getElementById("themeToggleCheckbox");
            
            // Load and apply initial saved preference
            const savedTheme = localStorage.getItem("themePreference");
            if (savedTheme === "light") {
                document.body.classList.add("light-mode");
                if (themeToggleCheckbox) {
                    themeToggleCheckbox.checked = true;
                }
            }

            // Listen for user clicks to toggle themes
            if (themeToggleCheckbox) {
                themeToggleCheckbox.addEventListener("change", () => {
                    if (themeToggleCheckbox.checked) {
                        document.body.classList.add("light-mode");
                        localStorage.setItem("themePreference", "light");
                    } else {
                        document.body.classList.remove("light-mode");
                        localStorage.setItem("themePreference", "dark");
                    }
                });
            }
        });

        const SERVER =
            window.location.hostname === "localhost" ||
            window.location.hostname === "127.0.0.1" ||
            window.location.protocol === "file:"
                ? "http://localhost:4000"
                : window.location.origin;
        const AUTH_TOKEN_STORAGE_KEY = "autocall.accessToken";
        let activeTab = "call";
        let authToken = "";
        let authenticatedUser = null;
        let refreshDevicesIntervalId = null;
        let pairingQrRefreshInProgress = false;
        let pairingQrCountdownIntervalId = null;
        let pairingQrExpiresAtMs = 0;
        let pairingQrLibraryLoadPromise = null;
        let isQrDomReady =
            document.readyState === "interactive" || document.readyState === "complete";
        const PAIRING_QR_EXPECTED_TYPE = "AUTOCALL_PAIRING";
        const PAIRING_QR_DEFAULT_SECONDS = 5 * 60;
        const MANUAL_PAIRING_CODE_REGEX = /^\d{6}$/;
        const MANUAL_PAIRING_CODE_PLACEHOLDER = "------";
        const PAIRING_QR_LIBRARY_CDN_URL = "https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js";
        const COMMANDS_AUTO_REFRESH_INTERVAL_MS = 2000;
        let screenMirrorSocket = null;
        let commandDashboardJoinedDeviceUids = new Set();
        let commandsCache = [];
        let commandsAutoRefreshIntervalId = null;
        let commandsAutoRefreshInFlight = false;
        let screenMirrorJoinedDeviceUid = "";
        const activeScreenMirrorDeviceUids = new Set();
        const screenMirrorDeviceStateByUid = new Map();
        let isScreenMirrorPinned = false;
        let isScreenMirrorFloatingHidden = true;
        let isScreenMirrorFloatingMinimized = false;
        let isScreenMirrorRunning = false;
        let isScreenTouchControlEnabled = false;
        let screenMirrorFrameWidth = 0;
        let screenMirrorFrameHeight = 0;
        const INSTRUCTIONS_OVERLAY_ANIMATION_MS = 220;
        let instructionsOverlayCloseTimerId = null;
        const DEVICE_ACTION_OVERLAY_ANIMATION_MS = 220;
        let deviceActionOverlayCloseTimerId = null;
        const COMMAND_CONFIRM_OVERLAY_ANIMATION_MS = 220;
        let commandConfirmOverlayCloseTimerId = null;
        const deviceActionDialogState = {
            mode: "",
            resolver: null
        };
        const commandConfirmDialogState = {
            resolver: null
        };
        const CONTACT_SAVE_OVERLAY_ANIMATION_MS = 220;
        let contactSaveOverlayCloseTimerId = null;
        const contactSaveDialogState = {
            resolver: null
        };
        let screenMirrorCardCloseTimerId = null;
        const SCREEN_MIRROR_FLOAT_ANIMATION_MS = 220;
        let screenMirrorFloatingCloseTimerId = null;
        const SCREEN_MIRROR_FLOATING_MIN_WIDTH = 280;
        const SCREEN_MIRROR_FLOATING_MIN_HEIGHT = 320;
        const SCREEN_MIRROR_TILE_WIDTH_MIN = 140;
        const SCREEN_MIRROR_TILE_WIDTH_MAX = 760;
        const SCREEN_MIRROR_TILE_WIDTH_DEFAULT = 210;
        const SCREEN_MIRROR_TILE_DEFAULT_ASPECT_RATIO = "9 / 16.8";
        const SCREEN_MIRROR_PINNED_ANIMATION_MS = 220;
        const SCREEN_MIRROR_WEBRTC_ICE_SERVERS = [];
        const SCREEN_MIRROR_WEBRTC_OFFER_RETRY_MS = 7000;
        const SCREEN_MIRROR_FIRST_FRAME_TIMEOUT_MS = 2600;
        const SCREEN_MIRROR_FIRST_FRAME_RETRY_MAX = 4;
        const SCREEN_MIRROR_FIRST_FRAME_RETRY_DELAY_MS = 450;
        const SCREEN_MIRROR_LAST_FRAME_CAPTURE_MS = 450;
        const SCREEN_MIRROR_LAST_FRAME_SAMPLE_SIZE = 8;
        const SCREEN_TOUCH_TAP_DISTANCE_THRESHOLD_PX = 12;
        const SCREEN_TOUCH_MIN_SWIPE_DURATION_MS = 80;
        const SCREEN_TOUCH_MAX_SWIPE_DURATION_MS = 5000;
        const screenMirrorLastFrameFallbacks = new WeakMap();
        const screenMirrorLastFrameCacheByDeviceUid = new Map();
        let pinnedScreenMirrorDeviceUid = "";
        let screenMirrorPinnedCloseTimerId = null;
        let pinnedScreenMirrorPopupWindow = null;
        let pinnedScreenMirrorPopupMonitorId = null;
        let isClosingPinnedScreenMirrorPopup = false;
        const screenMirrorFloatingDragState = {
            active: false,
            pointerId: null,
            offsetX: 0,
            offsetY: 0
        };
        const screenMirrorFloatingResizeState = {
            active: false,
            pointerId: null,
            startX: 0,
            startY: 0,
            startWidth: 0,
            startHeight: 0
        };
        const screenMirrorPointerGestureState = {
            active: false,
            pointerId: null,
            startClientX: 0,
            startClientY: 0,
            startedAtMs: 0,
            startMappedPoint: null
        };
        const screenMirrorMultiPointerGestureById = new Map();
        const screenMirrorTileResizeState = {
            active: false,
            pointerId: null,
            deviceUid: "",
            startClientX: 0,
            startClientY: 0,
            startWidth: SCREEN_MIRROR_TILE_WIDTH_DEFAULT,
            handle: null,
            tile: null
        };
        const screenMirrorPinnedResizeState = {
            active: false,
            pointerId: null,
            deviceUid: "",
            startClientX: 0,
            startClientY: 0,
            startWidth: SCREEN_MIRROR_TILE_WIDTH_DEFAULT,
            handle: null
        };
        const screenMirrorPinnedPopupGestureState = {
            active: false,
            pointerId: null,
            previewWrap: null,
            startClientX: 0,
            startClientY: 0,
            startedAtMs: 0,
            startMappedPoint: null
        };
        const panelVisibility = {
            commands: false,
            contacts: false
        };
        const prioritizeActiveStatuses = true;
        const statusPriority = {
            executing: 0,
            pending: 1,
            executed: 2,
            failed: 3,
            cancelled: 4
        };
        const commandActionToType = {
            call: "CALL",
            sms: "SMS",
            open_app: "OPEN_APP",
            open_url: "OPEN_URL",
            download_data: "DOWNLOAD_DATA",
            activate_esim: "ACTIVATE_ESIM",
            delete_esim: "DELETE_ESIM",
            auto_answer: "AUTO_ANSWER",
            return_to_autocall: "RETURN_TO_AUTOCALL",
            close_webview: "CLOSE_WEBVIEW",
            end: "END",
            start_screen_mirror: "START_SCREEN_MIRROR",
            stop_screen_mirror: "STOP_SCREEN_MIRROR",
            screen_touch: "SCREEN_TOUCH",
            screen_swipe: "SCREEN_SWIPE"
        };
        const supportedCommandTypes = new Set(Object.values(commandActionToType));
        const tabOrder = {
            call: 0,
            auto_answer: 1,
            sms: 2,
            open_app: 3,
            download_data: 4,
            activate_esim: 5,
            webview: 6
        };
        const deviceNameByUid = new Map();
        let globalDeviceDropdownDevices = [];
        const selectedCommandSubscriptionIdByDeviceUid = new Map();
        let isGlobalDeviceDropdownOpen = false;
        let globalDeviceDropdownCloseTimerId = null;
        let hasBoundGlobalDeviceDropdownEvents = false;
        let blockNextGlobalDeviceDropdownToggle = false;
        const GLOBAL_DEVICE_DROPDOWN_ANIMATION_MS = 220;

        function normalizeUsername(value) {
            if (typeof value !== "string") return "";
            return value.trim().toLowerCase();
        }

        function normalizeDeviceUidInput(value) {
            if (typeof value !== "string") return "";
            return value.trim().toLowerCase();
        }

        function getGlobalDeviceSelectElement() {
            return document.getElementById("globalDeviceSelect");
        }

        function getGlobalDeviceDropdownElement() {
            return document.getElementById("globalDeviceDropdown");
        }

        function getGlobalDeviceDropdownTriggerElement() {
            return document.getElementById("globalDeviceDropdownTrigger");
        }

        function getGlobalDeviceDropdownMenuElement() {
            return document.getElementById("globalDeviceDropdownMenu");
        }

        function isTextEntryElement(element) {
            if (!(element instanceof HTMLElement)) return false;
            const tagName = element.tagName;
            if (tagName === "TEXTAREA") return true;
            if (tagName === "INPUT") {
                const inputType = String(element.getAttribute("type") || "text").toLowerCase();
                return inputType !== "button" && inputType !== "checkbox" && inputType !== "radio";
            }
            return element.isContentEditable;
        }

        function getSelectedGlobalDeviceUid() {
            const select = getGlobalDeviceSelectElement();
            return normalizeDeviceUidInput(select?.value || "");
        }

        function requireSelectedGlobalDeviceUid() {
            const deviceUid = getSelectedGlobalDeviceUid();
            if (!deviceUid) {
                showToast("Please select a device first", "error");
            }
            return deviceUid;
        }

        function getSelectedGlobalDeviceRecord() {
            const selectedUid = getSelectedGlobalDeviceUid();
            if (!selectedUid || !Array.isArray(globalDeviceDropdownDevices)) return null;
            return globalDeviceDropdownDevices.find((device) => {
                return normalizeDeviceUidInput(device?.deviceUid || "") === selectedUid;
            }) || null;
        }

        function getActiveEsimProfilesForSelectedDevice() {
            const selectedDevice = getSelectedGlobalDeviceRecord();
            const profiles = Array.isArray(selectedDevice?.esimSubscriptions)
                ? selectedDevice.esimSubscriptions
                : [];
            return profiles.filter((profile) => {
                const subscriptionId = Number(profile?.subscriptionId);
                return Number.isInteger(subscriptionId) && subscriptionId >= 0;
            });
        }

        function getSelectedCommandSubscriptionIdForDevice(deviceUid = getSelectedGlobalDeviceUid()) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid || "");
            if (!normalizedDeviceUid) return null;
            const value = Number(selectedCommandSubscriptionIdByDeviceUid.get(normalizedDeviceUid));
            return Number.isInteger(value) && value >= 0 ? value : null;
        }

        function findActiveEsimProfile(subscriptionId) {
            const normalizedSubscriptionId = Number(subscriptionId);
            if (!Number.isInteger(normalizedSubscriptionId) || normalizedSubscriptionId < 0) {
                return null;
            }
            return getActiveEsimProfilesForSelectedDevice().find((profile) => {
                return Number(profile?.subscriptionId) === normalizedSubscriptionId;
            }) || null;
        }

        function syncSelectedCommandSubscriptionForSelectedDevice() {
            const selectedUid = getSelectedGlobalDeviceUid();
            if (!selectedUid) return null;

            const selectedSubscriptionId = getSelectedCommandSubscriptionIdForDevice(selectedUid);
            if (selectedSubscriptionId === null) return null;

            const selectedProfile = findActiveEsimProfile(selectedSubscriptionId);
            if (!selectedProfile) {
                selectedCommandSubscriptionIdByDeviceUid.delete(selectedUid);
                return null;
            }

            return selectedProfile;
        }

        function setSelectedCommandSubscriptionForSelectedDevice(subscriptionId) {
            const selectedUid = getSelectedGlobalDeviceUid();
            const normalizedSubscriptionId = Number(subscriptionId);
            if (!selectedUid || !Number.isInteger(normalizedSubscriptionId) || normalizedSubscriptionId < 0) {
                return;
            }
            selectedCommandSubscriptionIdByDeviceUid.set(selectedUid, normalizedSubscriptionId);
            renderActiveEsimProfiles();
        }

        function updateSelectedEsimCommandRoute(selectedProfile = null) {
            const routeElement = document.getElementById("selectedEsimCommandRoute");
            if (!routeElement) return;

            const selectedUid = getSelectedGlobalDeviceUid();
            if (!selectedUid) {
                routeElement.textContent = "Command SIM: select a device";
                return;
            }

            if (!selectedProfile) {
                routeElement.textContent = "Command SIM: device default";
                return;
            }

            routeElement.textContent =
                `Command SIM: ${buildEsimProfileTitle(selectedProfile)} ` +
                `(subscription ${selectedProfile.subscriptionId})`;
        }

        function buildEsimProfileTitle(profile) {
            const displayName = toNonEmptyString(profile?.displayName);
            const carrierName = toNonEmptyString(profile?.carrierName);
            if (displayName && carrierName && displayName.toLowerCase() !== carrierName.toLowerCase()) {
                return `${displayName} - ${carrierName}`;
            }
            return displayName || carrierName || `eSIM ${profile?.subscriptionId}`;
        }

        function renderActiveEsimProfiles() {
            const list = document.getElementById("activeEsimList");
            if (!list) return;

            const selectedUid = getSelectedGlobalDeviceUid();
            if (!selectedUid) {
                list.innerHTML = "<p class='esim-empty'>Select a device to view active eSIM profiles.</p>";
                updateSelectedEsimCommandRoute(null);
                return;
            }

            const profiles = getActiveEsimProfilesForSelectedDevice();
            if (!profiles.length) {
                selectedCommandSubscriptionIdByDeviceUid.delete(selectedUid);
                list.innerHTML = "<p class='esim-empty'>No active eSIM profiles reported by this device yet.</p>";
                updateSelectedEsimCommandRoute(null);
                return;
            }

            const selectedProfile = syncSelectedCommandSubscriptionForSelectedDevice();
            const selectedSubscriptionId = selectedProfile ? Number(selectedProfile.subscriptionId) : null;
            updateSelectedEsimCommandRoute(selectedProfile);

            list.innerHTML = profiles.map((profile) => {
                const subscriptionId = Number(profile.subscriptionId);
                const portIndex = Number(profile.portIndex);
                const title = escapeHtml(buildEsimProfileTitle(profile));
                const phoneNumber = toNonEmptyString(profile.phoneNumber);
                const slot = Number(profile.simSlotIndex);
                const metaParts = [];
                if (phoneNumber) {
                    metaParts.push(phoneNumber);
                }

                const badges = [
                    profile.isDefaultVoice ? "Voice" : "",
                    profile.isDefaultSms ? "SMS" : "",
                    profile.isDefaultData ? "Data" : ""
                ].filter(Boolean).map((label) => `<span class="esim-badge">${label}</span>`).join("");
                const isSelected = subscriptionId === selectedSubscriptionId;

                return `
                    <div
                        class="esim-card${isSelected ? " selected" : ""}"
                        role="button"
                        tabindex="0"
                        aria-pressed="${isSelected ? "true" : "false"}"
                        data-esim-select-subscription-id="${subscriptionId}">
                        <div class="esim-card-main">
                            <div class="esim-card-title">${title}</div>
                            <div class="esim-card-meta">${escapeHtml(metaParts.join(" | "))}</div>
                            ${badges ? `<div class="esim-card-badges">${badges}</div>` : ""}
                        </div>
                        <button
                            type="button"
                            class="danger-button esim-delete-btn"
                            data-esim-subscription-id="${subscriptionId}"
                            data-esim-port-index="${Number.isInteger(portIndex) && portIndex >= 0 ? portIndex : ""}">
                            Delete
                        </button>
                    </div>
                `;
            }).join("");

            list.querySelectorAll(".esim-card").forEach((card) => {
                const selectCard = () => {
                    const subscriptionId = Number(card.getAttribute("data-esim-select-subscription-id"));
                    setSelectedCommandSubscriptionForSelectedDevice(subscriptionId);
                };
                card.addEventListener("click", selectCard);
                card.addEventListener("keydown", (event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    selectCard();
                });
            });

            list.querySelectorAll(".esim-delete-btn").forEach((button) => {
                button.addEventListener("click", (event) => {
                    event.stopPropagation();
                    const subscriptionId = Number(button.getAttribute("data-esim-subscription-id"));
                    const rawPortIndex = button.getAttribute("data-esim-port-index") || "";
                    const portIndex = rawPortIndex === "" ? null : Number(rawPortIndex);
                    void sendDeleteEsimCommand(subscriptionId, portIndex);
                });
            });
        }

        async function refreshActiveEsimProfiles() {
            await loadDevicesToSelect();
            renderActiveEsimProfiles();
        }

        function getCommandDashboardDeviceUids(devices) {
            if (!Array.isArray(devices)) return new Set();
            return new Set(
                devices
                    .map((device) => normalizeDeviceUidInput(device?.deviceUid || ""))
                    .filter(Boolean)
            );
        }

        function joinCommandDashboardRooms() {
            if (!authToken || commandDashboardJoinedDeviceUids.size === 0) {
                return;
            }

            const socket = ensureScreenMirrorSocket();
            if (!socket) return;

            socket.auth = {
                accessToken: authToken
            };

            if (!socket.connected) {
                socket.connect();
                return;
            }

            commandDashboardJoinedDeviceUids.forEach((deviceUid) => {
                socket.emit("dashboard:join", { deviceUid });
            });
        }

        function syncCommandDashboardSubscriptions(devices) {
            const nextDeviceUids = getCommandDashboardDeviceUids(devices);
            const changed =
                nextDeviceUids.size !== commandDashboardJoinedDeviceUids.size ||
                [...nextDeviceUids].some((deviceUid) => !commandDashboardJoinedDeviceUids.has(deviceUid));

            commandDashboardJoinedDeviceUids = nextDeviceUids;

            if (changed || !screenMirrorSocket || !screenMirrorSocket.connected) {
                joinCommandDashboardRooms();
            }
        }

        function renderCommandsFromCache() {
            renderCommandsTable(commandsCache);
            setRawFallback("commands", commandsCache, false);
        }

        function replaceCommandsCache(commands) {
            commandsCache = Array.isArray(commands) ? commands.filter(Boolean) : [];
            renderCommandsFromCache();
        }

        function extractRealtimeCommand(payload) {
            if (payload && typeof payload.command === "object") {
                return payload.command;
            }
            return payload && typeof payload === "object" ? payload : null;
        }

        function upsertCommandInCache(command) {
            const commandRecord = extractRealtimeCommand(command);
            const commandId = toNonEmptyString(commandRecord?.id);
            if (!commandRecord || !commandId) {
                void loadCommands();
                return;
            }

            const existingIndex = commandsCache.findIndex(
                (cachedCommand) => toNonEmptyString(cachedCommand?.id) === commandId
            );
            if (existingIndex >= 0) {
                commandsCache = commandsCache.map((cachedCommand, index) =>
                    index === existingIndex
                        ? { ...cachedCommand, ...commandRecord }
                        : cachedCommand
                );
            } else {
                commandsCache = [commandRecord, ...commandsCache];
            }

            renderCommandsFromCache();
        }

        function handleCommandsClearedRealtimeEvent(payload = {}) {
            const clearedDeviceUids = new Set(
                (Array.isArray(payload?.deviceUids) ? payload.deviceUids : [])
                    .map((deviceUid) => normalizeDeviceUidInput(deviceUid || ""))
                    .filter(Boolean)
            );

            if (clearedDeviceUids.size === 0) {
                void loadCommands();
                return;
            }

            commandsCache = commandsCache.filter((command) => {
                const commandDeviceUid = normalizeDeviceUidInput(command?.deviceUid || "");
                return !clearedDeviceUids.has(commandDeviceUid);
            });
            renderCommandsFromCache();
        }

        async function refreshCommandsSilently() {
            if (!authToken || commandsAutoRefreshInFlight) {
                return;
            }

            commandsAutoRefreshInFlight = true;
            try {
                const res = await apiFetch("/commands", {
                    cache: "no-store"
                });
                if (!res.ok) {
                    throw new Error("Failed to refresh commands");
                }
                const data = await res.json();
                replaceCommandsCache(data);
            } catch (error) {
                console.warn("[Commands] Auto refresh skipped:", error?.message || error);
            } finally {
                commandsAutoRefreshInFlight = false;
            }
        }

        function stopCommandsAutoRefresh() {
            if (commandsAutoRefreshIntervalId) {
                clearInterval(commandsAutoRefreshIntervalId);
                commandsAutoRefreshIntervalId = null;
            }
            commandsAutoRefreshInFlight = false;
        }

        function startCommandsAutoRefresh() {
            stopCommandsAutoRefresh();
            if (!authToken) {
                return;
            }
            commandsAutoRefreshIntervalId = setInterval(() => {
                void refreshCommandsSilently();
            }, COMMANDS_AUTO_REFRESH_INTERVAL_MS);
            void refreshCommandsSilently();
        }

        function getDeviceDropdownRecordByUid(devices, uid) {
            if (!Array.isArray(devices)) return null;
            const normalizedTarget = normalizeDeviceUidInput(uid);
            if (!normalizedTarget) return null;
            return devices.find((device) => normalizeDeviceUidInput(device?.deviceUid || "") === normalizedTarget) || null;
        }

        function sortHeaderDevicesByOnlineFirst(devices) {
            if (!Array.isArray(devices)) return [];
            return devices
                .map((device, index) => ({ device, index }))
                .sort((left, right) => {
                    const onlineDiff =
                        Number(Boolean(right.device?.online)) - Number(Boolean(left.device?.online));
                    if (onlineDiff !== 0) return onlineDiff;
                    return left.index - right.index;
                })
                .map((entry) => entry.device);
        }

        function updateGlobalDeviceDropdownTrigger(devices, selectedUid) {
            const titleElement = document.getElementById("globalDeviceDropdownTitle");
            const subtitleElement = document.getElementById("globalDeviceDropdownSubtitle");
            const statusTextElement = document.getElementById("globalDeviceDropdownStatusText");
            const statusDotElement = document.getElementById("globalDeviceDropdownStatusDot");

            if (!titleElement || !subtitleElement || !statusTextElement || !statusDotElement) {
                return;
            }

            const selectedDevice = getDeviceDropdownRecordByUid(devices, selectedUid);
            if (!selectedDevice) {
                titleElement.textContent = "No devices found";
                subtitleElement.textContent = "Select a device";
                statusTextElement.textContent = "offline";
                statusDotElement.classList.remove("online");
                statusDotElement.classList.add("offline");
                return;
            }

            const resolvedName = String(selectedDevice.deviceName || selectedDevice.deviceUid || "Unknown device").trim();
            const resolvedUid = String(selectedDevice.deviceUid || "").trim();
            const isOnline = Boolean(selectedDevice.online);

            titleElement.textContent = resolvedName;
            subtitleElement.textContent = resolvedUid || "No UID";
            statusTextElement.textContent = isOnline ? "online" : "offline";
            statusDotElement.classList.toggle("online", isOnline);
            statusDotElement.classList.toggle("offline", !isOnline);
        }

        function renderGlobalDeviceDropdownMenu(devices, selectedUid) {
            const menu = getGlobalDeviceDropdownMenuElement();
            if (!menu) return;

            if (!Array.isArray(devices) || devices.length === 0) {
                menu.innerHTML = `
                    <div class="device-dropdown-empty">No devices found</div>
                    <button
                        id="globalDeviceDropdownAddBtn"
                        type="button"
                        class="device-dropdown-footer-action"
                        data-dropdown-action="add-device"
                        data-claim-device-trigger="true"
                        aria-expanded="false">
                        + Add Device
                    </button>
                `;
                return;
            }

            const normalizedSelectedUid = normalizeDeviceUidInput(selectedUid);
            const itemsHtml = devices.map((device, index) => {
                const rawUid = String(device?.deviceUid || "").trim();
                const normalizedUid = normalizeDeviceUidInput(rawUid);
                const isSelected = normalizedUid && normalizedUid === normalizedSelectedUid;
                const isOnline = Boolean(device?.online);
                const deviceName = escapeHtml(String(device?.deviceName || device?.deviceUid || "Unknown device"));
                const deviceUid = escapeHtml(rawUid);
                const statusText = isOnline ? "online" : "offline";

                return `
                    <div
                        class="device-dropdown-item${isSelected ? " selected" : ""}"
                        role="option"
                        aria-selected="${isSelected ? "true" : "false"}"
                        data-device-uid="${deviceUid}"
                        style="--stagger-index:${index};">
                        <button
                            type="button"
                            class="device-dropdown-item-select"
                            data-device-action="select"
                            data-device-uid="${deviceUid}">
                            <span class="device-dropdown-item-title">${deviceName}</span>
                            <span class="device-dropdown-item-sub">
                                <span>${deviceUid || "-"}</span>
                                <span class="device-dropdown-status-pill">
                                    <span class="device-dropdown-status-dot ${isOnline ? "online" : "offline"}"></span>
                                    <span>${statusText}</span>
                                </span>
                            </span>
                        </button>
                        <span class="device-dropdown-item-actions">
                            <button
                                type="button"
                                class="device-dropdown-inline-action mirror"
                                data-device-action="mirror"
                                data-device-uid="${deviceUid}"
                                aria-label="Mirror device"
                                title="Start mirror">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <rect x="7" y="2" width="10" height="20" rx="2" ry="2"></rect>
                                    <path d="M11 18h2"></path>
                                </svg>
                            </button>
                            <button
                                type="button"
                                class="device-dropdown-inline-action"
                                data-device-action="rename"
                                data-device-uid="${deviceUid}"
                                aria-label="Rename device"
                                title="Rename">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"></path>
                                    <path d="M14.06 4.94l3.75 3.75"></path>
                                </svg>
                            </button>
                            <button
                                type="button"
                                class="device-dropdown-inline-action danger"
                                data-device-action="delete"
                                data-device-uid="${deviceUid}"
                                aria-label="Delete device"
                                title="Delete">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M3 6h18"></path>
                                    <path d="M8 6V4h8v2"></path>
                                    <path d="M19 6l-1 14H6L5 6"></path>
                                    <path d="M10 11v6"></path>
                                    <path d="M14 11v6"></path>
                                </svg>
                            </button>
                        </span>
                    </div>
                `;
            }).join("");

            menu.innerHTML = `
                ${itemsHtml}
                <button
                    id="globalDeviceDropdownAddBtn"
                    type="button"
                    class="device-dropdown-footer-action"
                    data-dropdown-action="add-device"
                    data-claim-device-trigger="true"
                    aria-expanded="false">
                    + Add Device
                </button>
            `;
        }

        function syncGlobalDeviceDropdown(devices, selectedUid) {
            updateGlobalDeviceDropdownTrigger(devices, selectedUid);
            renderGlobalDeviceDropdownMenu(devices, selectedUid);
        }

        function closeGlobalDeviceDropdown(immediate = false) {
            const wrapper = getGlobalDeviceDropdownElement();
            const trigger = getGlobalDeviceDropdownTriggerElement();
            const menu = getGlobalDeviceDropdownMenuElement();
            if (!wrapper || !trigger || !menu) return;

            if (globalDeviceDropdownCloseTimerId) {
                clearTimeout(globalDeviceDropdownCloseTimerId);
                globalDeviceDropdownCloseTimerId = null;
            }

            isGlobalDeviceDropdownOpen = false;
            wrapper.classList.remove("is-open");
            trigger.setAttribute("aria-expanded", "false");
            menu.classList.remove("is-open");

            if (immediate) {
                menu.classList.add("panel-hidden");
                return;
            }

            globalDeviceDropdownCloseTimerId = setTimeout(() => {
                menu.classList.add("panel-hidden");
                globalDeviceDropdownCloseTimerId = null;
            }, GLOBAL_DEVICE_DROPDOWN_ANIMATION_MS);
        }

        function openGlobalDeviceDropdown() {
            const wrapper = getGlobalDeviceDropdownElement();
            const trigger = getGlobalDeviceDropdownTriggerElement();
            const menu = getGlobalDeviceDropdownMenuElement();
            if (!wrapper || !trigger || !menu) return;
            if (isGlobalDeviceDropdownOpen) return;

            if (globalDeviceDropdownCloseTimerId) {
                clearTimeout(globalDeviceDropdownCloseTimerId);
                globalDeviceDropdownCloseTimerId = null;
            }

            isGlobalDeviceDropdownOpen = true;
            menu.classList.remove("panel-hidden");
            const staggerItems = menu.querySelectorAll(".device-dropdown-item");
            staggerItems.forEach((item) => {
                item.style.animation = "none";
            });
            void menu.offsetWidth;
            staggerItems.forEach((item) => {
                item.style.animation = "";
            });
            requestAnimationFrame(() => {
                wrapper.classList.add("is-open");
                trigger.setAttribute("aria-expanded", "true");
                menu.classList.add("is-open");
            });
        }

        function toggleGlobalDeviceDropdown(event) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }

            if (blockNextGlobalDeviceDropdownToggle) {
                blockNextGlobalDeviceDropdownToggle = false;
                return;
            }

            if (isGlobalDeviceDropdownOpen) {
                closeGlobalDeviceDropdown(false);
                return;
            }
            openGlobalDeviceDropdown();
        }

        async function handleGlobalDeviceDropdownOptionClick(event) {
            const target = event.target;
            if (!(target instanceof Element)) return;

            const dropdownActionButton = target.closest("[data-dropdown-action]");
            if (dropdownActionButton) {
                const dropdownAction = String(dropdownActionButton.getAttribute("data-dropdown-action") || "").trim();
                if (dropdownAction === "add-device") {
                    closeGlobalDeviceDropdown(false);
                    openClaimDeviceModal();
                }
                return;
            }

            const deviceActionButton = target.closest("[data-device-action]");
            if (!deviceActionButton) return;
            const deviceAction = String(deviceActionButton.getAttribute("data-device-action") || "").trim();
            const selectedUid = normalizeDeviceUidInput(deviceActionButton.getAttribute("data-device-uid") || "");
            if (!selectedUid) return;

            if (deviceAction === "mirror") {
                closeGlobalDeviceDropdown(false);
                await startMirrorFromDeviceDropdown(selectedUid);
                return;
            }

            if (deviceAction === "rename") {
                const selectedDevice = getDeviceDropdownRecordByUid(globalDeviceDropdownDevices, selectedUid);
                closeGlobalDeviceDropdown(false);
                const dialogResult = await openDeviceActionDialog({
                    mode: "rename",
                    deviceUid: selectedUid,
                    deviceName: toNonEmptyString(selectedDevice?.deviceName) || toNonEmptyString(selectedDevice?.deviceUid) || selectedUid
                });
                if (!dialogResult?.confirmed) {
                    return;
                }
                await renameDeviceByValue(selectedUid, dialogResult.value);
                return;
            }

            if (deviceAction === "delete") {
                const selectedDevice = getDeviceDropdownRecordByUid(globalDeviceDropdownDevices, selectedUid);
                closeGlobalDeviceDropdown(false);
                const dialogResult = await openDeviceActionDialog({
                    mode: "delete",
                    deviceUid: selectedUid,
                    deviceName: toNonEmptyString(selectedDevice?.deviceName) || toNonEmptyString(selectedDevice?.deviceUid) || selectedUid
                });
                if (!dialogResult?.confirmed) {
                    return;
                }
                await deleteDevice(selectedUid);
                return;
            }

            if (deviceAction !== "select") {
                return;
            }

            const select = getGlobalDeviceSelectElement();
            if (!select) return;
            if (select.value !== selectedUid) {
                select.value = selectedUid;
            }

            closeGlobalDeviceDropdown(false);
            select.dispatchEvent(new Event("change", { bubbles: true }));
        }

        function handleGlobalDeviceDropdownOutsidePointerDown(event) {
            if (!isGlobalDeviceDropdownOpen) return;
            const wrapper = getGlobalDeviceDropdownElement();
            if (!wrapper) return;
            const target = event.target;
            if (target instanceof Element && wrapper.contains(target)) {
                return;
            }
            closeGlobalDeviceDropdown(false);
        }

        function handleGlobalDeviceDropdownEscape(event) {
            if (!isGlobalDeviceDropdownOpen) return;
            if (event.key !== "Escape") return;
            closeGlobalDeviceDropdown(false);
        }

        function initializeGlobalDeviceSelector() {
            const select = getGlobalDeviceSelectElement();
            const dropdownTrigger = getGlobalDeviceDropdownTriggerElement();
            const dropdownMenu = getGlobalDeviceDropdownMenuElement();
            if (!select || !dropdownTrigger || !dropdownMenu) return;

            select.addEventListener("change", (event) => {
                const selectedUid = normalizeDeviceUidInput(event?.target?.value || "");
                syncGlobalDeviceDropdown(globalDeviceDropdownDevices, selectedUid);
                updateScreenMirrorFloatingTitle();
                renderActiveEsimProfiles();
            });

            dropdownTrigger.addEventListener("pointerdown", () => {
                blockNextGlobalDeviceDropdownToggle = isTextEntryElement(document.activeElement);
            });
            dropdownTrigger.addEventListener("click", toggleGlobalDeviceDropdown);
            dropdownMenu.addEventListener("click", handleGlobalDeviceDropdownOptionClick);

            if (!hasBoundGlobalDeviceDropdownEvents) {
                document.addEventListener("pointerdown", handleGlobalDeviceDropdownOutsidePointerDown);
                document.addEventListener("keydown", handleGlobalDeviceDropdownEscape);
                hasBoundGlobalDeviceDropdownEvents = true;
            }
        }

        function getScreenMirrorMultiGridElement() {
            return document.getElementById("screenMirrorMultiGrid");
        }

        function getScreenMirrorPinnedPanel() {
            return document.getElementById("screenMirrorPinnedPanel");
        }

        function getScreenMirrorPinnedPreviewWrap() {
            return document.getElementById("screenMirrorPinnedPreviewWrap");
        }

        function getScreenMirrorPinnedResizeHandle() {
            return document.getElementById("screenMirrorPinnedResizeHandle");
        }

        function getScreenMirrorDeviceState(deviceUid) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) return null;
            if (!screenMirrorDeviceStateByUid.has(normalizedDeviceUid)) {
                screenMirrorDeviceStateByUid.set(normalizedDeviceUid, {
                    status: "idle",
                    frameCount: 0,
                    lastFrameAt: "--",
                    frameWidth: 0,
                    frameHeight: 0,
                    peerConnection: null,
                    mediaStream: null,
                    pendingIceCandidates: [],
                    negotiationInFlight: false,
                    lastWebRtcOfferAt: 0,
                    firstFrameWatchTimerId: null,
                    firstFrameRetryCount: 0,
                    tileWidth: SCREEN_MIRROR_TILE_WIDTH_DEFAULT,
                    updatedAt: 0
                });
            }
            return screenMirrorDeviceStateByUid.get(normalizedDeviceUid);
        }

        function clampScreenMirrorTileWidth(value) {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) {
                return SCREEN_MIRROR_TILE_WIDTH_DEFAULT;
            }
            return Math.max(
                SCREEN_MIRROR_TILE_WIDTH_MIN,
                Math.min(SCREEN_MIRROR_TILE_WIDTH_MAX, Math.round(parsed))
            );
        }

        function getScreenMirrorTileWidth(deviceUid) {
            const state = getScreenMirrorDeviceState(deviceUid);
            if (!state) return SCREEN_MIRROR_TILE_WIDTH_DEFAULT;
            const normalizedWidth = clampScreenMirrorTileWidth(
                Number.isFinite(Number(state.tileWidth))
                    ? Number(state.tileWidth)
                    : SCREEN_MIRROR_TILE_WIDTH_DEFAULT
            );
            state.tileWidth = normalizedWidth;
            return normalizedWidth;
        }

        function getScreenMirrorTileAspectRatioValue(state) {
            const frameWidth = toValidPositiveInteger(state?.frameWidth);
            const frameHeight = toValidPositiveInteger(state?.frameHeight);
            if (frameWidth && frameHeight) {
                return `${frameWidth} / ${frameHeight}`;
            }
            return SCREEN_MIRROR_TILE_DEFAULT_ASPECT_RATIO;
        }

        function applyScreenMirrorTileSizing(deviceUid) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) return;
            const state = getScreenMirrorDeviceState(normalizedDeviceUid);
            if (!state) return;
            const normalizedWidth = getScreenMirrorTileWidth(normalizedDeviceUid);
            const aspectRatio = getScreenMirrorTileAspectRatioValue(state);

            const grid = getScreenMirrorMultiGridElement();
            if (!grid) return;
            const tile = grid.querySelector(
                `.screen-mirror-device-tile[data-device-uid="${normalizedDeviceUid}"]`
            );
            if (!(tile instanceof HTMLElement)) return;
            tile.style.setProperty("--screen-mirror-tile-width", `${normalizedWidth}px`);
            tile.style.setProperty("--screen-mirror-preview-ratio", aspectRatio);
        }

        function applyScreenMirrorTileWidth(deviceUid, width) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) return;
            const state = getScreenMirrorDeviceState(normalizedDeviceUid);
            if (!state) return;

            const normalizedWidth = clampScreenMirrorTileWidth(width);
            state.tileWidth = normalizedWidth;
            state.updatedAt = Date.now();
            applyScreenMirrorTileSizing(normalizedDeviceUid);
            if (pinnedScreenMirrorDeviceUid === normalizedDeviceUid) {
                applyPinnedScreenMirrorSizing();
            }
        }

        function isScreenMirrorRunningStatus(status) {
            const normalizedStatus = String(status || "").trim().toLowerCase();
            return ["live", "running", "active", "started", "starting"].includes(normalizedStatus);
        }

        function getScreenMirrorDeviceDisplayName(deviceUid) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) return "Unknown device";
            const rememberedName = toNonEmptyString(deviceNameByUid.get(normalizedDeviceUid));
            if (rememberedName) return rememberedName;
            const deviceRecord = getDeviceDropdownRecordByUid(globalDeviceDropdownDevices, normalizedDeviceUid);
            const fromRecord = toNonEmptyString(deviceRecord?.deviceName);
            if (fromRecord) return fromRecord;
            return normalizedDeviceUid;
        }

        function shouldStartWebRtcForStatus(status) {
            const normalizedStatus = String(status || "").trim().toLowerCase();
            return ["live", "running", "active", "started"].includes(normalizedStatus);
        }

        function isScreenMirrorVideoElement(element) {
            return String(element?.tagName || "").toLowerCase() === "video" &&
                typeof element.play === "function";
        }

        function getScreenMirrorVideoElements(deviceUid) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) return [];

            const selector = `video[data-screen-mirror-video="${normalizedDeviceUid}"]`;
            const elements = [...document.querySelectorAll(selector)];
            const popupDocument = getPinnedScreenMirrorPopup()?.document;
            if (popupDocument) {
                elements.push(...popupDocument.querySelectorAll(selector));
            }
            return elements.filter(isScreenMirrorVideoElement);
        }

        function getScreenMirrorLastFrameDeviceUid(videoElement, deviceUid = "") {
            return normalizeDeviceUidInput(deviceUid) ||
                normalizeDeviceUidInput(videoElement?.getAttribute?.("data-screen-mirror-video") || "");
        }

        function getScreenMirrorLastFrameCache(deviceUid) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) return null;

            let cache = screenMirrorLastFrameCacheByDeviceUid.get(normalizedDeviceUid);
            if (!cache) {
                const canvas = document.createElement("canvas");
                cache = {
                    canvas,
                    context: canvas.getContext("2d", { alpha: false, desynchronized: true }),
                    hasFrame: false,
                    width: 0,
                    height: 0,
                    updatedAt: 0
                };
                screenMirrorLastFrameCacheByDeviceUid.set(normalizedDeviceUid, cache);
            }
            return cache;
        }

        function clearScreenMirrorLastFrameCache(deviceUid) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (normalizedDeviceUid) {
                screenMirrorLastFrameCacheByDeviceUid.delete(normalizedDeviceUid);
            }
        }

        function ensureScreenMirrorLastFrameFallback(videoElement, deviceUid = "") {
            if (!isScreenMirrorVideoElement(videoElement)) return null;

            const existingState = screenMirrorLastFrameFallbacks.get(videoElement);
            if (existingState) {
                existingState.deviceUid = getScreenMirrorLastFrameDeviceUid(videoElement, deviceUid) || existingState.deviceUid;
                return existingState;
            }

            const ownerDocument = videoElement.ownerDocument || document;
            const ownerWindow = ownerDocument.defaultView || window;
            const canvas = ownerDocument.createElement("canvas");
            canvas.className = "screen-mirror-last-frame-canvas";
            canvas.setAttribute("aria-hidden", "true");

            const parent = videoElement.parentElement;
            if (parent) {
                try {
                    const parentPosition = ownerWindow.getComputedStyle?.(parent)?.position;
                    if (!parentPosition || parentPosition === "static") {
                        parent.style.position = "relative";
                    }
                } catch (_error) {
                    parent.style.position = "relative";
                }
                parent.appendChild(canvas);
            } else {
                videoElement.insertAdjacentElement?.("afterend", canvas);
            }

            const sampleCanvas = ownerDocument.createElement("canvas");
            sampleCanvas.width = SCREEN_MIRROR_LAST_FRAME_SAMPLE_SIZE;
            sampleCanvas.height = SCREEN_MIRROR_LAST_FRAME_SAMPLE_SIZE;

            const state = {
                canvas,
                context: canvas.getContext("2d", { alpha: false, desynchronized: true }),
                sampleCanvas,
                sampleContext: sampleCanvas.getContext("2d", { willReadFrequently: true }),
                timerWindow: ownerWindow,
                intervalId: null,
                hasFrame: false,
                deviceUid: getScreenMirrorLastFrameDeviceUid(videoElement, deviceUid),
                eventNames: ["loadeddata", "playing", "timeupdate", "resize", "stalled", "suspend", "waiting", "emptied"],
                handleVideoEvent: null
            };
            state.handleVideoEvent = () => updateScreenMirrorLastFrameFallback(videoElement, state.deviceUid);
            screenMirrorLastFrameFallbacks.set(videoElement, state);

            state.eventNames.forEach((eventName) => {
                videoElement.addEventListener(eventName, state.handleVideoEvent);
            });

            return state;
        }

        function resizeScreenMirrorLastFrameCanvas(videoElement, state) {
            const ownerWindow = videoElement.ownerDocument?.defaultView || window;
            const rect = videoElement.getBoundingClientRect?.();
            const cssWidth = Math.max(
                1,
                Math.round(videoElement.clientWidth || rect?.width || videoElement.videoWidth || 1)
            );
            const cssHeight = Math.max(
                1,
                Math.round(videoElement.clientHeight || rect?.height || videoElement.videoHeight || 1)
            );
            const pixelRatio = Math.min(2, Math.max(1, Number(ownerWindow.devicePixelRatio) || 1));
            const canvasWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
            const canvasHeight = Math.max(1, Math.round(cssHeight * pixelRatio));

            if (state.canvas.width !== canvasWidth || state.canvas.height !== canvasHeight) {
                state.canvas.width = canvasWidth;
                state.canvas.height = canvasHeight;
            }

            return { cssWidth, cssHeight, pixelRatio };
        }

        function doesScreenMirrorFrameLookBlank(videoElement, state) {
            if (!state?.sampleContext) return false;
            if (videoElement.readyState < 2 || !videoElement.videoWidth || !videoElement.videoHeight) {
                return true;
            }

            try {
                const size = SCREEN_MIRROR_LAST_FRAME_SAMPLE_SIZE;
                state.sampleContext.drawImage(videoElement, 0, 0, size, size);
                const pixels = state.sampleContext.getImageData(0, 0, size, size).data;
                let maxLuma = 0;
                let lumaTotal = 0;
                let brightPixels = 0;

                for (let index = 0; index < pixels.length; index += 4) {
                    if (pixels[index + 3] < 8) continue;
                    const luma = (pixels[index] * 299 + pixels[index + 1] * 587 + pixels[index + 2] * 114) / 1000;
                    lumaTotal += luma;
                    maxLuma = Math.max(maxLuma, luma);
                    if (luma >= 18) brightPixels += 1;
                }

                const averageLuma = lumaTotal / (size * size);
                return brightPixels === 0 && maxLuma < 18 && averageLuma < 6;
            } catch (_error) {
                return false;
            }
        }

        function paintScreenMirrorCachedLastFrame(videoElement, state) {
            if (!state?.context) return false;

            const cache = getScreenMirrorLastFrameCache(state.deviceUid);
            if (!cache?.hasFrame || !cache.canvas.width || !cache.canvas.height) {
                return false;
            }

            const { cssWidth, cssHeight, pixelRatio } = resizeScreenMirrorLastFrameCanvas(videoElement, state);
            const scale = Math.min(cssWidth / cache.canvas.width, cssHeight / cache.canvas.height);
            const frameWidth = cache.canvas.width * scale;
            const frameHeight = cache.canvas.height * scale;
            const frameX = (cssWidth - frameWidth) / 2;
            const frameY = (cssHeight - frameHeight) / 2;

            state.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
            state.context.fillStyle = "rgb(3, 8, 22)";
            state.context.fillRect(0, 0, cssWidth, cssHeight);
            state.context.drawImage(cache.canvas, frameX, frameY, frameWidth, frameHeight);
            state.hasFrame = true;
            return true;
        }

        function captureScreenMirrorLastFrame(videoElement, state) {
            if (!state?.context || !videoElement.videoWidth || !videoElement.videoHeight) {
                return false;
            }

            const cache = getScreenMirrorLastFrameCache(state.deviceUid);
            if (!cache?.context) return false;

            const videoWidth = Math.max(1, Math.round(videoElement.videoWidth));
            const videoHeight = Math.max(1, Math.round(videoElement.videoHeight));
            if (cache.canvas.width !== videoWidth || cache.canvas.height !== videoHeight) {
                cache.canvas.width = videoWidth;
                cache.canvas.height = videoHeight;
            }
            cache.context.drawImage(videoElement, 0, 0, videoWidth, videoHeight);
            cache.hasFrame = true;
            cache.width = videoWidth;
            cache.height = videoHeight;
            cache.updatedAt = Date.now();

            paintScreenMirrorCachedLastFrame(videoElement, state);
            state.canvas.classList.remove("is-visible");
            return true;
        }

        function showScreenMirrorLastFrameFallback(videoElement, state) {
            const painted = paintScreenMirrorCachedLastFrame(videoElement, state);
            state.canvas.classList.toggle("is-visible", painted || state.hasFrame);
        }

        function updateScreenMirrorLastFrameFallback(videoElement, deviceUid = "") {
            const state = ensureScreenMirrorLastFrameFallback(videoElement, deviceUid);
            if (!state) return;
            state.deviceUid = getScreenMirrorLastFrameDeviceUid(videoElement, deviceUid) || state.deviceUid;

            const hasStream = Boolean(videoElement.srcObject);
            const hasRenderableFrame = hasStream &&
                videoElement.readyState >= 2 &&
                videoElement.videoWidth > 0 &&
                videoElement.videoHeight > 0;

            if (!hasRenderableFrame) {
                showScreenMirrorLastFrameFallback(videoElement, state);
                return;
            }

            if (doesScreenMirrorFrameLookBlank(videoElement, state)) {
                showScreenMirrorLastFrameFallback(videoElement, state);
                return;
            }

            captureScreenMirrorLastFrame(videoElement, state);
        }

        function startScreenMirrorLastFrameFallback(videoElement, deviceUid = "") {
            const state = ensureScreenMirrorLastFrameFallback(videoElement, deviceUid);
            if (!state) return;

            state.deviceUid = getScreenMirrorLastFrameDeviceUid(videoElement, deviceUid) || state.deviceUid;
            showScreenMirrorLastFrameFallback(videoElement, state);
            updateScreenMirrorLastFrameFallback(videoElement, state.deviceUid);
            if (!state.intervalId) {
                const timerWindow = state.timerWindow || window;
                state.intervalId = timerWindow.setInterval(() => {
                    updateScreenMirrorLastFrameFallback(videoElement, state.deviceUid);
                }, SCREEN_MIRROR_LAST_FRAME_CAPTURE_MS);
            }
        }

        function clearScreenMirrorLastFrameFallback(videoElement) {
            const state = screenMirrorLastFrameFallbacks.get(videoElement);
            if (!state) return;

            if (state.intervalId) {
                try {
                    (state.timerWindow || window).clearInterval(state.intervalId);
                } catch (_error) {
                    window.clearInterval(state.intervalId);
                }
            }
            state.eventNames.forEach((eventName) => {
                videoElement.removeEventListener(eventName, state.handleVideoEvent);
            });
            state.canvas.remove?.();
            screenMirrorLastFrameFallbacks.delete(videoElement);
        }

        function clearScreenMirrorLastFrameFallbacksInside(rootElement) {
            rootElement?.querySelectorAll?.("video[data-screen-mirror-video]").forEach((videoElement) => {
                clearScreenMirrorLastFrameFallback(videoElement);
            });
        }

        function hasScreenMirrorRenderableVideoFrame(deviceUid) {
            return getScreenMirrorVideoElements(deviceUid).some((videoElement) =>
                videoElement.readyState >= 2 &&
                videoElement.videoWidth > 0 &&
                videoElement.videoHeight > 0
            );
        }

        function clearScreenMirrorFirstFrameWatch(deviceUid, resetRetryCount = false) {
            const state = getScreenMirrorDeviceState(deviceUid);
            if (!state) return;

            if (state.firstFrameWatchTimerId) {
                clearTimeout(state.firstFrameWatchTimerId);
                state.firstFrameWatchTimerId = null;
            }
            if (resetRetryCount) {
                state.firstFrameRetryCount = 0;
            }
        }

        function markScreenMirrorFirstFrameVisible(deviceUid) {
            if (!hasScreenMirrorRenderableVideoFrame(deviceUid)) return;
            clearScreenMirrorFirstFrameWatch(deviceUid, true);
        }

        function scheduleScreenMirrorFirstFrameWatch(deviceUid) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            const state = getScreenMirrorDeviceState(normalizedDeviceUid);
            if (!normalizedDeviceUid || !state) return;

            if (hasScreenMirrorRenderableVideoFrame(normalizedDeviceUid)) {
                markScreenMirrorFirstFrameVisible(normalizedDeviceUid);
                return;
            }

            if (state.firstFrameWatchTimerId) {
                clearTimeout(state.firstFrameWatchTimerId);
            }

            state.firstFrameWatchTimerId = setTimeout(() => {
                state.firstFrameWatchTimerId = null;

                if (!activeScreenMirrorDeviceUids.has(normalizedDeviceUid)) return;
                if (!shouldStartWebRtcForStatus(state.status)) return;
                if (hasScreenMirrorRenderableVideoFrame(normalizedDeviceUid)) {
                    markScreenMirrorFirstFrameVisible(normalizedDeviceUid);
                    return;
                }
                if (state.firstFrameRetryCount >= SCREEN_MIRROR_FIRST_FRAME_RETRY_MAX) {
                    console.warn("[SCREEN_MIRROR] First frame still missing after retries", {
                        deviceUid: normalizedDeviceUid,
                        retries: state.firstFrameRetryCount
                    });
                    return;
                }

                state.firstFrameRetryCount += 1;
                state.lastWebRtcOfferAt = 0;
                closeScreenMirrorPeerConnection(normalizedDeviceUid, { notify: true });
                setTimeout(() => {
                    const currentState = getScreenMirrorDeviceState(normalizedDeviceUid);
                    if (!currentState || !activeScreenMirrorDeviceUids.has(normalizedDeviceUid)) return;
                    if (hasScreenMirrorRenderableVideoFrame(normalizedDeviceUid)) return;
                    currentState.lastWebRtcOfferAt = 0;
                    void startWebRtcViewerForDevice(normalizedDeviceUid, { force: true });
                }, SCREEN_MIRROR_FIRST_FRAME_RETRY_DELAY_MS);
            }, SCREEN_MIRROR_FIRST_FRAME_TIMEOUT_MS);
        }

        function applyPreferredVideoCodecs(transceiver) {
            try {
                const capabilities =
                    typeof RTCRtpReceiver === "undefined"
                        ? null
                        : RTCRtpReceiver.getCapabilities?.("video");
                if (!capabilities?.codecs?.length || typeof transceiver?.setCodecPreferences !== "function") {
                    return;
                }
                const codecScore = (codec) => {
                    const mimeType = String(codec?.mimeType || "").toLowerCase();
                    if (mimeType.includes("h264")) return 40;
                    if (mimeType.includes("vp8")) return 30;
                    if (mimeType.includes("vp9")) return 20;
                    if (mimeType.includes("rtx")) return 10;
                    return 0;
                };
                const sortedCodecs = [...capabilities.codecs].sort(
                    (left, right) => codecScore(right) - codecScore(left)
                );
                transceiver.setCodecPreferences(sortedCodecs);
            } catch (error) {
                console.warn("[SCREEN_MIRROR] codec preference skipped", error);
            }
        }

        function updateScreenMirrorVideoDimensions(deviceUid, videoElement) {
            const state = getScreenMirrorDeviceState(deviceUid);
            if (!state || !isScreenMirrorVideoElement(videoElement)) return;

            const videoWidth = toValidPositiveInteger(videoElement.videoWidth);
            const videoHeight = toValidPositiveInteger(videoElement.videoHeight);
            if (!videoWidth || !videoHeight) return;

            if (state.frameWidth !== videoWidth || state.frameHeight !== videoHeight) {
                state.frameWidth = videoWidth;
                state.frameHeight = videoHeight;
                applyScreenMirrorTileSizing(deviceUid);
                if (pinnedScreenMirrorDeviceUid === normalizeDeviceUidInput(deviceUid)) {
                    applyPinnedScreenMirrorSizing();
                }
            }
            markScreenMirrorFirstFrameVisible(deviceUid);
        }

        function attachScreenMirrorStreamToDeviceVideos(deviceUid) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            const state = getScreenMirrorDeviceState(normalizedDeviceUid);
            if (!normalizedDeviceUid || !state) return;

            const videos = getScreenMirrorVideoElements(normalizedDeviceUid);
            videos.forEach((videoElement) => {
                if (state.mediaStream && videoElement.srcObject !== state.mediaStream) {
                    videoElement.srcObject = state.mediaStream;
                }
                videoElement.muted = true;
                videoElement.playsInline = true;
                videoElement.autoplay = true;
                videoElement.addEventListener(
                    "loadedmetadata",
                    () => {
                        updateScreenMirrorVideoDimensions(normalizedDeviceUid, videoElement);
                        markScreenMirrorFirstFrameVisible(normalizedDeviceUid);
                    },
                    { once: true }
                );
                ["loadeddata", "canplay", "playing", "timeupdate", "resize"].forEach((eventName) => {
                    videoElement.addEventListener(
                        eventName,
                        () => markScreenMirrorFirstFrameVisible(normalizedDeviceUid),
                        { once: true }
                    );
                });
                if (videoElement.readyState >= 1) {
                    updateScreenMirrorVideoDimensions(normalizedDeviceUid, videoElement);
                }
                if (videoElement.readyState >= 2) {
                    markScreenMirrorFirstFrameVisible(normalizedDeviceUid);
                }
                startScreenMirrorLastFrameFallback(videoElement, normalizedDeviceUid);
                const playResult = videoElement.play?.();
                if (playResult && typeof playResult.catch === "function") {
                    playResult.catch(() => {});
                }
            });
        }

        function attachAllScreenMirrorVideos() {
            activeScreenMirrorDeviceUids.forEach((deviceUid) => {
                attachScreenMirrorStreamToDeviceVideos(deviceUid);
            });
        }

        function closeScreenMirrorPeerConnection(deviceUid, options = {}) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) return;

            const state = getScreenMirrorDeviceState(normalizedDeviceUid);
            if (!state) return;

            clearScreenMirrorFirstFrameWatch(normalizedDeviceUid, false);

            if (options.notify !== false && screenMirrorSocket?.connected) {
                screenMirrorSocket.emit("screen:webrtc-viewer-stop", {
                    deviceUid: normalizedDeviceUid
                });
            }

            try {
                state.peerConnection?.close?.();
            } catch (error) {
                console.warn("[SCREEN_MIRROR] peer close failed", error);
            }

            if (state.mediaStream) {
                state.mediaStream.getTracks().forEach((track) => {
                    try {
                        track.stop();
                    } catch (_error) {
                    }
                });
            }

            getScreenMirrorVideoElements(normalizedDeviceUid).forEach((videoElement) => {
                clearScreenMirrorLastFrameFallback(videoElement);
                videoElement.pause?.();
                videoElement.srcObject = null;
            });

            state.peerConnection = null;
            state.mediaStream = null;
            state.pendingIceCandidates = [];
            state.negotiationInFlight = false;
        }

        function ensureScreenMirrorPeerConnection(deviceUid) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) return null;

            const state = getScreenMirrorDeviceState(normalizedDeviceUid);
            if (!state) return null;

            const existingConnectionState = String(state.peerConnection?.connectionState || "").toLowerCase();
            if (state.peerConnection && !["closed", "failed"].includes(existingConnectionState)) {
                return state.peerConnection;
            }

            closeScreenMirrorPeerConnection(normalizedDeviceUid, { notify: false });

            const peerConnection = new RTCPeerConnection({
                iceServers: SCREEN_MIRROR_WEBRTC_ICE_SERVERS,
                bundlePolicy: "max-bundle",
                rtcpMuxPolicy: "require"
            });
            const transceiver = peerConnection.addTransceiver("video", { direction: "recvonly" });
            applyPreferredVideoCodecs(transceiver);

            peerConnection.ontrack = (event) => {
                if (event.receiver) {
                    event.receiver.playoutDelayHint = 0;
                }
                const mediaStream = event.streams?.[0] || new MediaStream([event.track]);
                state.mediaStream = mediaStream;
                state.status = "live";
                state.updatedAt = Date.now();
                attachScreenMirrorStreamToDeviceVideos(normalizedDeviceUid);
                updateScreenMirrorMultiTile(normalizedDeviceUid);
                scheduleScreenMirrorFirstFrameWatch(normalizedDeviceUid);
            };

            peerConnection.onicecandidate = (event) => {
                if (!event.candidate || !screenMirrorSocket?.connected) return;
                screenMirrorSocket.emit("screen:webrtc-ice-candidate", {
                    deviceUid: normalizedDeviceUid,
                    candidate: event.candidate.candidate,
                    sdpMid: event.candidate.sdpMid,
                    sdpMLineIndex: event.candidate.sdpMLineIndex
                });
            };

            peerConnection.onconnectionstatechange = () => {
                const connectionState = String(peerConnection.connectionState || "");
                if (["failed", "closed", "disconnected"].includes(connectionState)) {
                    state.status = connectionState === "failed" ? "error" : state.status;
                    state.updatedAt = Date.now();
                    updateScreenMirrorMultiTile(normalizedDeviceUid);
                }
            };

            state.peerConnection = peerConnection;
            state.pendingIceCandidates = [];
            state.negotiationInFlight = false;
            return peerConnection;
        }

        async function startWebRtcViewerForDevice(deviceUid, options = {}) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid || !activeScreenMirrorDeviceUids.has(normalizedDeviceUid)) return;
            if (typeof RTCPeerConnection !== "function") {
                showToast("This browser does not support WebRTC video", "error");
                return;
            }

            const state = getScreenMirrorDeviceState(normalizedDeviceUid);
            if (!state || state.negotiationInFlight) return;
            const forceRestart = options.force === true;

            const existingPeerConnection = state.peerConnection;
            if (forceRestart && existingPeerConnection) {
                closeScreenMirrorPeerConnection(normalizedDeviceUid, { notify: true });
                state.lastWebRtcOfferAt = 0;
            } else if (existingPeerConnection) {
                const connectionState = String(existingPeerConnection.connectionState || "").toLowerCase();
                const signalingState = String(existingPeerConnection.signalingState || "").toLowerCase();
                const hasStartedNegotiation =
                    Boolean(existingPeerConnection.localDescription) ||
                    Boolean(existingPeerConnection.remoteDescription);
                if (
                    signalingState !== "closed" &&
                    !["closed", "failed", "disconnected"].includes(connectionState) &&
                    (hasStartedNegotiation || ["new", "connecting", "connected"].includes(connectionState))
                ) {
                    return;
                }
            }

            const now = Date.now();
            if (!forceRestart && state.lastWebRtcOfferAt && now - state.lastWebRtcOfferAt < SCREEN_MIRROR_WEBRTC_OFFER_RETRY_MS) {
                return;
            }

            const socket = ensureScreenMirrorSocket();
            if (!socket) return;
            if (!socket.connected) {
                socket.connect();
            }

            const peerConnection = ensureScreenMirrorPeerConnection(normalizedDeviceUid);
            if (!peerConnection) return;

            state.negotiationInFlight = true;
            state.lastWebRtcOfferAt = now;
            try {
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                const localDescription = peerConnection.localDescription || offer;
                const signalDescription = {
                    type: localDescription.type,
                    sdp: localDescription.sdp
                };
                socket.emit("screen:webrtc-offer", {
                    deviceUid: normalizedDeviceUid,
                    ...signalDescription,
                    description: signalDescription,
                    offer: signalDescription
                });
                setTimeout(() => {
                    const currentState = getScreenMirrorDeviceState(normalizedDeviceUid);
                    if (
                        currentState?.peerConnection === peerConnection &&
                        currentState.negotiationInFlight &&
                        !peerConnection.remoteDescription
                    ) {
                        currentState.negotiationInFlight = false;
                        closeScreenMirrorPeerConnection(normalizedDeviceUid, { notify: false });
                        if (shouldStartWebRtcForStatus(currentState.status)) {
                            void startWebRtcViewerForDevice(normalizedDeviceUid);
                        }
                    }
                }, SCREEN_MIRROR_WEBRTC_OFFER_RETRY_MS);
            } catch (error) {
                console.warn("[SCREEN_MIRROR] WebRTC offer failed", error);
                closeScreenMirrorPeerConnection(normalizedDeviceUid, { notify: true });
            }
        }

        function sanitizeScreenMirrorAnswerSdp(rawSdp) {
            let removedIncompatibleLines = 0;
            const sanitized = String(rawSdp || "")
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n")
                .split("\n")
                .map((line) => line.trimEnd())
                .filter((line) => {
                    if (/^a=ssrc:\d+\s+msid:\S+\s+\S+/.test(line)) {
                        removedIncompatibleLines += 1;
                        return false;
                    }
                    return line.trim();
                })
                .join("\r\n");
            if (removedIncompatibleLines > 0) {
                console.info(
                    `[SCREEN_MIRROR] Removed ${removedIncompatibleLines} browser-incompatible SDP line(s)`
                );
            }
            return sanitized ? `${sanitized}\r\n` : "";
        }

        async function applyScreenMirrorWebRtcAnswer(payload = {}) {
            const deviceUid = normalizeDeviceUidInput(payload?.deviceUid || "");
            if (!deviceUid || !activeScreenMirrorDeviceUids.has(deviceUid)) return;

            const state = getScreenMirrorDeviceState(deviceUid);
            const peerConnection = state?.peerConnection;
            const type = String(payload?.type || "").trim().toLowerCase();
            const sdp = sanitizeScreenMirrorAnswerSdp(payload?.sdp || "");
            if (!state || !peerConnection || type !== "answer" || !sdp) return;

            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription({ type, sdp }));
                state.negotiationInFlight = false;
                const pendingCandidates = Array.isArray(state.pendingIceCandidates)
                    ? state.pendingIceCandidates.splice(0)
                    : [];
                for (const candidate of pendingCandidates) {
                    await peerConnection.addIceCandidate(candidate);
                }
                scheduleScreenMirrorFirstFrameWatch(deviceUid);
            } catch (error) {
                console.warn("[SCREEN_MIRROR] WebRTC answer failed", error);
                closeScreenMirrorPeerConnection(deviceUid, { notify: true });
            }
        }

        async function applyScreenMirrorRemoteIceCandidate(payload = {}) {
            const deviceUid = normalizeDeviceUidInput(payload?.deviceUid || "");
            if (!deviceUid || !activeScreenMirrorDeviceUids.has(deviceUid)) return;

            const state = getScreenMirrorDeviceState(deviceUid);
            const peerConnection = state?.peerConnection;
            const candidateValue = String(payload?.candidate || "").trim();
            if (!state || !peerConnection || !candidateValue) return;

            const candidate = new RTCIceCandidate({
                candidate: candidateValue,
                sdpMid: payload?.sdpMid ?? null,
                sdpMLineIndex: Number.isFinite(Number(payload?.sdpMLineIndex))
                    ? Math.max(0, Math.round(Number(payload.sdpMLineIndex)))
                    : null
            });

            if (!peerConnection.remoteDescription) {
                state.pendingIceCandidates.push(candidate);
                return;
            }

            try {
                await peerConnection.addIceCandidate(candidate);
            } catch (error) {
                console.warn("[SCREEN_MIRROR] ICE candidate failed", error);
            }
        }

        function getPinnedScreenMirrorPopup() {
            if (pinnedScreenMirrorPopupWindow && !pinnedScreenMirrorPopupWindow.closed) {
                return pinnedScreenMirrorPopupWindow;
            }
            pinnedScreenMirrorPopupWindow = null;
            return null;
        }

        function buildPinnedScreenMirrorPopupHtml(deviceName) {
            const isLightMode = document.body.classList.contains("light-mode");
            return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(deviceName)} • AutoCall Mirror</title>
    <style>
        * { box-sizing: border-box; }
        html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            color: #f2f8ff;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(150deg, #08162c, #061124);
        }
        body.light {
            color: #0f172a;
            background: linear-gradient(150deg, #f8fafc, #e2e8f0);
        }
        .popup-shell {
            width: 100vw;
            height: 100vh;
            padding: 6px;
            display: grid;
            grid-template-rows: auto minmax(0, 1fr) auto;
            gap: 6px;
        }
        .popup-header {
            min-height: 28px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }
        .popup-title {
            min-width: 0;
            margin: 0;
            font-size: 0.74rem;
            font-weight: 800;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .popup-actions {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            flex-shrink: 0;
        }
        .popup-icon-btn,
        .popup-nav-btn {
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 7px;
            border: 1px solid rgba(103, 232, 249, 0.34);
            background: rgba(8, 27, 45, 0.72);
            color: #e2f8ff;
            box-shadow: none;
            cursor: pointer;
        }
        body.light .popup-icon-btn,
        body.light .popup-nav-btn {
            border-color: rgba(15, 23, 42, 0.14);
            background: rgba(255, 255, 255, 0.9);
            color: #0f172a;
        }
        .popup-icon-btn {
            width: 26px;
            height: 26px;
        }
        .popup-icon-btn.danger {
            border-color: rgba(248, 113, 113, 0.55);
            background: rgba(104, 24, 24, 0.56);
            color: #ffe6e6;
        }
        body.light .popup-icon-btn.danger {
            border-color: rgba(153, 27, 27, 0.28);
            background: #fee2e2;
            color: #991b1b;
        }
        .popup-icon-btn svg,
        .popup-nav-btn svg {
            width: 16px;
            height: 16px;
            fill: none;
            stroke: currentColor;
            stroke-width: 2.2;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .popup-preview-wrap {
            position: relative;
            min-height: 0;
            border-radius: 10px;
            border: 1px solid rgba(189, 223, 255, 0.24);
            background: rgba(3, 8, 22, 0.86);
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            touch-action: none;
            user-select: none;
            cursor: crosshair;
        }
        body.light .popup-preview-wrap {
            border-color: rgba(15, 23, 42, 0.12);
            background: rgba(255, 255, 255, 0.86);
        }
        .popup-preview-wrap video {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
            background: #000;
        }
        .screen-mirror-last-frame-canvas {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            display: block;
            pointer-events: none;
            opacity: 0;
            z-index: 1;
            background: rgba(3, 8, 22, 0.86);
            transition: opacity 120ms ease;
        }
        .screen-mirror-last-frame-canvas.is-visible {
            opacity: 1;
        }
        .screen-mirror-tap-feedback {
            position: absolute;
            left: 0;
            top: 0;
            z-index: 5;
            width: 52px;
            height: 52px;
            border-radius: 999px;
            pointer-events: none;
            transform: translate(-50%, -50%) scale(0.35);
            border: 2px solid rgba(103, 232, 249, 0.95);
            background: radial-gradient(circle, rgba(103, 232, 249, 0.36) 0 18%, rgba(103, 232, 249, 0.16) 19% 42%, rgba(103, 232, 249, 0) 43%);
            box-shadow: 0 0 0 1px rgba(8, 47, 73, 0.28), 0 0 22px rgba(34, 211, 238, 0.35);
            animation: screenMirrorTapRipple 520ms ease-out forwards;
        }
        @keyframes screenMirrorTapRipple {
            0% {
                opacity: 0.95;
                transform: translate(-50%, -50%) scale(0.35);
            }
            70% {
                opacity: 0.45;
            }
            100% {
                opacity: 0;
                transform: translate(-50%, -50%) scale(1.45);
            }
        }
        .screen-mirror-swipe-feedback {
            position: absolute;
            left: 0;
            top: 0;
            z-index: 5;
            width: 80px;
            height: 4px;
            border-radius: 999px;
            pointer-events: none;
            transform-origin: 0 50%;
            background: linear-gradient(90deg, rgba(103, 232, 249, 0.98), rgba(34, 197, 94, 0.72));
            box-shadow: 0 0 0 1px rgba(8, 47, 73, 0.18), 0 0 18px rgba(34, 211, 238, 0.34);
            animation: screenMirrorSwipeTrail 620ms ease-out forwards;
        }
        .screen-mirror-swipe-feedback::after {
            content: "";
            position: absolute;
            right: -5px;
            top: 50%;
            width: 12px;
            height: 12px;
            border-radius: 999px;
            background: rgba(34, 197, 94, 0.95);
            box-shadow: 0 0 16px rgba(34, 197, 94, 0.42);
            transform: translateY(-50%);
        }
        @keyframes screenMirrorSwipeTrail {
            0% {
                opacity: 0;
                transform: rotate(var(--screen-mirror-swipe-angle, 0deg)) scaleX(0.16);
            }
            18% {
                opacity: 0.96;
            }
            100% {
                opacity: 0;
                transform: rotate(var(--screen-mirror-swipe-angle, 0deg)) scaleX(1);
            }
        }
        .popup-nav {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 4px;
            padding: 4px;
            border-radius: 9px;
            border: 1px solid rgba(189, 223, 255, 0.22);
            background: rgba(3, 10, 24, 0.54);
        }
        body.light .popup-nav {
            border-color: rgba(15, 23, 42, 0.12);
            background: rgba(15, 23, 42, 0.04);
        }
        .popup-nav-btn {
            width: 100%;
            height: 28px;
        }
        .android-nav-back {
            fill: currentColor;
            stroke: none;
        }
    </style>
</head>
<body class="${isLightMode ? "light" : ""}">
    <main class="popup-shell">
        <header class="popup-header">
            <p id="screenMirrorPopupTitle" class="popup-title">${escapeHtml(deviceName)}</p>
            <div class="popup-actions">
                <button id="screenMirrorPopupUnpinBtn" type="button" class="popup-icon-btn danger" title="Unpin" aria-label="Unpin">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M18 6 6 18"></path>
                        <path d="M6 6 18 18"></path>
                    </svg>
                </button>
            </div>
        </header>
        <div id="screenMirrorPopupPreviewWrap" class="popup-preview-wrap"></div>
        <nav class="popup-nav" aria-label="Android navigation controls">
            <button type="button" class="popup-nav-btn" data-popup-touch-target="back" title="Back" aria-label="Back">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path class="android-nav-back" d="M7 12 17 5v14z"></path>
                </svg>
            </button>
            <button type="button" class="popup-nav-btn" data-popup-touch-target="home" title="Home" aria-label="Home">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="5.2"></circle>
                </svg>
            </button>
            <button type="button" class="popup-nav-btn" data-popup-touch-target="recents" title="Recents" aria-label="Recents">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="7" y="7" width="10" height="10" rx="1.5"></rect>
                </svg>
            </button>
        </nav>
    </main>
</body>
</html>`;
        }

        function startPinnedScreenMirrorPopupMonitor() {
            if (pinnedScreenMirrorPopupMonitorId) {
                clearInterval(pinnedScreenMirrorPopupMonitorId);
            }
            pinnedScreenMirrorPopupMonitorId = setInterval(() => {
                if (pinnedScreenMirrorPopupWindow && pinnedScreenMirrorPopupWindow.closed) {
                    pinnedScreenMirrorPopupWindow = null;
                    if (pinnedScreenMirrorDeviceUid && !isClosingPinnedScreenMirrorPopup) {
                        unpinScreenMirrorDevice({ skipPopupClose: true });
                    }
                    clearInterval(pinnedScreenMirrorPopupMonitorId);
                    pinnedScreenMirrorPopupMonitorId = null;
                }
            }, 700);
        }

        function stopPinnedScreenMirrorPopupMonitor() {
            if (pinnedScreenMirrorPopupMonitorId) {
                clearInterval(pinnedScreenMirrorPopupMonitorId);
                pinnedScreenMirrorPopupMonitorId = null;
            }
        }

        function clearPinnedScreenMirrorPopupGestureState() {
            const previewWrap = screenMirrorPinnedPopupGestureState.previewWrap;
            const pointerId = screenMirrorPinnedPopupGestureState.pointerId;
            if (previewWrap && typeof previewWrap.releasePointerCapture === "function" && Number.isFinite(Number(pointerId))) {
                try {
                    previewWrap.releasePointerCapture(pointerId);
                } catch (_error) {
                    // ignore pointer release errors
                }
            }

            screenMirrorPinnedPopupGestureState.active = false;
            screenMirrorPinnedPopupGestureState.pointerId = null;
            screenMirrorPinnedPopupGestureState.previewWrap = null;
            screenMirrorPinnedPopupGestureState.startClientX = 0;
            screenMirrorPinnedPopupGestureState.startClientY = 0;
            screenMirrorPinnedPopupGestureState.startedAtMs = 0;
            screenMirrorPinnedPopupGestureState.startMappedPoint = null;
        }

        function getPinnedScreenMirrorPopupSourceSize(previewWrap) {
            if (!pinnedScreenMirrorDeviceUid) return null;
            const state = getScreenMirrorDeviceState(pinnedScreenMirrorDeviceUid);
            if (!state) return null;

            const explicitWidth = toValidPositiveInteger(state.frameWidth);
            const explicitHeight = toValidPositiveInteger(state.frameHeight);
            if (explicitWidth && explicitHeight) {
                return { width: explicitWidth, height: explicitHeight };
            }

            const previewVideo = previewWrap?.querySelector?.("video");
            const videoWidth = toValidPositiveInteger(previewVideo?.videoWidth);
            const videoHeight = toValidPositiveInteger(previewVideo?.videoHeight);
            if (videoWidth && videoHeight) {
                return { width: videoWidth, height: videoHeight };
            }

            return null;
        }

        function mapPinnedScreenMirrorPopupPoint(previewWrap, clientX, clientY) {
            if (!previewWrap || typeof previewWrap.getBoundingClientRect !== "function") return null;

            const sourceSize = getPinnedScreenMirrorPopupSourceSize(previewWrap);
            if (!sourceSize) return null;

            const previewRect = previewWrap.getBoundingClientRect();
            if (previewRect.width <= 0 || previewRect.height <= 0) {
                return null;
            }

            const drawScale = Math.min(
                previewRect.width / sourceSize.width,
                previewRect.height / sourceSize.height
            );
            if (!Number.isFinite(drawScale) || drawScale <= 0) {
                return null;
            }

            const drawnWidth = sourceSize.width * drawScale;
            const drawnHeight = sourceSize.height * drawScale;
            const offsetX = (previewRect.width - drawnWidth) / 2;
            const offsetY = (previewRect.height - drawnHeight) / 2;
            const localX = clientX - previewRect.left;
            const localY = clientY - previewRect.top;

            const insideDrawnImage =
                localX >= offsetX &&
                localX <= offsetX + drawnWidth &&
                localY >= offsetY &&
                localY <= offsetY + drawnHeight;
            if (!insideDrawnImage) {
                return null;
            }

            const normalizedX = (localX - offsetX) / drawnWidth;
            const normalizedY = (localY - offsetY) / drawnHeight;
            const mappedX = Math.min(
                sourceSize.width - 1,
                Math.max(0, Math.round(normalizedX * sourceSize.width))
            );
            const mappedY = Math.min(
                sourceSize.height - 1,
                Math.max(0, Math.round(normalizedY * sourceSize.height))
            );

            return {
                x: mappedX,
                y: mappedY,
                screenWidth: sourceSize.width,
                screenHeight: sourceSize.height
            };
        }

        function handlePinnedScreenMirrorPopupPointerDown(event) {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            if (!pinnedScreenMirrorDeviceUid || !activeScreenMirrorDeviceUids.has(pinnedScreenMirrorDeviceUid)) {
                return;
            }

            const previewWrap = event.currentTarget;
            const mappedStart = mapPinnedScreenMirrorPopupPoint(previewWrap, event.clientX, event.clientY);
            if (!mappedStart) return;

            clearPinnedScreenMirrorPopupGestureState();
            screenMirrorPinnedPopupGestureState.active = true;
            screenMirrorPinnedPopupGestureState.pointerId = event.pointerId;
            screenMirrorPinnedPopupGestureState.previewWrap = previewWrap;
            screenMirrorPinnedPopupGestureState.startClientX = event.clientX;
            screenMirrorPinnedPopupGestureState.startClientY = event.clientY;
            screenMirrorPinnedPopupGestureState.startedAtMs = Date.now();
            screenMirrorPinnedPopupGestureState.startMappedPoint = mappedStart;

            if (typeof previewWrap.setPointerCapture === "function") {
                try {
                    previewWrap.setPointerCapture(event.pointerId);
                } catch (_error) {
                    // ignore pointer capture errors
                }
            }

            event.preventDefault();
        }

        async function handlePinnedScreenMirrorPopupPointerUp(event) {
            if (!screenMirrorPinnedPopupGestureState.active) return;
            if (screenMirrorPinnedPopupGestureState.pointerId !== event.pointerId) return;

            const gestureStateSnapshot = {
                previewWrap: screenMirrorPinnedPopupGestureState.previewWrap,
                startClientX: screenMirrorPinnedPopupGestureState.startClientX,
                startClientY: screenMirrorPinnedPopupGestureState.startClientY,
                startedAtMs: screenMirrorPinnedPopupGestureState.startedAtMs,
                startMappedPoint: screenMirrorPinnedPopupGestureState.startMappedPoint
            };

            clearPinnedScreenMirrorPopupGestureState();
            if (!pinnedScreenMirrorDeviceUid || !activeScreenMirrorDeviceUids.has(pinnedScreenMirrorDeviceUid)) {
                return;
            }

            const mappedEnd = mapPinnedScreenMirrorPopupPoint(
                gestureStateSnapshot.previewWrap,
                event.clientX,
                event.clientY
            );
            const pointerDistance = Math.hypot(
                event.clientX - gestureStateSnapshot.startClientX,
                event.clientY - gestureStateSnapshot.startClientY
            );
            const endPointForTap = mappedEnd || gestureStateSnapshot.startMappedPoint;

            if (
                pointerDistance <= SCREEN_TOUCH_TAP_DISTANCE_THRESHOLD_PX &&
                endPointForTap
            ) {
                showScreenMirrorTapFeedback(
                    gestureStateSnapshot.previewWrap,
                    event.clientX,
                    event.clientY
                );
                await sendScreenRemoteCommandForDevice(
                    pinnedScreenMirrorDeviceUid,
                    {
                        action: "screen_touch",
                        type: "SCREEN_TOUCH",
                        x: endPointForTap.x,
                        y: endPointForTap.y,
                        screenWidth: endPointForTap.screenWidth,
                        screenHeight: endPointForTap.screenHeight
                    },
                    {
                        defaultErrorMessage: "Failed to send screen tap command",
                        showErrorToast: true
                    }
                );
                event.preventDefault();
                return;
            }

            if (!gestureStateSnapshot.startMappedPoint || !mappedEnd) {
                return;
            }

            const elapsedMs = Math.round(Date.now() - gestureStateSnapshot.startedAtMs);
            const durationMs = Math.max(
                SCREEN_TOUCH_MIN_SWIPE_DURATION_MS,
                Math.min(SCREEN_TOUCH_MAX_SWIPE_DURATION_MS, elapsedMs)
            );

            showScreenMirrorSwipeFeedback(
                gestureStateSnapshot.previewWrap,
                gestureStateSnapshot.startClientX,
                gestureStateSnapshot.startClientY,
                event.clientX,
                event.clientY
            );
            await sendScreenRemoteCommandForDevice(
                pinnedScreenMirrorDeviceUid,
                {
                    action: "screen_swipe",
                    type: "SCREEN_SWIPE",
                    startX: gestureStateSnapshot.startMappedPoint.x,
                    startY: gestureStateSnapshot.startMappedPoint.y,
                    endX: mappedEnd.x,
                    endY: mappedEnd.y,
                    durationMs,
                    screenWidth: mappedEnd.screenWidth,
                    screenHeight: mappedEnd.screenHeight
                },
                {
                    defaultErrorMessage: "Failed to send screen swipe command",
                    showErrorToast: true
                }
            );
            event.preventDefault();
        }

        function handlePinnedScreenMirrorPopupPointerCancel(event) {
            if (!screenMirrorPinnedPopupGestureState.active) return;
            if (screenMirrorPinnedPopupGestureState.pointerId !== event.pointerId) return;
            clearPinnedScreenMirrorPopupGestureState();
        }

        function bindPinnedScreenMirrorPopupEvents(popupWindow) {
            const popupDocument = popupWindow?.document;
            if (!popupDocument) return;

            const previewWrap = popupDocument.getElementById("screenMirrorPopupPreviewWrap");
            if (previewWrap) {
                previewWrap.addEventListener("pointerdown", handlePinnedScreenMirrorPopupPointerDown, { passive: false });
                previewWrap.addEventListener("pointerup", handlePinnedScreenMirrorPopupPointerUp, { passive: false });
                previewWrap.addEventListener("pointercancel", handlePinnedScreenMirrorPopupPointerCancel);
                previewWrap.addEventListener("dragstart", (event) => event.preventDefault());
            }

            const unpinButton = popupDocument.getElementById("screenMirrorPopupUnpinBtn");
            if (unpinButton) {
                unpinButton.addEventListener("click", () => {
                    unpinScreenMirrorDevice();
                });
            }

            popupDocument.querySelectorAll("[data-popup-touch-target]").forEach((button) => {
                button.addEventListener("click", async () => {
                    const touchTarget = String(button.getAttribute("data-popup-touch-target") || "").trim().toLowerCase();
                    const targetUid = normalizeDeviceUidInput(pinnedScreenMirrorDeviceUid);
                    if (!targetUid || !["back", "home", "recents"].includes(touchTarget)) return;

                    button.disabled = true;
                    try {
                        const sent = await sendScreenRemoteCommandForDevice(
                            targetUid,
                            {
                                action: "screen_touch",
                                type: "SCREEN_TOUCH",
                                touchTarget
                            },
                            {
                                defaultErrorMessage: `Failed to send ${touchTarget.toUpperCase()} command`,
                                showErrorToast: true
                            }
                        );
                        if (sent) {
                            showToast(`${touchTarget.toUpperCase()} command sent`, "success");
                            await loadCommands();
                        }
                    } finally {
                        button.disabled = false;
                    }
                });
            });
        }

        function openPinnedScreenMirrorPopup(deviceUid) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) return false;

            const deviceName = getScreenMirrorDeviceDisplayName(normalizedDeviceUid);
            const popupName = `autocall_mirror_${normalizedDeviceUid}`;
            const popupFeatures = [
                "popup=yes",
                "width=320",
                "height=620",
                "left=80",
                "top=80",
                "resizable=yes",
                "scrollbars=no"
            ].join(",");
            const popupWindow = window.open("", popupName, popupFeatures);
            if (!popupWindow) {
                showToast("Allow pop-ups for this site to pin the mirror in a new window", "error");
                return false;
            }

            pinnedScreenMirrorPopupWindow = popupWindow;
            isClosingPinnedScreenMirrorPopup = false;
            popupWindow.document.open();
            popupWindow.document.write(buildPinnedScreenMirrorPopupHtml(deviceName));
            popupWindow.document.close();
            bindPinnedScreenMirrorPopupEvents(popupWindow);
            startPinnedScreenMirrorPopupMonitor();

            try {
                popupWindow.focus();
            } catch (_error) {
                // ignore focus errors
            }
            return true;
        }

        function closePinnedScreenMirrorPopup() {
            clearPinnedScreenMirrorPopupGestureState();
            const popupWindow = getPinnedScreenMirrorPopup();
            stopPinnedScreenMirrorPopupMonitor();
            if (!popupWindow) return;

            isClosingPinnedScreenMirrorPopup = true;
            try {
                popupWindow.close();
            } catch (_error) {
                // ignore popup close errors
            }
            pinnedScreenMirrorPopupWindow = null;
            setTimeout(() => {
                isClosingPinnedScreenMirrorPopup = false;
            }, 0);
        }

        function applyPinnedScreenMirrorSizing() {
            const panel = getScreenMirrorPinnedPanel();
            const popupWindow = getPinnedScreenMirrorPopup();
            if (!pinnedScreenMirrorDeviceUid) return;

            const state = getScreenMirrorDeviceState(pinnedScreenMirrorDeviceUid);
            if (!state) return;

            const aspectRatio = getScreenMirrorTileAspectRatioValue(state);
            if (panel) {
                const normalizedWidth = getScreenMirrorTileWidth(pinnedScreenMirrorDeviceUid);
                panel.style.setProperty("--screen-mirror-pinned-width", `${normalizedWidth}px`);
                panel.style.setProperty("--screen-mirror-preview-ratio", aspectRatio);
            }
            if (popupWindow?.document?.documentElement) {
                popupWindow.document.documentElement.style.setProperty("--screen-mirror-preview-ratio", aspectRatio);
            }
        }

        function showPinnedScreenMirrorPanel() {
            const panel = getScreenMirrorPinnedPanel();
            if (!panel) return;

            if (screenMirrorPinnedCloseTimerId) {
                clearTimeout(screenMirrorPinnedCloseTimerId);
                screenMirrorPinnedCloseTimerId = null;
            }

            panel.classList.remove("panel-hidden");
            requestAnimationFrame(() => {
                panel.classList.add("is-visible");
            });
        }

        function hidePinnedScreenMirrorPanel(immediate = false) {
            const panel = getScreenMirrorPinnedPanel();
            if (!panel) return;

            if (screenMirrorPinnedCloseTimerId) {
                clearTimeout(screenMirrorPinnedCloseTimerId);
                screenMirrorPinnedCloseTimerId = null;
            }

            panel.classList.remove("is-visible");

            if (immediate) {
                panel.classList.add("panel-hidden");
                return;
            }

            screenMirrorPinnedCloseTimerId = setTimeout(() => {
                panel.classList.add("panel-hidden");
                screenMirrorPinnedCloseTimerId = null;
            }, SCREEN_MIRROR_PINNED_ANIMATION_MS);
        }

        function updateScreenMirrorPinButtons() {
            document.querySelectorAll("[data-mirror-action='pin']").forEach((button) => {
                if (!(button instanceof HTMLElement)) return;
                const deviceUid = normalizeDeviceUidInput(button.getAttribute("data-device-uid") || "");
                const isPinned = Boolean(deviceUid && deviceUid === pinnedScreenMirrorDeviceUid);
                button.classList.toggle("active", isPinned);
                button.setAttribute("aria-pressed", String(isPinned));
                button.setAttribute("title", isPinned ? "Pinned" : "Pin to corner");
                button.setAttribute("aria-label", isPinned ? "Pinned screen mirror" : "Pin screen mirror");
            });
        }

        function renderPinnedScreenMirror() {
            const popupWindow = getPinnedScreenMirrorPopup();
            const popupDocument = popupWindow?.document;
            const previewWrap = popupDocument?.getElementById("screenMirrorPopupPreviewWrap") ||
                getScreenMirrorPinnedPreviewWrap();
            if (!previewWrap || !pinnedScreenMirrorDeviceUid) return;

            const state = getScreenMirrorDeviceState(pinnedScreenMirrorDeviceUid);
            if (!state) return;

            const deviceName = getScreenMirrorDeviceDisplayName(pinnedScreenMirrorDeviceUid);
            const titleElement = popupDocument?.getElementById("screenMirrorPopupTitle") ||
                document.getElementById("screenMirrorPinnedTitle");

            if (popupDocument) {
                popupDocument.title = `${deviceName} • AutoCall Mirror`;
            }
            previewWrap.dataset.deviceUid = pinnedScreenMirrorDeviceUid;

            if (titleElement) {
                titleElement.textContent = deviceName;
                titleElement.setAttribute("title", deviceName);
            }

            let previewVideo = previewWrap.querySelector("video");
            if (!previewVideo) {
                clearScreenMirrorLastFrameFallbacksInside(previewWrap);
                previewWrap.innerHTML = `
                    <video
                        data-screen-mirror-video="${escapeHtml(pinnedScreenMirrorDeviceUid)}"
                        autoplay
                        playsinline
                        muted
                        aria-label="Pinned live mirrored screen for ${escapeHtml(deviceName)}"></video>`;
                previewVideo = previewWrap.querySelector("video");
            }
            if (previewVideo) {
                previewVideo.setAttribute("aria-label", `Pinned live mirrored screen for ${deviceName}`);
                attachScreenMirrorStreamToDeviceVideos(pinnedScreenMirrorDeviceUid);
            }

            applyPinnedScreenMirrorSizing();
            updateScreenMirrorPinButtons();
        }

        function pinScreenMirrorDevice(deviceUid) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid || !activeScreenMirrorDeviceUids.has(normalizedDeviceUid)) {
                showToast("Start Screen Mirror first", "error");
                return;
            }

            pinnedScreenMirrorDeviceUid = normalizedDeviceUid;
            joinScreenMirrorDashboardRoom(normalizedDeviceUid);
            const popupOpened = openPinnedScreenMirrorPopup(normalizedDeviceUid);
            if (!popupOpened) {
                pinnedScreenMirrorDeviceUid = "";
                updateScreenMirrorPinButtons();
                renderScreenMirrorMultiGrid();
                return;
            }
            renderPinnedScreenMirror();
            hidePinnedScreenMirrorPanel(true);
            updateScreenMirrorPinButtons();
            renderScreenMirrorMultiGrid();
        }

        function unpinScreenMirrorDevice(options = {}) {
            const previousPinnedUid = pinnedScreenMirrorDeviceUid;
            pinnedScreenMirrorDeviceUid = "";
            clearAllScreenMirrorMultiPointerGestures();
            clearPinnedScreenMirrorPopupGestureState();
            endScreenMirrorPinnedResize();
            hidePinnedScreenMirrorPanel(options.immediate === true);
            if (options.skipPopupClose !== true) {
                closePinnedScreenMirrorPopup();
            }
            updateScreenMirrorPinButtons();
            if (previousPinnedUid && options.renderGrid !== false) {
                renderScreenMirrorMultiGrid();
            }
        }

        function getScreenMirrorTilePreviewElement(previewWrap) {
            if (!(previewWrap instanceof Element)) return null;
            return previewWrap.querySelector(".screen-mirror-tile-preview");
        }

        function updateScreenMirrorTileFrameSizeFromVideo(deviceUid, videoElement) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid || !videoElement) return;
            const videoWidth = toValidPositiveInteger(videoElement.videoWidth);
            const videoHeight = toValidPositiveInteger(videoElement.videoHeight);
            if (!videoWidth || !videoHeight) return;

            const state = getScreenMirrorDeviceState(normalizedDeviceUid);
            if (!state) return;
            if (state.frameWidth === videoWidth && state.frameHeight === videoHeight) return;
            state.frameWidth = videoWidth;
            state.frameHeight = videoHeight;
            applyScreenMirrorTileSizing(normalizedDeviceUid);
        }

        function getScreenMirrorTileDeviceUid(previewWrap) {
            if (!(previewWrap instanceof HTMLElement)) return "";
            const fromDataset = normalizeDeviceUidInput(previewWrap.dataset.deviceUid || "");
            if (fromDataset) return fromDataset;
            const tile = previewWrap.closest(".screen-mirror-device-tile");
            return normalizeDeviceUidInput(tile?.getAttribute("data-device-uid") || "");
        }

        function getScreenMirrorTileSourceSize(previewWrap, deviceUid) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) return null;
            const state = getScreenMirrorDeviceState(normalizedDeviceUid);
            if (!state) return null;

            const explicitWidth = toValidPositiveInteger(state.frameWidth);
            const explicitHeight = toValidPositiveInteger(state.frameHeight);
            if (explicitWidth && explicitHeight) {
                return { width: explicitWidth, height: explicitHeight };
            }

            const previewVideo = getScreenMirrorTilePreviewElement(previewWrap);
            const videoWidth = toValidPositiveInteger(previewVideo?.videoWidth);
            const videoHeight = toValidPositiveInteger(previewVideo?.videoHeight);
            if (videoWidth && videoHeight) {
                return { width: videoWidth, height: videoHeight };
            }

            return null;
        }

        function mapScreenMirrorTileClientPointToDevicePoint(previewWrap, deviceUid, clientX, clientY) {
            const previewVideo = getScreenMirrorTilePreviewElement(previewWrap);
            if (!previewVideo) return null;
            const sourceSize = getScreenMirrorTileSourceSize(previewWrap, deviceUid);
            if (!sourceSize) return null;

            const videoRect = previewVideo.getBoundingClientRect();
            if (videoRect.width <= 0 || videoRect.height <= 0) {
                return null;
            }

            const drawScale = Math.min(
                videoRect.width / sourceSize.width,
                videoRect.height / sourceSize.height
            );
            if (!Number.isFinite(drawScale) || drawScale <= 0) {
                return null;
            }

            const drawnWidth = sourceSize.width * drawScale;
            const drawnHeight = sourceSize.height * drawScale;
            const offsetX = (videoRect.width - drawnWidth) / 2;
            const offsetY = (videoRect.height - drawnHeight) / 2;
            const localX = clientX - videoRect.left;
            const localY = clientY - videoRect.top;

            if (
                localX < offsetX ||
                localX > offsetX + drawnWidth ||
                localY < offsetY ||
                localY > offsetY + drawnHeight
            ) {
                return null;
            }

            const normalizedX = (localX - offsetX) / drawnWidth;
            const normalizedY = (localY - offsetY) / drawnHeight;
            const mappedX = Math.min(
                sourceSize.width - 1,
                Math.max(0, Math.round(normalizedX * sourceSize.width))
            );
            const mappedY = Math.min(
                sourceSize.height - 1,
                Math.max(0, Math.round(normalizedY * sourceSize.height))
            );

            return {
                x: mappedX,
                y: mappedY,
                screenWidth: sourceSize.width,
                screenHeight: sourceSize.height
            };
        }

        async function sendScreenRemoteCommandForDevice(deviceUid, payload, options = {}) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) {
                return false;
            }
            const defaultErrorMessage =
                typeof options.defaultErrorMessage === "string" && options.defaultErrorMessage.trim()
                    ? options.defaultErrorMessage.trim()
                    : "Failed to send screen control command";
            const showErrorToast = options.showErrorToast !== false;

            try {
                const response = await apiFetch("/commands", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        ...payload,
                        deviceUid: normalizedDeviceUid,
                        isImmediate: true
                    })
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(parseApiErrorMessage(data, defaultErrorMessage));
                }
                return true;
            } catch (error) {
                if (showErrorToast) {
                    showToast(error.message || defaultErrorMessage, "error");
                }
                return false;
            }
        }

        function clearScreenMirrorMultiPointerGesture(pointerId) {
            if (!Number.isFinite(Number(pointerId))) return;
            const gestureState = screenMirrorMultiPointerGestureById.get(pointerId);
            if (!gestureState) return;
            const previewWrap = gestureState.previewWrap;
            if (previewWrap && typeof previewWrap.releasePointerCapture === "function") {
                try {
                    previewWrap.releasePointerCapture(pointerId);
                } catch (_error) {
                    // ignore pointer release errors
                }
            }
            screenMirrorMultiPointerGestureById.delete(pointerId);
        }

        function clearAllScreenMirrorMultiPointerGestures() {
            [...screenMirrorMultiPointerGestureById.keys()].forEach((pointerId) => {
                clearScreenMirrorMultiPointerGesture(pointerId);
            });
        }

        function handleMultiScreenMirrorPreviewPointerDown(event) {
            const previewWrap = event.currentTarget;
            if (!(previewWrap instanceof HTMLElement)) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;
            const deviceUid = getScreenMirrorTileDeviceUid(previewWrap);
            if (!deviceUid || !activeScreenMirrorDeviceUids.has(deviceUid)) {
                return;
            }

            const mappedStart = mapScreenMirrorTileClientPointToDevicePoint(
                previewWrap,
                deviceUid,
                event.clientX,
                event.clientY
            );
            if (!mappedStart) return;

            screenMirrorMultiPointerGestureById.set(event.pointerId, {
                previewWrap,
                deviceUid,
                startClientX: event.clientX,
                startClientY: event.clientY,
                startedAtMs: Date.now(),
                startMappedPoint: mappedStart
            });

            if (typeof previewWrap.setPointerCapture === "function") {
                try {
                    previewWrap.setPointerCapture(event.pointerId);
                } catch (_error) {
                    // ignore pointer capture errors
                }
            }

            event.preventDefault();
        }

        async function handleMultiScreenMirrorPreviewPointerUp(event) {
            const gestureState = screenMirrorMultiPointerGestureById.get(event.pointerId);
            if (!gestureState) return;

            clearScreenMirrorMultiPointerGesture(event.pointerId);
            const { previewWrap, deviceUid, startClientX, startClientY, startedAtMs, startMappedPoint } = gestureState;
            if (!deviceUid || !activeScreenMirrorDeviceUids.has(deviceUid)) {
                return;
            }

            const mappedEnd = mapScreenMirrorTileClientPointToDevicePoint(
                previewWrap,
                deviceUid,
                event.clientX,
                event.clientY
            );
            const pointerDistance = Math.hypot(
                event.clientX - startClientX,
                event.clientY - startClientY
            );
            const endPointForTap = mappedEnd || startMappedPoint;

            if (
                pointerDistance <= SCREEN_TOUCH_TAP_DISTANCE_THRESHOLD_PX &&
                endPointForTap
            ) {
                showScreenMirrorTapFeedback(previewWrap, event.clientX, event.clientY);
                await sendScreenRemoteCommandForDevice(
                    deviceUid,
                    {
                        action: "screen_touch",
                        type: "SCREEN_TOUCH",
                        x: endPointForTap.x,
                        y: endPointForTap.y,
                        screenWidth: endPointForTap.screenWidth,
                        screenHeight: endPointForTap.screenHeight
                    },
                    {
                        defaultErrorMessage: "Failed to send screen tap command",
                        showErrorToast: true
                    }
                );
                event.preventDefault();
                return;
            }

            if (!startMappedPoint || !mappedEnd) {
                return;
            }

            const elapsedMs = Math.round(Date.now() - startedAtMs);
            const durationMs = Math.max(
                SCREEN_TOUCH_MIN_SWIPE_DURATION_MS,
                Math.min(SCREEN_TOUCH_MAX_SWIPE_DURATION_MS, elapsedMs)
            );
            showScreenMirrorSwipeFeedback(
                previewWrap,
                startClientX,
                startClientY,
                event.clientX,
                event.clientY
            );
            await sendScreenRemoteCommandForDevice(
                deviceUid,
                {
                    action: "screen_swipe",
                    type: "SCREEN_SWIPE",
                    startX: startMappedPoint.x,
                    startY: startMappedPoint.y,
                    endX: mappedEnd.x,
                    endY: mappedEnd.y,
                    durationMs,
                    screenWidth: mappedEnd.screenWidth,
                    screenHeight: mappedEnd.screenHeight
                },
                {
                    defaultErrorMessage: "Failed to send screen swipe command",
                    showErrorToast: true
                }
            );
            event.preventDefault();
        }

        function handleMultiScreenMirrorPreviewPointerCancel(event) {
            clearScreenMirrorMultiPointerGesture(event.pointerId);
        }

        function endScreenMirrorTileResize(event) {
            if (!screenMirrorTileResizeState.active) return;
            if (event && Number.isFinite(Number(event.pointerId))) {
                if (screenMirrorTileResizeState.pointerId !== event.pointerId) {
                    return;
                }
            }

            const handle = screenMirrorTileResizeState.handle;
            const pointerId = screenMirrorTileResizeState.pointerId;
            if (handle && typeof handle.releasePointerCapture === "function" && Number.isFinite(Number(pointerId))) {
                try {
                    handle.releasePointerCapture(pointerId);
                } catch (_error) {
                    // ignore pointer release errors
                }
            }

            if (screenMirrorTileResizeState.tile instanceof HTMLElement) {
                screenMirrorTileResizeState.tile.classList.remove("is-resizing");
            }

            screenMirrorTileResizeState.active = false;
            screenMirrorTileResizeState.pointerId = null;
            screenMirrorTileResizeState.deviceUid = "";
            screenMirrorTileResizeState.startClientX = 0;
            screenMirrorTileResizeState.startClientY = 0;
            screenMirrorTileResizeState.startWidth = SCREEN_MIRROR_TILE_WIDTH_DEFAULT;
            screenMirrorTileResizeState.handle = null;
            screenMirrorTileResizeState.tile = null;

            window.removeEventListener("pointermove", handleScreenMirrorTileResizeMove);
            window.removeEventListener("pointerup", endScreenMirrorTileResize);
            window.removeEventListener("pointercancel", endScreenMirrorTileResize);
        }

        function handleScreenMirrorTileResizeMove(event) {
            if (!screenMirrorTileResizeState.active) return;
            if (screenMirrorTileResizeState.pointerId !== event.pointerId) return;

            const deltaX = event.clientX - screenMirrorTileResizeState.startClientX;
            const deltaY = event.clientY - screenMirrorTileResizeState.startClientY;
            const dominantDelta =
                Math.abs(deltaX) >= Math.abs(deltaY)
                    ? deltaX
                    : deltaY;
            const nextWidth = screenMirrorTileResizeState.startWidth + dominantDelta;
            applyScreenMirrorTileWidth(screenMirrorTileResizeState.deviceUid, nextWidth);
            event.preventDefault();
        }

        function startScreenMirrorTileResize(event) {
            const handle = event.currentTarget;
            if (!(handle instanceof HTMLElement)) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;

            const targetUid = normalizeDeviceUidInput(handle.getAttribute("data-device-uid") || "");
            if (!targetUid) return;

            endScreenMirrorTileResize();
            const tile = handle.closest(".screen-mirror-device-tile");
            const startWidth = getScreenMirrorTileWidth(targetUid);

            screenMirrorTileResizeState.active = true;
            screenMirrorTileResizeState.pointerId = event.pointerId;
            screenMirrorTileResizeState.deviceUid = targetUid;
            screenMirrorTileResizeState.startClientX = event.clientX;
            screenMirrorTileResizeState.startClientY = event.clientY;
            screenMirrorTileResizeState.startWidth = startWidth;
            screenMirrorTileResizeState.handle = handle;
            screenMirrorTileResizeState.tile = tile instanceof HTMLElement ? tile : null;

            if (screenMirrorTileResizeState.tile instanceof HTMLElement) {
                screenMirrorTileResizeState.tile.classList.add("is-resizing");
            }

            if (typeof handle.setPointerCapture === "function") {
                try {
                    handle.setPointerCapture(event.pointerId);
                } catch (_error) {
                    // ignore pointer capture errors
                }
            }

            window.addEventListener("pointermove", handleScreenMirrorTileResizeMove, { passive: false });
            window.addEventListener("pointerup", endScreenMirrorTileResize);
            window.addEventListener("pointercancel", endScreenMirrorTileResize);
            event.preventDefault();
            event.stopPropagation();
        }

        function endScreenMirrorPinnedResize(event) {
            if (!screenMirrorPinnedResizeState.active) return;
            if (event && Number.isFinite(Number(event.pointerId))) {
                if (screenMirrorPinnedResizeState.pointerId !== event.pointerId) {
                    return;
                }
            }

            const handle = screenMirrorPinnedResizeState.handle;
            const pointerId = screenMirrorPinnedResizeState.pointerId;
            if (handle && typeof handle.releasePointerCapture === "function" && Number.isFinite(Number(pointerId))) {
                try {
                    handle.releasePointerCapture(pointerId);
                } catch (_error) {
                    // ignore pointer release errors
                }
            }

            const panel = getScreenMirrorPinnedPanel();
            if (panel) {
                panel.classList.remove("is-resizing");
            }

            screenMirrorPinnedResizeState.active = false;
            screenMirrorPinnedResizeState.pointerId = null;
            screenMirrorPinnedResizeState.deviceUid = "";
            screenMirrorPinnedResizeState.startClientX = 0;
            screenMirrorPinnedResizeState.startClientY = 0;
            screenMirrorPinnedResizeState.startWidth = SCREEN_MIRROR_TILE_WIDTH_DEFAULT;
            screenMirrorPinnedResizeState.handle = null;

            window.removeEventListener("pointermove", handleScreenMirrorPinnedResizeMove);
            window.removeEventListener("pointerup", endScreenMirrorPinnedResize);
            window.removeEventListener("pointercancel", endScreenMirrorPinnedResize);
        }

        function handleScreenMirrorPinnedResizeMove(event) {
            if (!screenMirrorPinnedResizeState.active) return;
            if (screenMirrorPinnedResizeState.pointerId !== event.pointerId) return;

            const deltaX = event.clientX - screenMirrorPinnedResizeState.startClientX;
            const deltaY = screenMirrorPinnedResizeState.startClientY - event.clientY;
            const dominantDelta =
                Math.abs(deltaX) >= Math.abs(deltaY)
                    ? deltaX
                    : deltaY;
            const nextWidth = screenMirrorPinnedResizeState.startWidth + dominantDelta;
            applyScreenMirrorTileWidth(screenMirrorPinnedResizeState.deviceUid, nextWidth);
            event.preventDefault();
        }

        function startScreenMirrorPinnedResize(event) {
            const handle = event.currentTarget;
            if (!(handle instanceof HTMLElement)) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;

            const targetUid = normalizeDeviceUidInput(pinnedScreenMirrorDeviceUid);
            if (!targetUid) return;

            endScreenMirrorPinnedResize();

            screenMirrorPinnedResizeState.active = true;
            screenMirrorPinnedResizeState.pointerId = event.pointerId;
            screenMirrorPinnedResizeState.deviceUid = targetUid;
            screenMirrorPinnedResizeState.startClientX = event.clientX;
            screenMirrorPinnedResizeState.startClientY = event.clientY;
            screenMirrorPinnedResizeState.startWidth = getScreenMirrorTileWidth(targetUid);
            screenMirrorPinnedResizeState.handle = handle;

            const panel = getScreenMirrorPinnedPanel();
            if (panel) {
                panel.classList.add("is-resizing");
            }

            if (typeof handle.setPointerCapture === "function") {
                try {
                    handle.setPointerCapture(event.pointerId);
                } catch (_error) {
                    // ignore pointer capture errors
                }
            }

            window.addEventListener("pointermove", handleScreenMirrorPinnedResizeMove, { passive: false });
            window.addEventListener("pointerup", endScreenMirrorPinnedResize);
            window.addEventListener("pointercancel", endScreenMirrorPinnedResize);
            event.preventDefault();
            event.stopPropagation();
        }

        function renderScreenMirrorMultiGrid() {
            const grid = getScreenMirrorMultiGridElement();
            const hint = document.getElementById("screenMirrorMultiHint");
            const screenMirrorCard = document.getElementById("screenMirrorCard");
            if (!grid || !screenMirrorCard) return;

            const activeSortedUids = [...activeScreenMirrorDeviceUids].sort((leftUid, rightUid) =>
                getScreenMirrorDeviceDisplayName(leftUid).localeCompare(
                    getScreenMirrorDeviceDisplayName(rightUid),
                    undefined,
                    { sensitivity: "base" }
                )
            );
            const sortedUids = activeSortedUids.filter((deviceUid) => deviceUid !== pinnedScreenMirrorDeviceUid);

            if (activeSortedUids.length === 0) {
                clearAllScreenMirrorMultiPointerGestures();
                endScreenMirrorTileResize();
                unpinScreenMirrorDevice({ immediate: true, renderGrid: false });
                clearScreenMirrorLastFrameFallbacksInside(grid);
                grid.innerHTML = "";
                if (hint) {
                    hint.textContent = "Use the mirror icon from the device list to start live view.";
                }
                hideScreenMirrorCard(false);
                return;
            }

            if (sortedUids.length === 0) {
                clearAllScreenMirrorMultiPointerGestures();
                endScreenMirrorTileResize();
                clearScreenMirrorLastFrameFallbacksInside(grid);
                grid.innerHTML = "";
                if (hint) {
                    hint.textContent = "Pinned mirror is open in the corner.";
                }
                hideScreenMirrorCard(false);
                updateScreenMirrorPinButtons();
                return;
            }

            openScreenMirrorCard(true);

            if (hint) {
                hint.textContent = `${sortedUids.length} active mirror session${sortedUids.length > 1 ? "s" : ""}.`;
            }

            const tilesHtml = sortedUids.map((deviceUid) => {
                const state = getScreenMirrorDeviceState(deviceUid) || {
                    status: "idle",
                    frameCount: 0,
                    lastFrameAt: "--"
                };
                const deviceName = getScreenMirrorDeviceDisplayName(deviceUid);
                const statusText = toNonEmptyString(state.status).toLowerCase() || "idle";
                const statusClass = escapeHtml(statusText.replace(/[^a-z0-9_-]/g, ""));
                const tileWidth = getScreenMirrorTileWidth(deviceUid);
                const tileAspectRatio = getScreenMirrorTileAspectRatioValue(state);
                const isPinned = pinnedScreenMirrorDeviceUid === deviceUid;
                const previewContent = `
                    <video
                        class="screen-mirror-tile-preview"
                        data-screen-mirror-video="${escapeHtml(deviceUid)}"
                        autoplay
                        playsinline
                        muted
                        aria-label="Live mirrored screen for ${escapeHtml(deviceName)}"></video>`;

                return `
                    <div
                        class="screen-mirror-device-tile"
                        data-device-uid="${escapeHtml(deviceUid)}"
                        style="--screen-mirror-tile-width:${tileWidth}px;--screen-mirror-preview-ratio:${escapeHtml(tileAspectRatio)};">
                        <div class="screen-mirror-device-head">
                            <div class="screen-mirror-device-labels">
                                <p class="screen-mirror-device-name" title="${escapeHtml(deviceName)}">${escapeHtml(deviceName)}</p>
                                <p class="screen-mirror-device-uid">${escapeHtml(deviceUid)}</p>
                            </div>
                            <div class="screen-mirror-device-actions">
                                <button
                                    type="button"
                                    class="screen-mirror-tile-btn pin ${isPinned ? "active" : ""}"
                                    data-mirror-action="pin"
                                    data-device-uid="${escapeHtml(deviceUid)}"
                                    title="${isPinned ? "Pinned" : "Pin to corner"}"
                                    aria-label="${isPinned ? "Pinned screen mirror" : "Pin screen mirror"}"
                                    aria-pressed="${isPinned ? "true" : "false"}">
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M14 4 20 10"></path>
                                        <path d="M7 11 13 5"></path>
                                        <path d="M5 19 11 13"></path>
                                        <path d="M9 9 15 15"></path>
                                    </svg>
                                </button>
                                <button
                                    type="button"
                                    class="screen-mirror-tile-btn danger"
                                    data-mirror-action="stop"
                                    data-device-uid="${escapeHtml(deviceUid)}"
                                    title="Stop mirror"
                                    aria-label="Stop mirror">
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M8 8h3v4"></path>
                                        <path d="M16 16h-3v-4"></path>
                                        <path d="M11 10h2a2 2 0 0 1 2 2"></path>
                                        <path d="M13 14h-2a2 2 0 0 1-2-2"></path>
                                        <path d="M3 3 21 21"></path>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <div
                            class="screen-mirror-tile-preview-wrap"
                            data-mirror-field="previewWrap"
                            data-device-uid="${escapeHtml(deviceUid)}">
                            ${previewContent}
                        </div>
                        <div class="screen-mirror-system-nav" aria-label="Android navigation controls for ${escapeHtml(deviceName)}">
                            <button
                                type="button"
                                class="screen-mirror-system-nav-btn"
                                data-mirror-action="global-action"
                                data-device-uid="${escapeHtml(deviceUid)}"
                                data-touch-target="back"
                                title="Back"
                                aria-label="Back">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path class="android-nav-back" d="M7 12 17 5v14z"></path>
                                </svg>
                            </button>
                            <button
                                type="button"
                                class="screen-mirror-system-nav-btn"
                                data-mirror-action="global-action"
                                data-device-uid="${escapeHtml(deviceUid)}"
                                data-touch-target="home"
                                title="Home"
                                aria-label="Home">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <circle cx="12" cy="12" r="5.2"></circle>
                                </svg>
                            </button>
                            <button
                                type="button"
                                class="screen-mirror-system-nav-btn"
                                data-mirror-action="global-action"
                                data-device-uid="${escapeHtml(deviceUid)}"
                                data-touch-target="recents"
                                title="Recents"
                                aria-label="Recents">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <rect x="7" y="7" width="10" height="10" rx="1.5"></rect>
                                </svg>
                            </button>
                        </div>
                        <div class="screen-mirror-device-meta">
                            <span class="screen-mirror-device-status ${statusClass}" data-mirror-field="status">${escapeHtml(statusText)}</span>
                        </div>
                        <button
                            type="button"
                            class="screen-mirror-tile-resize-handle"
                            data-mirror-action="resize-tile"
                            data-device-uid="${escapeHtml(deviceUid)}"
                            title="Drag corner to resize screen preview"
                            aria-label="Resize mirrored screen preview for ${escapeHtml(deviceName)}"></button>
                    </div>
                `;
            }).join("");

            clearAllScreenMirrorMultiPointerGestures();
            endScreenMirrorTileResize();
            clearScreenMirrorLastFrameFallbacksInside(grid);
            grid.innerHTML = tilesHtml;

            grid.querySelectorAll("[data-mirror-action='stop']").forEach((button) => {
                button.addEventListener("click", async () => {
                    const targetUid = normalizeDeviceUidInput(button.getAttribute("data-device-uid") || "");
                    if (!targetUid) return;
                    button.disabled = true;
                    try {
                        await stopActiveScreenMirror(targetUid, { removeAfterStop: true });
                    } finally {
                        button.disabled = false;
                    }
                });
            });

            grid.querySelectorAll("[data-mirror-action='pin']").forEach((button) => {
                button.addEventListener("click", () => {
                    const targetUid = normalizeDeviceUidInput(button.getAttribute("data-device-uid") || "");
                    if (!targetUid) return;
                    pinScreenMirrorDevice(targetUid);
                });
            });

            grid.querySelectorAll("[data-mirror-action='global-action']").forEach((button) => {
                button.addEventListener("click", async () => {
                    const targetUid = normalizeDeviceUidInput(button.getAttribute("data-device-uid") || "");
                    const touchTarget = String(button.getAttribute("data-touch-target") || "").trim().toLowerCase();
                    if (!targetUid || !["back", "home", "recents"].includes(touchTarget)) return;

                    button.disabled = true;
                    try {
                        const sent = await sendScreenRemoteCommandForDevice(
                            targetUid,
                            {
                                action: "screen_touch",
                                type: "SCREEN_TOUCH",
                                touchTarget
                            },
                            {
                                defaultErrorMessage: `Failed to send ${touchTarget.toUpperCase()} command`,
                                showErrorToast: true
                            }
                        );
                        if (sent) {
                            showToast(`${touchTarget.toUpperCase()} command sent`, "success");
                            await loadCommands();
                        }
                    } finally {
                        button.disabled = false;
                    }
                });
            });

            grid.querySelectorAll("[data-mirror-action='resize-tile']").forEach((handle) => {
                if (!(handle instanceof HTMLElement)) return;
                handle.addEventListener("pointerdown", startScreenMirrorTileResize, { passive: false });
            });

            grid.querySelectorAll("[data-mirror-field='previewWrap']").forEach((previewWrap) => {
                if (!(previewWrap instanceof HTMLElement)) return;
                previewWrap.addEventListener("pointerdown", handleMultiScreenMirrorPreviewPointerDown, { passive: false });
                previewWrap.addEventListener("pointerup", handleMultiScreenMirrorPreviewPointerUp, { passive: false });
                previewWrap.addEventListener("pointercancel", handleMultiScreenMirrorPreviewPointerCancel);
                previewWrap.addEventListener("dragstart", (event) => event.preventDefault());
            });
            attachAllScreenMirrorVideos();
            updateScreenMirrorPinButtons();
        }

        function updateScreenMirrorMultiTile(deviceUid) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) return;
            const isPinnedDevice = pinnedScreenMirrorDeviceUid === normalizedDeviceUid;
            if (isPinnedDevice) {
                renderPinnedScreenMirror();
                return;
            }
            const grid = getScreenMirrorMultiGridElement();
            if (!grid) {
                return;
            }

            const tile = grid.querySelector(`.screen-mirror-device-tile[data-device-uid="${normalizedDeviceUid}"]`);
            if (!tile) {
                renderScreenMirrorMultiGrid();
                return;
            }

            const state = getScreenMirrorDeviceState(normalizedDeviceUid);
            if (!state) return;
            const statusText = toNonEmptyString(state.status).toLowerCase() || "idle";
            const statusClass = statusText.replace(/[^a-z0-9_-]/g, "");
            applyScreenMirrorTileSizing(normalizedDeviceUid);

            const previewWrap = tile.querySelector("[data-mirror-field='previewWrap']");
            if (previewWrap) {
                let previewVideo = previewWrap.querySelector(".screen-mirror-tile-preview");
                if (!isScreenMirrorVideoElement(previewVideo)) {
                    clearScreenMirrorLastFrameFallbacksInside(previewWrap);
                    previewWrap.innerHTML = `
                        <video
                            class="screen-mirror-tile-preview"
                            data-screen-mirror-video="${escapeHtml(normalizedDeviceUid)}"
                            autoplay
                            playsinline
                            muted
                            aria-label="Live mirrored screen for ${escapeHtml(getScreenMirrorDeviceDisplayName(normalizedDeviceUid))}"></video>`;
                    previewVideo = previewWrap.querySelector(".screen-mirror-tile-preview");
                }
                if (isScreenMirrorVideoElement(previewVideo)) {
                    updateScreenMirrorTileFrameSizeFromVideo(normalizedDeviceUid, previewVideo);
                    attachScreenMirrorStreamToDeviceVideos(normalizedDeviceUid);
                }
            }

            const statusElement = tile.querySelector("[data-mirror-field='status']");
            if (statusElement) {
                statusElement.className = `screen-mirror-device-status ${statusClass}`;
                statusElement.textContent = statusText;
            }
        }

        function applyMultiScreenMirrorStatus(payload = {}) {
            const deviceUid = normalizeDeviceUidInput(payload?.deviceUid || "");
            if (!deviceUid || !activeScreenMirrorDeviceUids.has(deviceUid)) {
                return;
            }

            const state = getScreenMirrorDeviceState(deviceUid);
            if (!state) return;

            state.status =
                typeof payload.status === "string" && payload.status.trim()
                    ? payload.status.trim().toLowerCase()
                    : state.status || "idle";
            if (Number.isFinite(Number(payload.frameCount))) {
                state.frameCount = Math.max(0, Math.round(Number(payload.frameCount)));
            }
            const payloadWidth = Number(payload?.width);
            const payloadHeight = Number(payload?.height);
            if (
                Number.isFinite(payloadWidth) &&
                Number.isFinite(payloadHeight) &&
                payloadWidth > 0 &&
                payloadHeight > 0
            ) {
                state.frameWidth = Math.max(1, Math.round(payloadWidth));
                state.frameHeight = Math.max(1, Math.round(payloadHeight));
            }

            const rawLastFrame = payload.lastFrameAt ?? payload.timestamp ?? null;
            if (rawLastFrame !== null && rawLastFrame !== undefined && rawLastFrame !== "") {
                const parsed = new Date(rawLastFrame);
                if (!Number.isNaN(parsed.getTime())) {
                    state.lastFrameAt = parsed.toLocaleString();
                }
            }
            state.updatedAt = Date.now();
            updateScreenMirrorMultiTile(deviceUid);

            if (shouldStartWebRtcForStatus(state.status)) {
                void startWebRtcViewerForDevice(deviceUid);
            } else if (["stopped", "error", "idle"].includes(state.status)) {
                closeScreenMirrorPeerConnection(deviceUid, { notify: false });
                clearScreenMirrorLastFrameCache(deviceUid);
            }
        }

        async function sendScreenMirrorCommandForDevice(deviceUid, action, type, options = {}) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) {
                throw new Error("Invalid device UID");
            }

            joinScreenMirrorDashboardRoom(normalizedDeviceUid);
            const response = await apiFetch("/commands", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    action,
                    type,
                    deviceUid: normalizedDeviceUid,
                    isImmediate: true
                })
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(parseApiErrorMessage(payload, options.defaultErrorMessage || "Failed to send screen mirror command"));
            }
            return payload;
        }

        async function startMirrorFromDeviceDropdown(deviceUid) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) {
                showToast("Invalid device UID", "error");
                return;
            }

            if (!activeScreenMirrorDeviceUids.has(normalizedDeviceUid)) {
                activeScreenMirrorDeviceUids.add(normalizedDeviceUid);
            }
            clearScreenMirrorLastFrameCache(normalizedDeviceUid);
            closeScreenMirrorPeerConnection(normalizedDeviceUid, { notify: false });
            const state = getScreenMirrorDeviceState(normalizedDeviceUid);
            if (state) {
                state.status = "starting";
                state.frameCount = 0;
                state.lastFrameAt = "--";
                state.frameWidth = 0;
                state.frameHeight = 0;
                state.firstFrameRetryCount = 0;
                state.updatedAt = Date.now();
            }
            renderScreenMirrorMultiGrid();
            openScreenMirrorCard(true);

            try {
                await sendScreenMirrorCommandForDevice(
                    normalizedDeviceUid,
                    "start_screen_mirror",
                    "START_SCREEN_MIRROR",
                    { defaultErrorMessage: "Failed to start screen mirror" }
                );
                showToast(`Mirror started for ${normalizedDeviceUid}`, "success");
                await loadCommands();
            } catch (error) {
                activeScreenMirrorDeviceUids.delete(normalizedDeviceUid);
                renderScreenMirrorMultiGrid();
                showToast(error.message || "Failed to start screen mirror", "error");
            }
        }

        async function stopActiveScreenMirror(deviceUid, options = {}) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) {
                return;
            }
            const removeAfterStop = options.removeAfterStop !== false;
            const state = getScreenMirrorDeviceState(normalizedDeviceUid);
            if (state) {
                state.status = "stopping";
                state.updatedAt = Date.now();
            }
            closeScreenMirrorPeerConnection(normalizedDeviceUid, { notify: true });
            renderScreenMirrorMultiGrid();
            if (pinnedScreenMirrorDeviceUid === normalizedDeviceUid) {
                renderPinnedScreenMirror();
            }

            try {
                await sendScreenMirrorCommandForDevice(
                    normalizedDeviceUid,
                    "stop_screen_mirror",
                    "STOP_SCREEN_MIRROR",
                    { defaultErrorMessage: "Failed to stop screen mirror" }
                );
                if (removeAfterStop) {
                    activeScreenMirrorDeviceUids.delete(normalizedDeviceUid);
                    closeScreenMirrorPeerConnection(normalizedDeviceUid, { notify: false });
                    clearScreenMirrorLastFrameCache(normalizedDeviceUid);
                    if (pinnedScreenMirrorDeviceUid === normalizedDeviceUid) {
                        unpinScreenMirrorDevice({ renderGrid: false });
                    }
                }
                showToast(`Mirror stopped for ${normalizedDeviceUid}`, "success");
                await loadCommands();
            } catch (error) {
                showToast(error.message || "Failed to stop screen mirror", "error");
            } finally {
                renderScreenMirrorMultiGrid();
            }
        }

        async function stopAllActiveScreenMirrors() {
            const deviceUids = [...activeScreenMirrorDeviceUids];
            if (deviceUids.length === 0) {
                showToast("No active mirror sessions", "error");
                return;
            }

            for (const deviceUid of deviceUids) {
                await stopActiveScreenMirror(deviceUid, { removeAfterStop: true });
            }
        }

        function getScreenMirrorViewerNode() {
            return document.getElementById("screenMirrorViewerNode");
        }

        function getScreenMirrorViewerDockSlot() {
            return document.getElementById("screenMirrorViewerDockSlot");
        }

        function getScreenMirrorViewerFloatingSlot() {
            return document.getElementById("screenMirrorFloatingBody");
        }

        function getScreenMirrorFloatingPanel() {
            return document.getElementById("screenMirrorFloatingPanel");
        }

        function getScreenMirrorFloatingHeader() {
            return document.getElementById("screenMirrorFloatingHeader");
        }

        function getScreenMirrorFloatingResizeHandle() {
            return document.getElementById("screenMirrorFloatingResizeHandle");
        }

        function getScreenMirrorPinToggleButton() {
            return document.getElementById("screenMirrorPinToggleBtn");
        }

        function getScreenMirrorStartStopButton() {
            return document.getElementById("screenMirrorStartStopBtn");
        }

        function updateScreenMirrorCardToggleButtonState(isVisible) {
            const headerButton = document.getElementById("screenMirrorHeaderBtn");
            if (!headerButton) return;
            headerButton.setAttribute("aria-pressed", String(Boolean(isVisible)));
            headerButton.classList.toggle("active", Boolean(isVisible));
        }

        function hideScreenMirrorCard(immediate = false) {
            const screenMirrorCard = document.getElementById("screenMirrorCard");
            if (!screenMirrorCard) return;

            if (screenMirrorCardCloseTimerId) {
                clearTimeout(screenMirrorCardCloseTimerId);
                screenMirrorCardCloseTimerId = null;
            }

            screenMirrorCard.classList.remove("is-visible");
            updateScreenMirrorCardToggleButtonState(false);

            if (immediate) {
                screenMirrorCard.classList.add("panel-hidden");
                return;
            }

            screenMirrorCardCloseTimerId = setTimeout(() => {
                screenMirrorCard.classList.add("panel-hidden");
                screenMirrorCardCloseTimerId = null;
            }, 220);
        }

        function openScreenMirrorCard(forceOpen = false) {
            const screenMirrorCard = document.getElementById("screenMirrorCard");
            if (!screenMirrorCard) return;

            if (screenMirrorCardCloseTimerId) {
                clearTimeout(screenMirrorCardCloseTimerId);
                screenMirrorCardCloseTimerId = null;
            }

            screenMirrorCard.classList.remove("panel-hidden");
            requestAnimationFrame(() => {
                screenMirrorCard.classList.add("is-visible");
            });
            updateScreenMirrorCardToggleButtonState(true);
        }

        function getSelectedScreenMirrorDeviceLabel() {
            const select = getGlobalDeviceSelectElement();
            if (!select || !select.value) {
                return "Screen Mirror";
            }

            const normalizedUid = normalizeDeviceUidInput(select.value);
            const rememberedName = deviceNameByUid.get(normalizedUid);
            if (rememberedName) {
                return rememberedName;
            }

            const selectedOption = select.options?.[select.selectedIndex];
            const optionLabel = String(selectedOption?.textContent || "").trim();
            if (!optionLabel || optionLabel.toLowerCase() === "no devices found") {
                return "Screen Mirror";
            }
            return optionLabel.replace(/\s*[🟢🔴]\s*$/, "").trim();
        }

        function updateScreenMirrorFloatingTitle() {
            const titleElement = document.getElementById("screenMirrorFloatingTitle");
            if (!titleElement) return;
            const label = getSelectedScreenMirrorDeviceLabel();
            titleElement.textContent = label ? `Screen Mirror • ${label}` : "Screen Mirror";
        }

        function updateScreenMirrorPinToggleState() {
            const pinToggleButton = getScreenMirrorPinToggleButton();
            if (pinToggleButton) {
                pinToggleButton.setAttribute("aria-pressed", String(isScreenMirrorPinned));
                pinToggleButton.setAttribute("aria-label", "Pin screen");
                pinToggleButton.setAttribute("title", "Pin screen");
                pinToggleButton.classList.toggle("is-hidden", isScreenMirrorPinned);
            }
        }

        function updateScreenMirrorStartStopButtonState() {
            const startStopButton = getScreenMirrorStartStopButton();
            if (!startStopButton) return;
            startStopButton.textContent = isScreenMirrorRunning ? "Stop Screen Mirror" : "Start Screen Mirror";
            startStopButton.classList.toggle("danger-button", isScreenMirrorRunning);
            startStopButton.setAttribute("aria-pressed", String(isScreenMirrorRunning));
        }

        function setScreenMirrorRunningState(isRunning) {
            isScreenMirrorRunning = Boolean(isRunning);
            setScreenTouchControlEnabled(isScreenMirrorRunning);
            updateScreenMirrorStartStopButtonState();
        }

        function moveScreenMirrorViewerTo(targetSlot) {
            const viewerNode = getScreenMirrorViewerNode();
            if (!viewerNode || !targetSlot) return false;
            if (viewerNode.parentElement !== targetSlot) {
                targetSlot.appendChild(viewerNode);
            }
            return true;
        }

        function showScreenMirrorFloatingPanel() {
            const floatingPanel = getScreenMirrorFloatingPanel();
            if (!floatingPanel) return;

            if (screenMirrorFloatingCloseTimerId) {
                clearTimeout(screenMirrorFloatingCloseTimerId);
                screenMirrorFloatingCloseTimerId = null;
            }

            floatingPanel.classList.remove("panel-hidden");
            requestAnimationFrame(() => {
                floatingPanel.classList.add("is-visible");
            });
        }

        function hideScreenMirrorFloatingPanel(immediate = false) {
            const floatingPanel = getScreenMirrorFloatingPanel();
            if (!floatingPanel) return;

            if (screenMirrorFloatingCloseTimerId) {
                clearTimeout(screenMirrorFloatingCloseTimerId);
                screenMirrorFloatingCloseTimerId = null;
            }

            floatingPanel.classList.remove("is-visible");

            if (immediate) {
                floatingPanel.classList.add("panel-hidden");
                return;
            }

            screenMirrorFloatingCloseTimerId = setTimeout(() => {
                floatingPanel.classList.add("panel-hidden");
                screenMirrorFloatingCloseTimerId = null;
            }, SCREEN_MIRROR_FLOAT_ANIMATION_MS);
        }

        function pinScreenMirror() {
            const floatingSlot = getScreenMirrorViewerFloatingSlot();
            const minimizeButton = document.getElementById("screenMirrorMinimizeBtn");
            if (!floatingSlot) return;
            if (!moveScreenMirrorViewerTo(floatingSlot)) return;
            resetScreenMirrorViewerDockedStyle();

            isScreenMirrorPinned = true;
            isScreenMirrorFloatingHidden = false;
            isScreenMirrorFloatingMinimized = false;

            const floatingPanel = getScreenMirrorFloatingPanel();
            if (floatingPanel) {
                floatingPanel.classList.remove("minimized");
            }
            showScreenMirrorFloatingPanel();
            if (minimizeButton) {
                minimizeButton.textContent = "Minimize";
            }

            updateScreenMirrorFloatingTitle();
            updateScreenMirrorPinToggleState();
            clampScreenMirrorFloatingPanelToViewport();
        }

        function dockScreenMirror() {
            const dockSlot = getScreenMirrorViewerDockSlot();
            const floatingPanel = getScreenMirrorFloatingPanel();
            const minimizeButton = document.getElementById("screenMirrorMinimizeBtn");
            if (dockSlot) {
                moveScreenMirrorViewerTo(dockSlot);
            }

            isScreenMirrorPinned = false;
            isScreenMirrorFloatingHidden = true;
            isScreenMirrorFloatingMinimized = false;
            screenMirrorFloatingDragState.active = false;
            screenMirrorFloatingDragState.pointerId = null;
            screenMirrorFloatingResizeState.active = false;
            screenMirrorFloatingResizeState.pointerId = null;
            window.removeEventListener("pointermove", handleScreenMirrorFloatingResizeMove);
            window.removeEventListener("pointerup", endScreenMirrorFloatingResize);
            window.removeEventListener("pointercancel", endScreenMirrorFloatingResize);

            if (floatingPanel) {
                floatingPanel.classList.remove("minimized");
                floatingPanel.classList.remove("dragging");
                floatingPanel.classList.remove("resizing");
                floatingPanel.style.left = "";
                floatingPanel.style.top = "";
                floatingPanel.style.right = "";
                floatingPanel.style.bottom = "";
            }
            hideScreenMirrorFloatingPanel(false);
            if (minimizeButton) {
                minimizeButton.textContent = "Minimize";
            }

            updateScreenMirrorPinToggleState();
            applyScreenMirrorViewerDockedSizing();
        }

        function toggleScreenMirrorFloating() {
            if (isScreenMirrorPinned) {
                dockScreenMirror();
                return;
            }
            pinScreenMirror();
        }

        function closeFloatingScreenMirror() {
            dockScreenMirror();
        }

        function toggleScreenMirrorFloatingMinimize() {
            if (!isScreenMirrorPinned) return;
            const floatingPanel = getScreenMirrorFloatingPanel();
            const minimizeButton = document.getElementById("screenMirrorMinimizeBtn");
            if (!floatingPanel) return;

            isScreenMirrorFloatingMinimized = !isScreenMirrorFloatingMinimized;
            floatingPanel.classList.toggle("minimized", isScreenMirrorFloatingMinimized);
            if (minimizeButton) {
                minimizeButton.textContent = isScreenMirrorFloatingMinimized ? "Expand" : "Minimize";
            }
            clampScreenMirrorFloatingPanelToViewport();
        }

        function startScreenMirrorFloatingDrag(event) {
            if (!isScreenMirrorPinned || isScreenMirrorFloatingHidden) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;
            const target = event.target;
            if (target instanceof Element && target.closest("button")) {
                return;
            }
            if (target instanceof Element && target.closest(".screen-mirror-floating-resize-handle")) {
                return;
            }

            const floatingPanel = getScreenMirrorFloatingPanel();
            const floatingHeader = getScreenMirrorFloatingHeader();
            if (!floatingPanel || !floatingHeader || floatingPanel.classList.contains("panel-hidden")) return;

            const panelRect = floatingPanel.getBoundingClientRect();
            screenMirrorFloatingDragState.active = true;
            screenMirrorFloatingDragState.pointerId = event.pointerId;
            screenMirrorFloatingDragState.offsetX = event.clientX - panelRect.left;
            screenMirrorFloatingDragState.offsetY = event.clientY - panelRect.top;

            floatingPanel.style.left = `${panelRect.left}px`;
            floatingPanel.style.top = `${panelRect.top}px`;
            floatingPanel.style.right = "auto";
            floatingPanel.style.bottom = "auto";
            floatingPanel.classList.add("dragging");

            if (typeof floatingHeader.setPointerCapture === "function") {
                try {
                    floatingHeader.setPointerCapture(event.pointerId);
                } catch (_error) {
                    // ignore pointer capture errors and continue dragging
                }
            }

            window.addEventListener("pointermove", handleScreenMirrorFloatingDragMove);
            window.addEventListener("pointerup", endScreenMirrorFloatingDrag);
            window.addEventListener("pointercancel", endScreenMirrorFloatingDrag);
            event.preventDefault();
        }

        function handleScreenMirrorFloatingDragMove(event) {
            if (!screenMirrorFloatingDragState.active) return;
            if (screenMirrorFloatingDragState.pointerId !== null && event.pointerId !== screenMirrorFloatingDragState.pointerId) {
                return;
            }

            const floatingPanel = getScreenMirrorFloatingPanel();
            if (!floatingPanel) return;
            const panelWidth = floatingPanel.offsetWidth;
            const panelHeight = floatingPanel.offsetHeight;
            const maxLeft = Math.max(0, window.innerWidth - panelWidth);
            const maxTop = Math.max(0, window.innerHeight - panelHeight);

            const unclampedLeft = event.clientX - screenMirrorFloatingDragState.offsetX;
            const unclampedTop = event.clientY - screenMirrorFloatingDragState.offsetY;
            const nextLeft = Math.min(Math.max(0, unclampedLeft), maxLeft);
            const nextTop = Math.min(Math.max(0, unclampedTop), maxTop);

            floatingPanel.style.left = `${nextLeft}px`;
            floatingPanel.style.top = `${nextTop}px`;
            floatingPanel.style.right = "auto";
            floatingPanel.style.bottom = "auto";
        }

        function endScreenMirrorFloatingDrag(event) {
            if (!screenMirrorFloatingDragState.active) return;
            if (screenMirrorFloatingDragState.pointerId !== null && event.pointerId !== screenMirrorFloatingDragState.pointerId) {
                return;
            }

            const floatingPanel = getScreenMirrorFloatingPanel();
            const floatingHeader = getScreenMirrorFloatingHeader();
            if (floatingPanel) {
                floatingPanel.classList.remove("dragging");
            }
            if (floatingHeader && typeof floatingHeader.releasePointerCapture === "function") {
                try {
                    floatingHeader.releasePointerCapture(event.pointerId);
                } catch (_error) {
                    // ignore pointer release errors
                }
            }

            screenMirrorFloatingDragState.active = false;
            screenMirrorFloatingDragState.pointerId = null;

            window.removeEventListener("pointermove", handleScreenMirrorFloatingDragMove);
            window.removeEventListener("pointerup", endScreenMirrorFloatingDrag);
            window.removeEventListener("pointercancel", endScreenMirrorFloatingDrag);
        }

        function startScreenMirrorFloatingResize(event) {
            if (!isScreenMirrorPinned || isScreenMirrorFloatingHidden || isScreenMirrorFloatingMinimized) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;

            const floatingPanel = getScreenMirrorFloatingPanel();
            if (!floatingPanel || floatingPanel.classList.contains("panel-hidden")) return;

            const panelRect = floatingPanel.getBoundingClientRect();
            screenMirrorFloatingResizeState.active = true;
            screenMirrorFloatingResizeState.pointerId = event.pointerId;
            screenMirrorFloatingResizeState.startX = event.clientX;
            screenMirrorFloatingResizeState.startY = event.clientY;
            screenMirrorFloatingResizeState.startWidth = panelRect.width;
            screenMirrorFloatingResizeState.startHeight = panelRect.height;

            floatingPanel.style.left = `${panelRect.left}px`;
            floatingPanel.style.top = `${panelRect.top}px`;
            floatingPanel.style.right = "auto";
            floatingPanel.style.bottom = "auto";
            floatingPanel.classList.add("resizing");

            if (typeof event.target?.setPointerCapture === "function") {
                try {
                    event.target.setPointerCapture(event.pointerId);
                } catch (_error) {
                    // ignore pointer capture errors
                }
            }

            window.addEventListener("pointermove", handleScreenMirrorFloatingResizeMove);
            window.addEventListener("pointerup", endScreenMirrorFloatingResize);
            window.addEventListener("pointercancel", endScreenMirrorFloatingResize);
            event.preventDefault();
        }

        function handleScreenMirrorFloatingResizeMove(event) {
            if (!screenMirrorFloatingResizeState.active) return;
            if (screenMirrorFloatingResizeState.pointerId !== null && event.pointerId !== screenMirrorFloatingResizeState.pointerId) {
                return;
            }

            const floatingPanel = getScreenMirrorFloatingPanel();
            if (!floatingPanel) return;

            const left = Number.parseFloat(floatingPanel.style.left || "0");
            const top = Number.parseFloat(floatingPanel.style.top || "0");
            const deltaX = event.clientX - screenMirrorFloatingResizeState.startX;
            const deltaY = event.clientY - screenMirrorFloatingResizeState.startY;
            const viewportMaxWidth = Math.max(SCREEN_MIRROR_FLOATING_MIN_WIDTH, window.innerWidth - Math.max(0, left));
            const viewportMaxHeight = Math.max(SCREEN_MIRROR_FLOATING_MIN_HEIGHT, window.innerHeight - Math.max(0, top));

            const nextWidth = Math.min(
                viewportMaxWidth,
                Math.max(SCREEN_MIRROR_FLOATING_MIN_WIDTH, screenMirrorFloatingResizeState.startWidth + deltaX)
            );
            const nextHeight = Math.min(
                viewportMaxHeight,
                Math.max(SCREEN_MIRROR_FLOATING_MIN_HEIGHT, screenMirrorFloatingResizeState.startHeight + deltaY)
            );

            floatingPanel.style.width = `${Math.round(nextWidth)}px`;
            floatingPanel.style.height = `${Math.round(nextHeight)}px`;
            clampScreenMirrorFloatingPanelToViewport();
        }

        function endScreenMirrorFloatingResize(event) {
            if (!screenMirrorFloatingResizeState.active) return;
            if (screenMirrorFloatingResizeState.pointerId !== null && event.pointerId !== screenMirrorFloatingResizeState.pointerId) {
                return;
            }

            const floatingPanel = getScreenMirrorFloatingPanel();
            if (floatingPanel) {
                floatingPanel.classList.remove("resizing");
            }

            screenMirrorFloatingResizeState.active = false;
            screenMirrorFloatingResizeState.pointerId = null;

            window.removeEventListener("pointermove", handleScreenMirrorFloatingResizeMove);
            window.removeEventListener("pointerup", endScreenMirrorFloatingResize);
            window.removeEventListener("pointercancel", endScreenMirrorFloatingResize);
        }

        function clampScreenMirrorFloatingPanelToViewport() {
            if (!isScreenMirrorPinned || isScreenMirrorFloatingHidden) return;
            if (isScreenMirrorFloatingMinimized) return;
            const floatingPanel = getScreenMirrorFloatingPanel();
            if (!floatingPanel || floatingPanel.classList.contains("panel-hidden")) return;
            const panelWidth = floatingPanel.offsetWidth;
            const panelHeight = floatingPanel.offsetHeight;
            const constrainedWidth = Math.min(window.innerWidth, Math.max(SCREEN_MIRROR_FLOATING_MIN_WIDTH, panelWidth));
            const constrainedHeight = Math.min(window.innerHeight, Math.max(SCREEN_MIRROR_FLOATING_MIN_HEIGHT, panelHeight));
            if (Math.abs(constrainedWidth - panelWidth) > 0.5) {
                floatingPanel.style.width = `${Math.round(constrainedWidth)}px`;
            }
            if (Math.abs(constrainedHeight - panelHeight) > 0.5) {
                floatingPanel.style.height = `${Math.round(constrainedHeight)}px`;
            }

            if (!floatingPanel.style.left || !floatingPanel.style.top) return;
            const finalWidth = floatingPanel.offsetWidth;
            const finalHeight = floatingPanel.offsetHeight;
            const maxLeft = Math.max(0, window.innerWidth - finalWidth);
            const maxTop = Math.max(0, window.innerHeight - finalHeight);
            const left = Number.parseFloat(floatingPanel.style.left);
            const top = Number.parseFloat(floatingPanel.style.top);
            const safeLeft = Number.isFinite(left) ? Math.min(Math.max(0, left), maxLeft) : maxLeft;
            const safeTop = Number.isFinite(top) ? Math.min(Math.max(0, top), maxTop) : maxTop;

            floatingPanel.style.left = `${safeLeft}px`;
            floatingPanel.style.top = `${safeTop}px`;
            floatingPanel.style.right = "auto";
            floatingPanel.style.bottom = "auto";
        }

        function initializeScreenMirrorFloatingUI() {
            const floatingHeader = getScreenMirrorFloatingHeader();
            const floatingResizeHandle = getScreenMirrorFloatingResizeHandle();
            const floatingPanel = getScreenMirrorFloatingPanel();
            const dockSlot = getScreenMirrorViewerDockSlot();
            if (floatingPanel) {
                floatingPanel.classList.add("panel-hidden");
                floatingPanel.classList.remove("is-visible");
                floatingPanel.classList.remove("minimized");
            }
            if (dockSlot) {
                moveScreenMirrorViewerTo(dockSlot);
            }
            isScreenMirrorPinned = false;
            isScreenMirrorFloatingHidden = true;
            isScreenMirrorFloatingMinimized = false;
            if (floatingHeader) {
                floatingHeader.addEventListener("pointerdown", startScreenMirrorFloatingDrag);
            }
            if (floatingResizeHandle) {
                floatingResizeHandle.addEventListener("pointerdown", startScreenMirrorFloatingResize);
            }
            updateScreenMirrorPinToggleState();
            updateScreenMirrorFloatingTitle();
            updateScreenMirrorStartStopButtonState();
            applyScreenMirrorViewerDockedSizing();
            window.addEventListener("resize", () => {
                clampScreenMirrorFloatingPanelToViewport();
                applyScreenMirrorViewerDockedSizing();
            });
        }

        function initializeScreenMirrorPinnedPanel() {
            const panel = getScreenMirrorPinnedPanel();
            const previewWrap = getScreenMirrorPinnedPreviewWrap();
            const resizeHandle = getScreenMirrorPinnedResizeHandle();
            const unpinButton = document.getElementById("screenMirrorPinnedUnpinBtn");

            if (panel) {
                panel.classList.add("panel-hidden");
                panel.classList.remove("is-visible");
                panel.classList.remove("is-resizing");
            }

            if (unpinButton) {
                unpinButton.addEventListener("click", () => {
                    unpinScreenMirrorDevice();
                });
            }

            if (previewWrap) {
                previewWrap.addEventListener("pointerdown", handleMultiScreenMirrorPreviewPointerDown, { passive: false });
                previewWrap.addEventListener("pointerup", handleMultiScreenMirrorPreviewPointerUp, { passive: false });
                previewWrap.addEventListener("pointercancel", handleMultiScreenMirrorPreviewPointerCancel);
                previewWrap.addEventListener("dragstart", (event) => event.preventDefault());
            }

            document.querySelectorAll("[data-pinned-touch-target]").forEach((button) => {
                button.addEventListener("click", async () => {
                    const touchTarget = String(button.getAttribute("data-pinned-touch-target") || "").trim().toLowerCase();
                    const targetUid = normalizeDeviceUidInput(pinnedScreenMirrorDeviceUid);
                    if (!targetUid || !["back", "home", "recents"].includes(touchTarget)) return;

                    button.disabled = true;
                    try {
                        const sent = await sendScreenRemoteCommandForDevice(
                            targetUid,
                            {
                                action: "screen_touch",
                                type: "SCREEN_TOUCH",
                                touchTarget
                            },
                            {
                                defaultErrorMessage: `Failed to send ${touchTarget.toUpperCase()} command`,
                                showErrorToast: true
                            }
                        );
                        if (sent) {
                            showToast(`${touchTarget.toUpperCase()} command sent`, "success");
                            await loadCommands();
                        }
                    } finally {
                        button.disabled = false;
                    }
                });
            });

            if (resizeHandle) {
                resizeHandle.addEventListener("pointerdown", startScreenMirrorPinnedResize, { passive: false });
            }

            window.addEventListener("resize", () => {
                applyPinnedScreenMirrorSizing();
            });
        }

        function resetScreenMirrorView() {
            const preview = document.getElementById("screenMirrorPreview");
            const statusText = document.getElementById("screenMirrorStatusText");
            const frameCountText = document.getElementById("screenMirrorFrameCountText");
            const lastFrameText = document.getElementById("screenMirrorLastFrameText");

            screenMirrorFrameWidth = 0;
            screenMirrorFrameHeight = 0;
            clearScreenMirrorPointerGestureState();
            applyScreenMirrorViewerDockedSizing();

            if (preview) {
                preview.removeAttribute("src");
            }
            if (statusText) {
                statusText.textContent = "idle";
            }
            if (frameCountText) {
                frameCountText.textContent = "0";
            }
            if (lastFrameText) {
                lastFrameText.textContent = "--";
            }
            setScreenMirrorRunningState(false);
        }

        function applyScreenMirrorStatus(payload = {}) {
            const statusText = document.getElementById("screenMirrorStatusText");
            const frameCountText = document.getElementById("screenMirrorFrameCountText");
            const lastFrameText = document.getElementById("screenMirrorLastFrameText");

            const normalizedStatus =
                typeof payload.status === "string" && payload.status.trim()
                    ? payload.status.trim()
                    : "idle";
            const normalizedReason =
                typeof payload.reason === "string" && payload.reason.trim()
                    ? payload.reason.trim()
                    : "";
            if (statusText) {
                statusText.textContent = normalizedReason
                    ? `${normalizedStatus} (${normalizedReason})`
                    : normalizedStatus;
            }

            const isRunningStatus =
                normalizedStatus === "live" ||
                normalizedStatus === "running" ||
                normalizedStatus === "active" ||
                normalizedStatus === "started" ||
                normalizedStatus === "starting";
            const isStoppedStatus =
                normalizedStatus === "idle" ||
                normalizedStatus === "stopped" ||
                normalizedStatus === "stopping" ||
                normalizedStatus === "inactive" ||
                normalizedStatus === "error" ||
                normalizedStatus === "failed";
            if (isRunningStatus) {
                setScreenMirrorRunningState(true);
            } else if (isStoppedStatus) {
                setScreenMirrorRunningState(false);
            }

            const normalizedFrameCount = Number.isFinite(Number(payload.frameCount))
                ? Math.max(0, Math.round(Number(payload.frameCount)))
                : null;
            if (frameCountText && normalizedFrameCount !== null) {
                frameCountText.textContent = String(normalizedFrameCount);
            }

            const rawLastFrame = payload.lastFrameAt ?? payload.timestamp ?? null;
            let formattedLastFrame = "--";
            if (rawLastFrame !== null && rawLastFrame !== undefined && rawLastFrame !== "") {
                const parsed =
                    typeof rawLastFrame === "number"
                        ? new Date(rawLastFrame)
                        : new Date(String(rawLastFrame));
                if (!Number.isNaN(parsed.getTime())) {
                    formattedLastFrame = parsed.toLocaleString();
                }
            }
            if (lastFrameText) {
                lastFrameText.textContent = formattedLastFrame;
            }
        }

        function ensureScreenMirrorSocket() {
            if (typeof io !== "function") {
                return screenMirrorSocket;
            }

            if (screenMirrorSocket) {
                screenMirrorSocket.auth = {
                    accessToken: authToken
                };
                return screenMirrorSocket;
            }

            screenMirrorSocket = io(SERVER, {
                transports: ["websocket"],
                reconnection: true,
                auth: {
                    accessToken: authToken
                }
            });

            screenMirrorSocket.on("connect", () => {
                if (screenMirrorJoinedDeviceUid) {
                    screenMirrorSocket.emit("dashboard:join", {
                        deviceUid: screenMirrorJoinedDeviceUid
                    });
                }
                commandDashboardJoinedDeviceUids.forEach((deviceUid) => {
                    screenMirrorSocket.emit("dashboard:join", { deviceUid });
                });
                activeScreenMirrorDeviceUids.forEach((deviceUid) => {
                    screenMirrorSocket.emit("dashboard:join", { deviceUid });
                    const state = getScreenMirrorDeviceState(deviceUid);
                    if (state && shouldStartWebRtcForStatus(state.status)) {
                        void startWebRtcViewerForDevice(deviceUid);
                    }
                });
            });
            screenMirrorSocket.on("connect_error", (error) => {
                const reason = String(error?.message || "").toLowerCase();
                if (reason.includes("unauthorized")) {
                    showToast("Screen mirror socket auth failed", "error");
                }
            });

            screenMirrorSocket.on("screen:status", (payload = {}) => {
                applyMultiScreenMirrorStatus(payload);
                const legacyLayout = document.getElementById("screenMirrorLegacyLayout");
                if (!legacyLayout || legacyLayout.classList.contains("panel-hidden")) {
                    return;
                }
                const payloadDeviceUid = normalizeDeviceUidInput(payload?.deviceUid || "");
                if (!payloadDeviceUid || payloadDeviceUid !== screenMirrorJoinedDeviceUid) {
                    return;
                }
                applyScreenMirrorStatus(payload);
            });

            screenMirrorSocket.on("command:created", (payload = {}) => {
                upsertCommandInCache(payload);
            });

            screenMirrorSocket.on("command:updated", (payload = {}) => {
                upsertCommandInCache(payload);
            });

            screenMirrorSocket.on("commands:cleared", (payload = {}) => {
                handleCommandsClearedRealtimeEvent(payload);
            });

            screenMirrorSocket.on("screen:webrtc-answer", (payload = {}) => {
                void applyScreenMirrorWebRtcAnswer(payload);
            });

            screenMirrorSocket.on("screen:webrtc-ice-candidate", (payload = {}) => {
                void applyScreenMirrorRemoteIceCandidate(payload);
            });

            return screenMirrorSocket;
        }

        function disconnectScreenMirrorSocket() {
            if (!screenMirrorSocket) return;
            activeScreenMirrorDeviceUids.forEach((deviceUid) => {
                closeScreenMirrorPeerConnection(deviceUid, { notify: false });
            });
            screenMirrorSocket.disconnect();
            screenMirrorSocket = null;
            screenMirrorJoinedDeviceUid = "";
        }

        function joinScreenMirrorDashboardRoom(deviceUid) {
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid);
            if (!normalizedDeviceUid) {
                screenMirrorJoinedDeviceUid = "";
                return;
            }

            screenMirrorJoinedDeviceUid = normalizedDeviceUid;
            const socket = ensureScreenMirrorSocket();
            if (!socket) return;
            socket.auth = {
                accessToken: authToken
            };

            socket.emit("dashboard:join", { deviceUid: normalizedDeviceUid });
        }

        async function sendScreenMirrorCommand(action, type) {
            const deviceUid = requireSelectedGlobalDeviceUid();
            if (!deviceUid) {
                return;
            }

            try {
                joinScreenMirrorDashboardRoom(deviceUid);
                const response = await apiFetch("/commands", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        action,
                        type,
                        deviceUid,
                        isImmediate: true
                    })
                });

                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(parseApiErrorMessage(payload, "Failed to send screen mirror command"));
                }

                if (action === "start_screen_mirror") {
                    applyScreenMirrorStatus({ status: "starting" });
                    setScreenMirrorRunningState(true);
                    showToast("START_SCREEN_MIRROR command sent", "success");
                } else {
                    applyScreenMirrorStatus({ status: "stopping" });
                    setScreenMirrorRunningState(false);
                    showToast("STOP_SCREEN_MIRROR command sent", "success");
                }

                await loadCommands();
            } catch (error) {
                showToast(error.message || "Failed to send screen mirror command", "error");
            }
        }

        async function startScreenMirror() {
            await sendScreenMirrorCommand("start_screen_mirror", "START_SCREEN_MIRROR");
        }

        async function stopScreenMirror() {
            await sendScreenMirrorCommand("stop_screen_mirror", "STOP_SCREEN_MIRROR");
        }

        async function toggleScreenMirrorStartStop() {
            if (isScreenMirrorRunning) {
                await stopScreenMirror();
                return;
            }
            await startScreenMirror();
        }

        function getSelectedScreenMirrorDeviceUid() {
            return getSelectedGlobalDeviceUid();
        }

        function toValidPositiveInteger(value) {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) return null;
            const normalized = Math.round(parsed);
            return normalized > 0 ? normalized : null;
        }

        function resetScreenMirrorViewerDockedStyle() {
            const viewerNode = getScreenMirrorViewerNode();
            if (!viewerNode) return;
            viewerNode.style.width = "";
            viewerNode.style.maxWidth = "";
            viewerNode.style.maxHeight = "";
            viewerNode.style.height = "";
            viewerNode.style.aspectRatio = "";
        }

        function applyScreenMirrorViewerDockedSizing() {
            const viewerNode = getScreenMirrorViewerNode();
            if (!viewerNode || isScreenMirrorPinned) return;

            const sourceSize = getScreenMirrorSourceSize();
            if (!sourceSize) {
                resetScreenMirrorViewerDockedStyle();
                return;
            }

            const ratio = sourceSize.width / sourceSize.height;
            if (!Number.isFinite(ratio) || ratio <= 0) {
                resetScreenMirrorViewerDockedStyle();
                return;
            }

            const targetMaxHeightPx = Math.max(
                280,
                Math.round(window.innerHeight * 0.78)
            );
            const targetWidthPx = Math.max(
                220,
                Math.round(targetMaxHeightPx * ratio)
            );

            viewerNode.style.aspectRatio = `${sourceSize.width} / ${sourceSize.height}`;
            viewerNode.style.width = `${targetWidthPx}px`;
            viewerNode.style.maxWidth = "100%";
            viewerNode.style.height = "auto";
            viewerNode.style.maxHeight = `${targetMaxHeightPx}px`;
        }

        function updateScreenMirrorFrameSize(width, height) {
            const normalizedWidth = toValidPositiveInteger(width);
            const normalizedHeight = toValidPositiveInteger(height);
            if (!normalizedWidth || !normalizedHeight) {
                return;
            }
            screenMirrorFrameWidth = normalizedWidth;
            screenMirrorFrameHeight = normalizedHeight;
            applyScreenMirrorViewerDockedSizing();
        }

        function clearScreenMirrorPointerGestureState() {
            const viewerNode = getScreenMirrorViewerNode();
            const pointerId = screenMirrorPointerGestureState.pointerId;
            if (
                viewerNode &&
                pointerId !== null &&
                typeof viewerNode.releasePointerCapture === "function"
            ) {
                try {
                    viewerNode.releasePointerCapture(pointerId);
                } catch (_error) {
                    // ignore pointer release errors
                }
            }

            screenMirrorPointerGestureState.active = false;
            screenMirrorPointerGestureState.pointerId = null;
            screenMirrorPointerGestureState.startClientX = 0;
            screenMirrorPointerGestureState.startClientY = 0;
            screenMirrorPointerGestureState.startedAtMs = 0;
            screenMirrorPointerGestureState.startMappedPoint = null;
        }

        function updateScreenTouchControlToggleState() {
            const viewerNode = getScreenMirrorViewerNode();

            if (viewerNode) {
                viewerNode.classList.toggle("touch-control-enabled", isScreenTouchControlEnabled);
            }
        }

        function setScreenTouchControlEnabled(enabled) {
            isScreenTouchControlEnabled = Boolean(enabled);
            if (!isScreenTouchControlEnabled) {
                clearScreenMirrorPointerGestureState();
            }
            updateScreenTouchControlToggleState();
        }

        function getScreenMirrorSourceSize() {
            const preview = document.getElementById("screenMirrorPreview");
            const explicitWidth = toValidPositiveInteger(screenMirrorFrameWidth);
            const explicitHeight = toValidPositiveInteger(screenMirrorFrameHeight);
            if (explicitWidth && explicitHeight) {
                return { width: explicitWidth, height: explicitHeight };
            }

            const naturalWidth = toValidPositiveInteger(preview?.naturalWidth);
            const naturalHeight = toValidPositiveInteger(preview?.naturalHeight);
            if (naturalWidth && naturalHeight) {
                return { width: naturalWidth, height: naturalHeight };
            }

            return null;
        }

        function showScreenMirrorTapFeedback(targetElement, clientX, clientY) {
            if (
                !targetElement ||
                typeof targetElement.getBoundingClientRect !== "function" ||
                typeof targetElement.appendChild !== "function"
            ) {
                return;
            }

            const ownerDocument = targetElement.ownerDocument || document;
            const rect = targetElement.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;

            const ripple = ownerDocument.createElement("span");
            ripple.className = "screen-mirror-tap-feedback";
            ripple.style.left = `${clientX - rect.left}px`;
            ripple.style.top = `${clientY - rect.top}px`;
            ripple.setAttribute("aria-hidden", "true");
            ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
            targetElement.appendChild(ripple);
        }

        function showScreenMirrorSwipeFeedback(targetElement, startClientX, startClientY, endClientX, endClientY) {
            if (
                !targetElement ||
                typeof targetElement.getBoundingClientRect !== "function" ||
                typeof targetElement.appendChild !== "function"
            ) {
                return;
            }

            const ownerDocument = targetElement.ownerDocument || document;
            const rect = targetElement.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;

            const deltaX = endClientX - startClientX;
            const deltaY = endClientY - startClientY;
            const distance = Math.hypot(deltaX, deltaY);
            if (!Number.isFinite(distance) || distance <= 0) return;

            const trail = ownerDocument.createElement("span");
            trail.className = "screen-mirror-swipe-feedback";
            trail.style.left = `${startClientX - rect.left}px`;
            trail.style.top = `${startClientY - rect.top - 2}px`;
            trail.style.width = `${Math.max(24, distance)}px`;
            trail.style.setProperty("--screen-mirror-swipe-angle", `${Math.atan2(deltaY, deltaX)}rad`);
            trail.setAttribute("aria-hidden", "true");
            trail.addEventListener("animationend", () => trail.remove(), { once: true });
            targetElement.appendChild(trail);
        }

        function mapScreenClientPointToDevicePoint(clientX, clientY) {
            const preview = document.getElementById("screenMirrorPreview");
            if (!preview) return null;

            const sourceSize = getScreenMirrorSourceSize();
            if (!sourceSize) return null;

            const previewRect = preview.getBoundingClientRect();
            if (previewRect.width <= 0 || previewRect.height <= 0) {
                return null;
            }

            const drawScale = Math.min(
                previewRect.width / sourceSize.width,
                previewRect.height / sourceSize.height
            );
            if (!Number.isFinite(drawScale) || drawScale <= 0) {
                return null;
            }

            const drawnWidth = sourceSize.width * drawScale;
            const drawnHeight = sourceSize.height * drawScale;
            const offsetX = (previewRect.width - drawnWidth) / 2;
            const offsetY = (previewRect.height - drawnHeight) / 2;
            const localX = clientX - previewRect.left;
            const localY = clientY - previewRect.top;

            const insideDrawnImage =
                localX >= offsetX &&
                localX <= offsetX + drawnWidth &&
                localY >= offsetY &&
                localY <= offsetY + drawnHeight;
            if (!insideDrawnImage) {
                return null;
            }

            const normalizedX = (localX - offsetX) / drawnWidth;
            const normalizedY = (localY - offsetY) / drawnHeight;
            const mappedX = Math.min(
                sourceSize.width - 1,
                Math.max(0, Math.round(normalizedX * sourceSize.width))
            );
            const mappedY = Math.min(
                sourceSize.height - 1,
                Math.max(0, Math.round(normalizedY * sourceSize.height))
            );

            return {
                x: mappedX,
                y: mappedY,
                screenWidth: sourceSize.width,
                screenHeight: sourceSize.height
            };
        }

        async function sendScreenRemoteCommand(payload, options = {}) {
            const {
                successMessage = "",
                showSuccessToast = false,
                refreshCommands = false,
                defaultErrorMessage = "Failed to send touch control command"
            } = options;

            if (!isScreenMirrorRunning) {
                showToast("Start Screen Mirror first", "error");
                return false;
            }

            const deviceUid = getSelectedScreenMirrorDeviceUid();
            if (!deviceUid) {
                showToast("Please select a device first", "error");
                return false;
            }

            try {
                const response = await apiFetch("/commands", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        ...payload,
                        deviceUid
                    })
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(parseApiErrorMessage(data, defaultErrorMessage));
                }

                if (showSuccessToast && successMessage) {
                    showToast(successMessage, "success");
                }
                if (refreshCommands) {
                    await loadCommands();
                }
                return true;
            } catch (error) {
                showToast(error.message || defaultErrorMessage, "error");
                return false;
            }
        }

        async function sendScreenQuickAction(actionTarget) {
            const normalizedTarget = String(actionTarget || "").trim().toLowerCase();
            if (!["back", "home", "recents"].includes(normalizedTarget)) {
                return;
            }

            await sendScreenRemoteCommand(
                {
                    action: "screen_touch",
                    type: "SCREEN_TOUCH",
                    touchTarget: normalizedTarget
                },
                {
                    successMessage: `${normalizedTarget.toUpperCase()} command sent`,
                    showSuccessToast: true,
                    refreshCommands: true
                }
            );
        }

        function handleScreenMirrorPointerDown(event) {
            if (!isScreenTouchControlEnabled) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;
            if (!getSelectedScreenMirrorDeviceUid()) return;
            const target = event.target;
            if (target instanceof Element && target.closest("#screenMirrorPinToggleBtn")) {
                return;
            }

            const mappedStart = mapScreenClientPointToDevicePoint(event.clientX, event.clientY);
            if (!mappedStart) return;

            const viewerNode = getScreenMirrorViewerNode();
            clearScreenMirrorPointerGestureState();
            screenMirrorPointerGestureState.active = true;
            screenMirrorPointerGestureState.pointerId = event.pointerId;
            screenMirrorPointerGestureState.startClientX = event.clientX;
            screenMirrorPointerGestureState.startClientY = event.clientY;
            screenMirrorPointerGestureState.startedAtMs = Date.now();
            screenMirrorPointerGestureState.startMappedPoint = mappedStart;

            if (viewerNode && typeof viewerNode.setPointerCapture === "function") {
                try {
                    viewerNode.setPointerCapture(event.pointerId);
                } catch (_error) {
                    // ignore pointer capture errors
                }
            }

            event.preventDefault();
        }

        async function handleScreenMirrorPointerUp(event) {
            if (!screenMirrorPointerGestureState.active) return;
            if (screenMirrorPointerGestureState.pointerId !== event.pointerId) return;

            const gestureStateSnapshot = {
                startClientX: screenMirrorPointerGestureState.startClientX,
                startClientY: screenMirrorPointerGestureState.startClientY,
                startedAtMs: screenMirrorPointerGestureState.startedAtMs,
                startMappedPoint: screenMirrorPointerGestureState.startMappedPoint
            };

            clearScreenMirrorPointerGestureState();
            if (!isScreenTouchControlEnabled) return;
            if (!getSelectedScreenMirrorDeviceUid()) return;

            const mappedEnd = mapScreenClientPointToDevicePoint(event.clientX, event.clientY);
            const pointerDistance = Math.hypot(
                event.clientX - gestureStateSnapshot.startClientX,
                event.clientY - gestureStateSnapshot.startClientY
            );
            const endPointForTap = mappedEnd || gestureStateSnapshot.startMappedPoint;

            if (
                pointerDistance <= SCREEN_TOUCH_TAP_DISTANCE_THRESHOLD_PX &&
                endPointForTap
            ) {
                showScreenMirrorTapFeedback(
                    getScreenMirrorViewerNode(),
                    event.clientX,
                    event.clientY
                );
                await sendScreenRemoteCommand(
                    {
                        action: "screen_touch",
                        type: "SCREEN_TOUCH",
                        x: endPointForTap.x,
                        y: endPointForTap.y,
                        screenWidth: endPointForTap.screenWidth,
                        screenHeight: endPointForTap.screenHeight
                    },
                    {
                        showSuccessToast: false,
                        refreshCommands: false,
                        defaultErrorMessage: "Failed to send screen tap command"
                    }
                );
                event.preventDefault();
                return;
            }

            if (!gestureStateSnapshot.startMappedPoint || !mappedEnd) {
                return;
            }

            const elapsedMs = Math.round(Date.now() - gestureStateSnapshot.startedAtMs);
            const durationMs = Math.max(
                SCREEN_TOUCH_MIN_SWIPE_DURATION_MS,
                Math.min(SCREEN_TOUCH_MAX_SWIPE_DURATION_MS, elapsedMs)
            );

            showScreenMirrorSwipeFeedback(
                getScreenMirrorViewerNode(),
                gestureStateSnapshot.startClientX,
                gestureStateSnapshot.startClientY,
                event.clientX,
                event.clientY
            );
            await sendScreenRemoteCommand(
                {
                    action: "screen_swipe",
                    type: "SCREEN_SWIPE",
                    startX: gestureStateSnapshot.startMappedPoint.x,
                    startY: gestureStateSnapshot.startMappedPoint.y,
                    endX: mappedEnd.x,
                    endY: mappedEnd.y,
                    durationMs,
                    screenWidth: mappedEnd.screenWidth,
                    screenHeight: mappedEnd.screenHeight
                },
                {
                    showSuccessToast: false,
                    refreshCommands: false,
                    defaultErrorMessage: "Failed to send screen swipe command"
                }
            );
            event.preventDefault();
        }

        function handleScreenMirrorPointerCancel(event) {
            if (!screenMirrorPointerGestureState.active) return;
            if (screenMirrorPointerGestureState.pointerId !== event.pointerId) return;
            clearScreenMirrorPointerGestureState();
        }

        function initializeScreenMirrorTouchControl() {
            const viewerNode = getScreenMirrorViewerNode();
            const preview = document.getElementById("screenMirrorPreview");
            if (!viewerNode || !preview) {
                return;
            }

            viewerNode.addEventListener("pointerdown", handleScreenMirrorPointerDown, { passive: false });
            viewerNode.addEventListener("pointerup", handleScreenMirrorPointerUp, { passive: false });
            viewerNode.addEventListener("pointercancel", handleScreenMirrorPointerCancel);
            viewerNode.addEventListener("dragstart", (event) => event.preventDefault());

            preview.addEventListener("load", () => {
                if (!screenMirrorFrameWidth || !screenMirrorFrameHeight) {
                    updateScreenMirrorFrameSize(preview.naturalWidth, preview.naturalHeight);
                }
            });

            setScreenTouchControlEnabled(false);
        }

        function syncOverlayScrollLock() {
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
        }

        function setClaimDeviceModalTriggerExpanded(isExpanded) {
            const triggerButtons = document.querySelectorAll("[data-claim-device-trigger='true']");
            triggerButtons.forEach((button) => {
                if (button instanceof HTMLElement) {
                    button.setAttribute("aria-expanded", isExpanded ? "true" : "false");
                }
            });
        }

        if (!isQrDomReady) {
            document.addEventListener(
                "DOMContentLoaded",
                () => {
                    isQrDomReady = true;
                },
                { once: true }
            );
        }

        function waitForQrDomReady() {
            if (isQrDomReady) {
                return Promise.resolve();
            }

            return new Promise((resolve) => {
                document.addEventListener(
                    "DOMContentLoaded",
                    () => {
                        isQrDomReady = true;
                        resolve();
                    },
                    { once: true }
                );
            });
        }

        function hasLoadedQrLibrary() {
            const hasQRCode = Boolean(window.QRCode && typeof window.QRCode.toCanvas === "function");
            const hasQRCodeStyling = Boolean(window.QRCodeStyling);
            return hasQRCode || hasQRCodeStyling;
        }

        function attachQrLibraryLoadHandlers(scriptElement, onReady, onFailure) {
            const handleLoad = () => {
                scriptElement.dataset.autocallQrLoaded = "true";
                if (!window.QRCode && !window.QRCodeStyling) {
                    const loadError = new Error("QR library loaded but API is unavailable");
                    console.error("[AutoCall][QR] CDN loaded but QR API is unavailable", loadError);
                    onFailure(loadError);
                    return;
                }
                onReady();
            };

            const handleError = () => {
                const loadError = new Error("Failed to load QR library from CDN");
                console.error("[AutoCall][QR] Failed to load QR library from CDN", loadError);
                onFailure(loadError);
            };

            scriptElement.addEventListener("load", handleLoad, { once: true });
            scriptElement.addEventListener("error", handleError, { once: true });
        }

        async function ensurePairingQrLibraryLoaded() {
            await waitForQrDomReady();

            if (hasLoadedQrLibrary()) {
                return;
            }

            if (!window.QRCode && !window.QRCodeStyling) {
                console.warn("[AutoCall][QR] QR library missing, retrying CDN load");
            }

            if (!pairingQrLibraryLoadPromise) {
                pairingQrLibraryLoadPromise = new Promise((resolve, reject) => {
                    const scriptElement = document.createElement("script");
                    scriptElement.src = PAIRING_QR_LIBRARY_CDN_URL;
                    scriptElement.async = true;
                    scriptElement.dataset.autocallQrLib = "true";
                    attachQrLibraryLoadHandlers(scriptElement, resolve, reject);
                    document.head.appendChild(scriptElement);
                }).catch((error) => {
                    pairingQrLibraryLoadPromise = null;
                    throw error;
                });
            }

            await pairingQrLibraryLoadPromise;
        }

        function clearPairingQrCountdown() {
            if (pairingQrCountdownIntervalId) {
                clearInterval(pairingQrCountdownIntervalId);
                pairingQrCountdownIntervalId = null;
            }
        }

        function formatCountdownSeconds(totalSeconds) {
            const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
            const minutes = Math.floor(safeSeconds / 60);
            const seconds = safeSeconds % 60;
            return `${minutes}:${String(seconds).padStart(2, "0")}`;
        }

        function setPairingQrStatus(message, type = "info") {
            const statusElement = document.getElementById("pairingQrStatus");
            if (!statusElement) return;

            statusElement.textContent = String(message || "");
            statusElement.classList.remove("success", "error");
            if (type === "success" || type === "error") {
                statusElement.classList.add(type);
            }
        }

        function setManualPairingCodeValue(value) {
            const codeElement = document.getElementById("manualPairingCodeValue");
            if (!codeElement) return;

            const normalizedCode = typeof value === "string" ? value.trim() : "";
            codeElement.textContent = MANUAL_PAIRING_CODE_REGEX.test(normalizedCode)
                ? normalizedCode
                : MANUAL_PAIRING_CODE_PLACEHOLDER;
        }

        function clearPairingQrCanvas() {
            const canvas = document.getElementById("pairingQrCanvas");
            if (!(canvas instanceof HTMLCanvasElement)) return;
            const context = canvas.getContext("2d");
            if (!context) return;

            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, canvas.width, canvas.height);
        }

        function updatePairingQrMeta() {
            const metaElement = document.getElementById("pairingQrMeta");
            if (!metaElement) return;

            if (!pairingQrExpiresAtMs) {
                metaElement.textContent = `This QR expires in ${formatCountdownSeconds(PAIRING_QR_DEFAULT_SECONDS)}`;
                return;
            }

            const remainingSeconds = Math.max(0, Math.floor((pairingQrExpiresAtMs - Date.now()) / 1000));
            if (remainingSeconds <= 0) {
                metaElement.textContent = "QR expired. Refresh to get a new secure token.";
                setPairingQrStatus("Pairing QR expired. Tap Refresh QR.", "error");
                clearPairingQrCountdown();
                return;
            }

            metaElement.textContent = `This QR expires in ${formatCountdownSeconds(remainingSeconds)}`;
        }

        function startPairingQrCountdown(expiresAtValue) {
            clearPairingQrCountdown();

            const parsedExpiresAtMs = Date.parse(String(expiresAtValue || ""));
            if (!Number.isFinite(parsedExpiresAtMs) || parsedExpiresAtMs <= Date.now()) {
                pairingQrExpiresAtMs = Date.now() + (PAIRING_QR_DEFAULT_SECONDS * 1000);
            } else {
                pairingQrExpiresAtMs = parsedExpiresAtMs;
            }

            updatePairingQrMeta();
            pairingQrCountdownIntervalId = setInterval(() => {
                const overlay = document.getElementById("claimDeviceOverlay");
                if (!overlay || overlay.classList.contains("panel-hidden")) {
                    clearPairingQrCountdown();
                    return;
                }
                updatePairingQrMeta();
            }, 1000);
        }

        async function renderPairingQrCode(payload) {
            await ensurePairingQrLibraryLoaded();

            if (!window.QRCode && !window.QRCodeStyling) {
                const qrMissingError = new Error("QR library not loaded");
                console.error("[AutoCall][QR] QR library not loaded", qrMissingError);
                throw qrMissingError;
            }

            const canvas = document.getElementById("pairingQrCanvas");
            if (!(canvas instanceof HTMLCanvasElement)) {
                throw new Error("QR canvas not available");
            }

            if (!window.QRCode || typeof window.QRCode.toCanvas !== "function") {
                const qrApiError = new Error("QRCode.toCanvas is not available");
                console.error("[AutoCall][QR] QRCode.toCanvas is not available", qrApiError);
                throw qrApiError;
            }

            await window.QRCode.toCanvas(canvas, JSON.stringify(payload), {
                width: 210,
                margin: 1,
                color: {
                    dark: "#052453",
                    light: "#ffffff"
                }
            });
        }

        async function refreshPairingQrCode() {
            if (pairingQrRefreshInProgress) {
                return;
            }

            await waitForQrDomReady();
            pairingQrRefreshInProgress = true;
            setPairingQrStatus("Generating secure pairing QR...");
            clearPairingQrCanvas();

            try {
                const response = await apiFetch("/pairing/qr");
                let payload = {};
                try {
                    payload = await response.json();
                } catch (_error) {
                    payload = {};
                }
                if (!response.ok) {
                    throw new Error(parseApiErrorMessage(payload, "Failed to load pairing QR"));
                }

                const normalizedType = typeof payload?.type === "string" ? payload.type.trim() : "";
                const normalizedPairingToken =
                    typeof payload?.pairingToken === "string" ? payload.pairingToken.trim() : "";
                const normalizedManualPairingCode =
                    typeof payload?.manualPairingCode === "string"
                        ? payload.manualPairingCode.trim()
                        : "";
                const normalizedServerUrl =
                    typeof payload?.serverUrl === "string" && payload.serverUrl.trim()
                        ? payload.serverUrl.trim()
                        : SERVER;

                if (normalizedType !== PAIRING_QR_EXPECTED_TYPE || !normalizedPairingToken) {
                    throw new Error("Invalid pairing QR payload");
                }

                await renderPairingQrCode({
                    type: normalizedType,
                    pairingToken: normalizedPairingToken,
                    serverUrl: normalizedServerUrl
                });

                setManualPairingCodeValue(normalizedManualPairingCode);
                startPairingQrCountdown(payload?.expiresAt);
                setPairingQrStatus("Scan QR from mobile app to pair this device.", "success");
            } catch (error) {
                clearPairingQrCountdown();
                pairingQrExpiresAtMs = 0;
                updatePairingQrMeta();
                setManualPairingCodeValue("");
                setPairingQrStatus(error?.message || "Failed to generate pairing QR", "error");
            } finally {
                pairingQrRefreshInProgress = false;
            }
        }

        async function refreshDevicesFromPairingModal() {
            await loadDevices();
            await loadDevicesToSelect();
            showToast("Devices refreshed", "success");
        }

        function resetPairingQrState() {
            clearPairingQrCountdown();
            pairingQrRefreshInProgress = false;
            pairingQrExpiresAtMs = 0;
            clearPairingQrCanvas();
            setPairingQrStatus("Preparing secure pairing QR...");
            setManualPairingCodeValue("");
            updatePairingQrMeta();
        }

        function openClaimDeviceModal() {
            const overlay = document.getElementById("claimDeviceOverlay");
            if (!overlay) return;
            overlay.classList.remove("panel-hidden");
            setClaimDeviceModalTriggerExpanded(true);
            syncOverlayScrollLock();
            resetPairingQrState();
            void refreshPairingQrCode();
        }

        function closeClaimDeviceModal() {
            const overlay = document.getElementById("claimDeviceOverlay");
            if (!overlay) return;
            overlay.classList.add("panel-hidden");
            setClaimDeviceModalTriggerExpanded(false);
            resetPairingQrState();
            syncOverlayScrollLock();
        }

        function handleClaimDeviceOverlayClick(event) {
            const overlay = document.getElementById("claimDeviceOverlay");
            if (!overlay) return;
            if (event.target === overlay) {
                closeClaimDeviceModal();
            }
        }

        function closeDeviceActionDialog(result = { confirmed: false }) {
            const overlay = document.getElementById("deviceActionOverlay");
            const input = document.getElementById("deviceActionNameInput");
            const inputWrap = document.getElementById("deviceActionInputWrap");
            const confirmBtn = document.getElementById("deviceActionConfirmBtn");

            if (deviceActionOverlayCloseTimerId) {
                clearTimeout(deviceActionOverlayCloseTimerId);
                deviceActionOverlayCloseTimerId = null;
            }

            if (overlay && !overlay.classList.contains("panel-hidden")) {
                overlay.classList.remove("is-visible");
                deviceActionOverlayCloseTimerId = setTimeout(() => {
                    overlay.classList.add("panel-hidden");
                    deviceActionOverlayCloseTimerId = null;
                    syncOverlayScrollLock();
                }, DEVICE_ACTION_OVERLAY_ANIMATION_MS);
            }

            if (input) input.value = "";
            if (inputWrap) inputWrap.classList.add("panel-hidden");
            if (confirmBtn) {
                confirmBtn.classList.remove("danger-button");
                confirmBtn.textContent = "Confirm";
            }

            const resolver = deviceActionDialogState.resolver;
            deviceActionDialogState.mode = "";
            deviceActionDialogState.resolver = null;
            if (typeof resolver === "function") {
                resolver(result);
            }
            syncOverlayScrollLock();
        }

        function cancelDeviceActionDialog() {
            closeDeviceActionDialog({ confirmed: false });
        }

        function handleDeviceActionOverlayClick(event) {
            const overlay = document.getElementById("deviceActionOverlay");
            if (!overlay) return;
            if (event.target === overlay) {
                cancelDeviceActionDialog();
            }
        }

        async function openDeviceActionDialog(config = {}) {
            const mode = config.mode === "rename" ? "rename" : "delete";
            const overlay = document.getElementById("deviceActionOverlay");
            const title = document.getElementById("deviceActionTitle");
            const message = document.getElementById("deviceActionMessage");
            const inputWrap = document.getElementById("deviceActionInputWrap");
            const input = document.getElementById("deviceActionNameInput");
            const confirmBtn = document.getElementById("deviceActionConfirmBtn");
            if (!overlay || !title || !message || !inputWrap || !input || !confirmBtn) {
                return { confirmed: false };
            }

            if (deviceActionOverlayCloseTimerId) {
                clearTimeout(deviceActionOverlayCloseTimerId);
                deviceActionOverlayCloseTimerId = null;
            }

            if (typeof deviceActionDialogState.resolver === "function") {
                deviceActionDialogState.resolver({ confirmed: false });
            }

            const deviceName = toNonEmptyString(config.deviceName) || "Unknown device";
            const deviceUid = toNonEmptyString(config.deviceUid) || "-";
            const safeName = escapeHtml(deviceName);
            const safeUid = escapeHtml(deviceUid);

            deviceActionDialogState.mode = mode;
            overlay.classList.remove("panel-hidden");

            if (mode === "rename") {
                title.textContent = "Rename Device";
                message.innerHTML = `Update device name for <span class="device-action-target">${safeName}</span> <span class="device-action-target">(${safeUid})</span>`;
                inputWrap.classList.remove("panel-hidden");
                input.value = deviceName;
                confirmBtn.textContent = "Save";
                confirmBtn.classList.remove("danger-button");
            } else {
                title.textContent = "Delete Device";
                message.innerHTML = `Delete device <span class="device-action-target">${safeName}</span> <span class="device-action-target">(${safeUid})</span>?`;
                inputWrap.classList.add("panel-hidden");
                input.value = "";
                confirmBtn.textContent = "Delete";
                confirmBtn.classList.add("danger-button");
            }

            requestAnimationFrame(() => {
                overlay.classList.add("is-visible");
                if (mode === "rename") {
                    input.focus();
                    input.select();
                } else {
                    confirmBtn.focus();
                }
            });

            syncOverlayScrollLock();

            return await new Promise((resolve) => {
                deviceActionDialogState.resolver = resolve;
            });
        }

        function confirmDeviceActionDialog() {
            const mode = deviceActionDialogState.mode;
            if (!mode) return;

            if (mode === "rename") {
                const input = document.getElementById("deviceActionNameInput");
                const nextName = String(input?.value || "").trim();
                if (!nextName) {
                    showToast("Please enter a device name", "error");
                    if (input) input.focus();
                    return;
                }
                closeDeviceActionDialog({
                    confirmed: true,
                    value: nextName
                });
                return;
            }

            closeDeviceActionDialog({
                confirmed: true
            });
        }

        function initializeDeviceActionDialog() {
            const input = document.getElementById("deviceActionNameInput");
            if (!input) return;
            input.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                confirmDeviceActionDialog();
            });
        }

        function closeContactSaveDialog(result = { confirmed: false }) {
            const overlay = document.getElementById("contactSaveOverlay");
            const input = document.getElementById("contactSaveNameInput");

            if (contactSaveOverlayCloseTimerId) {
                clearTimeout(contactSaveOverlayCloseTimerId);
                contactSaveOverlayCloseTimerId = null;
            }

            if (overlay && !overlay.classList.contains("panel-hidden")) {
                overlay.classList.remove("is-visible");
                contactSaveOverlayCloseTimerId = setTimeout(() => {
                    overlay.classList.add("panel-hidden");
                    contactSaveOverlayCloseTimerId = null;
                    syncOverlayScrollLock();
                }, CONTACT_SAVE_OVERLAY_ANIMATION_MS);
            }

            if (input) input.value = "";

            const resolver = contactSaveDialogState.resolver;
            contactSaveDialogState.resolver = null;
            if (typeof resolver === "function") {
                resolver(result);
            }
            syncOverlayScrollLock();
        }

        function cancelContactSaveDialog() {
            closeContactSaveDialog({ confirmed: false });
        }

        function handleContactSaveOverlayClick(event) {
            const overlay = document.getElementById("contactSaveOverlay");
            if (!overlay) return;
            if (event.target === overlay) {
                cancelContactSaveDialog();
            }
        }

        async function openContactSaveDialog(config = {}) {
            const overlay = document.getElementById("contactSaveOverlay");
            const title = document.getElementById("contactSaveTitle");
            const message = document.getElementById("contactSaveMessage");
            const input = document.getElementById("contactSaveNameInput");
            const confirmBtn = document.getElementById("contactSaveConfirmBtn");
            if (!overlay || !title || !message || !input || !confirmBtn) {
                return { confirmed: false };
            }

            if (contactSaveOverlayCloseTimerId) {
                clearTimeout(contactSaveOverlayCloseTimerId);
                contactSaveOverlayCloseTimerId = null;
            }

            if (typeof contactSaveDialogState.resolver === "function") {
                contactSaveDialogState.resolver({ confirmed: false });
            }

            const phoneNumber = toNonEmptyString(config.phoneNumber) || "-";
            const safePhone = escapeHtml(phoneNumber);

            title.textContent = "Save Contact";
            message.innerHTML = `Create a contact name for the number <span class="device-action-target">${safePhone}</span>`;
            input.value = "";
            confirmBtn.textContent = "Save";

            overlay.classList.remove("panel-hidden");

            requestAnimationFrame(() => {
                overlay.classList.add("is-visible");
                input.focus();
            });

            syncOverlayScrollLock();

            return await new Promise((resolve) => {
                contactSaveDialogState.resolver = resolve;
            });
        }

        function confirmContactSaveDialog() {
            const input = document.getElementById("contactSaveNameInput");
            const name = String(input?.value || "").trim();
            if (!name) {
                showToast("Please enter a contact name", "error");
                if (input) input.focus();
                return;
            }
            closeContactSaveDialog({
                confirmed: true,
                value: name
            });
        }

        function initializeContactSaveDialog() {
            const input = document.getElementById("contactSaveNameInput");
            if (!input) return;
            input.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                confirmContactSaveDialog();
            });
        }

        function closeCommandConfirmDialog(confirmed = false) {
            const overlay = document.getElementById("commandConfirmOverlay");
            const approveBtn = document.getElementById("commandConfirmApproveBtn");

            if (commandConfirmOverlayCloseTimerId) {
                clearTimeout(commandConfirmOverlayCloseTimerId);
                commandConfirmOverlayCloseTimerId = null;
            }

            if (overlay && !overlay.classList.contains("panel-hidden")) {
                overlay.classList.remove("is-visible");
                commandConfirmOverlayCloseTimerId = setTimeout(() => {
                    overlay.classList.add("panel-hidden");
                    commandConfirmOverlayCloseTimerId = null;
                    syncOverlayScrollLock();
                }, COMMAND_CONFIRM_OVERLAY_ANIMATION_MS);
            }

            if (approveBtn) {
                approveBtn.disabled = false;
                approveBtn.textContent = "Confirm";
            }

            const resolver = commandConfirmDialogState.resolver;
            commandConfirmDialogState.resolver = null;
            if (typeof resolver === "function") {
                resolver(Boolean(confirmed));
            }
            syncOverlayScrollLock();
        }

        function cancelCommandConfirmDialog() {
            closeCommandConfirmDialog(false);
        }

        function confirmCommandConfirmDialog() {
            closeCommandConfirmDialog(true);
        }

        function handleCommandConfirmOverlayClick(event) {
            const overlay = document.getElementById("commandConfirmOverlay");
            if (!overlay) return;
            if (event.target === overlay) {
                cancelCommandConfirmDialog();
            }
        }

        async function openCommandConfirmDialog(config = {}) {
            const overlay = document.getElementById("commandConfirmOverlay");
            const titleElement = document.getElementById("commandConfirmTitle");
            const messageElement = document.getElementById("commandConfirmMessage");
            const approveBtn = document.getElementById("commandConfirmApproveBtn");
            if (!overlay || !titleElement || !messageElement || !approveBtn) {
                return false;
            }

            if (commandConfirmOverlayCloseTimerId) {
                clearTimeout(commandConfirmOverlayCloseTimerId);
                commandConfirmOverlayCloseTimerId = null;
            }

            if (typeof commandConfirmDialogState.resolver === "function") {
                commandConfirmDialogState.resolver(false);
            }

            titleElement.textContent = toNonEmptyString(config.title) || "Confirm Action";
            messageElement.textContent = toNonEmptyString(config.message) || "Are you sure?";
            approveBtn.textContent = toNonEmptyString(config.confirmLabel) || "Confirm";
            approveBtn.disabled = false;

            overlay.classList.remove("panel-hidden");
            requestAnimationFrame(() => {
                overlay.classList.add("is-visible");
                approveBtn.focus();
            });

            syncOverlayScrollLock();

            return await new Promise((resolve) => {
                commandConfirmDialogState.resolver = resolve;
            });
        }

        function initializeCommandConfirmDialog() {
            const overlay = document.getElementById("commandConfirmOverlay");
            if (!overlay) return;
            overlay.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                const target = event.target;
                if (target instanceof HTMLElement && isTextEntryElement(target)) {
                    return;
                }
                event.preventDefault();
                confirmCommandConfirmDialog();
            });
        }

        function rememberDevices(devices) {
            deviceNameByUid.clear();
            if (!Array.isArray(devices)) return;

            devices.forEach((device) => {
                const rawUid = typeof device?.deviceUid === "string" ? device.deviceUid.trim().toLowerCase() : "";
                const rawName = typeof device?.deviceName === "string" ? device.deviceName.trim() : "";
                if (!rawUid) return;
                if (rawName) {
                    deviceNameByUid.set(rawUid, rawName);
                }
            });
        }

        function escapeHtml(value) {
            return String(value)
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll("\"", "&quot;")
                .replaceAll("'", "&#39;");
        }

        function asDisplayValue(value) {
            return value === null || value === undefined || value === "" ? "-" : String(value);
        }

        function showToast(message, type = "info") {
            const container = document.getElementById("toastContainer");
            if (!container) return;

            const toast = document.createElement("div");
            toast.className = `toast toast-${type}`;
            toast.textContent = String(message || "");
            container.appendChild(toast);

            setTimeout(() => {
                toast.classList.add("toast-out");
                setTimeout(() => {
                    toast.remove();
                }, 220);
            }, 5000);
        }

        function parseApiErrorMessage(payload, fallbackMessage) {
            if (payload && typeof payload.error === "string" && payload.error.trim()) {
                return payload.error.trim();
            }
            return fallbackMessage;
        }

        function setAuthenticatedUser(accessToken, user, persistToken = true) {
            authToken = typeof accessToken === "string" ? accessToken.trim() : "";
            authenticatedUser = user && typeof user === "object" ? user : null;

            if (persistToken && authToken) {
                localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, authToken);
            }

            const authSection = document.getElementById("authSection");
            const appSection = document.getElementById("appSection");
            const sessionInfo = document.getElementById("sessionInfo");
            if (authSection) {
                authSection.classList.add("panel-hidden");
            }
            if (appSection) {
                appSection.classList.remove("panel-hidden");
            }
            if (sessionInfo) {
                sessionInfo.classList.remove("panel-hidden");
            }
            const headerCollectionsBtn = document.getElementById("headerCollectionsBtn");
            if (headerCollectionsBtn) {
                headerCollectionsBtn.classList.remove("panel-hidden");
            }
            const aiAgentWidget = document.getElementById("aiAgentWidget");
            if (aiAgentWidget) {
                aiAgentWidget.classList.remove("panel-hidden");
            }
            hideScreenMirrorCard(true);
            const socket = ensureScreenMirrorSocket();
            if (socket && !socket.connected) {
                socket.connect();
            }
            startCommandsAutoRefresh();

            // Load saved contacts for address book autocomplete
            void loadContacts();
        }

        function clearAuthenticatedUser(removeStoredToken = true) {
            authToken = "";
            authenticatedUser = null;
            deviceNameByUid.clear();
            selectedCommandSubscriptionIdByDeviceUid.clear();
            stopCommandsAutoRefresh();
            stopDevicesSelectRefresh();
            disconnectScreenMirrorSocket();
            clearAllScreenMirrorMultiPointerGestures();
            activeScreenMirrorDeviceUids.clear();
            screenMirrorDeviceStateByUid.clear();
            dockScreenMirror();
            unpinScreenMirrorDevice({ immediate: true, renderGrid: false });
            resetScreenMirrorView();
            renderScreenMirrorMultiGrid();
            populateDeviceSelect(getGlobalDeviceSelectElement(), [], "");
            joinScreenMirrorDashboardRoom("");

            const authSection = document.getElementById("authSection");
            const appSection = document.getElementById("appSection");
            const sessionInfo = document.getElementById("sessionInfo");
            if (authSection) {
                authSection.classList.remove("panel-hidden");
            }
            if (appSection) {
                appSection.classList.add("panel-hidden");
            }
            if (sessionInfo) {
                sessionInfo.classList.add("panel-hidden");
            }
            const headerCollectionsBtn = document.getElementById("headerCollectionsBtn");
            if (headerCollectionsBtn) {
                headerCollectionsBtn.classList.add("panel-hidden");
            }
            const aiAgentWidget = document.getElementById("aiAgentWidget");
            if (aiAgentWidget) {
                aiAgentWidget.classList.add("panel-hidden");
            }
            const aiChatPopup = document.getElementById("aiChatPopup");
            if (aiChatPopup) {
                aiChatPopup.classList.remove("active");
            }
            hideScreenMirrorCard(true);

            commandDashboardJoinedDeviceUids.clear();
            commandsCache = [];
            renderDevicesTable([]);
            renderCommandsFromCache();
            setRawFallback("devices", [], false);

            panelVisibility.commands = false;
            panelVisibility.contacts = false;
            updatePanelToggleUI("commands");
            updatePanelToggleUI("contacts");
            
            const commandsContent = document.getElementById("commandsPanelContent");
            if (commandsContent) {
                commandsContent.classList.remove("is-open");
                commandsContent.style.maxHeight = "0px";
            }
            const contactsContent = document.getElementById("contactsPanelContent");
            if (contactsContent) {
                contactsContent.classList.remove("is-open");
                contactsContent.style.maxHeight = "0px";
            }

            // Clear address book autocomplete datalist
            clearContactsDatalist();

            if (removeStoredToken) {
                localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
            }
        }

        function stopDevicesSelectRefresh() {
            if (refreshDevicesIntervalId) {
                clearInterval(refreshDevicesIntervalId);
                refreshDevicesIntervalId = null;
            }
        }

        function startDevicesSelectRefresh() {
            stopDevicesSelectRefresh();
            refreshDevicesIntervalId = setInterval(() => {
                void loadDevicesToSelect();
            }, 10000);
        }

        async function apiFetch(path, options = {}) {
            const isAuthRoute = path.startsWith("/auth/");
            const headers = {
                ...(options.headers || {})
            };

            if (!isAuthRoute) {
                if (!authToken) {
                    throw new Error("Please login first");
                }
                headers.Authorization = `Bearer ${authToken}`;
            }

            const response = await fetch(SERVER + path, {
                ...options,
                headers
            });

            if (!isAuthRoute && response.status === 401) {
                clearAuthenticatedUser(true);
                throw new Error("Session expired. Please login again.");
            }

            return response;
        }

        async function fetchCurrentUserProfile(token) {
            const response = await fetch(SERVER + "/auth/me", {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });

            if (!response.ok) {
                return null;
            }

            const payload = await response.json();
            return payload?.user ?? null;
        }

        async function initializeSession() {
            const storedToken = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
            if (!storedToken) {
                clearAuthenticatedUser(false);
                return;
            }

            try {
                const user = await fetchCurrentUserProfile(storedToken);
                if (!user) {
                    clearAuthenticatedUser(true);
                    return;
                }

                setAuthenticatedUser(storedToken, user, false);
                await loadDevicesToSelect();
                await loadDevices();
                await loadCommands();
                startDevicesSelectRefresh();
            } catch (_error) {
                clearAuthenticatedUser(true);
            }
        }

        async function login() {
            const username = normalizeUsername(document.getElementById("authUsername")?.value || "");
            const password = String(document.getElementById("authPassword")?.value || "");

            if (!username || !password) {
                showToast("Username and password are required", "error");
                return;
            }

            try {
                const response = await apiFetch("/auth/login", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ username, password })
                });
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(parseApiErrorMessage(payload, "Login failed"));
                }

                const token = typeof payload.accessToken === "string" ? payload.accessToken : "";
                if (!token) {
                    throw new Error("Login failed: missing access token");
                }

                setAuthenticatedUser(token, payload.user ?? null, true);
                await loadDevicesToSelect();
                await loadDevices();
                await loadCommands();
                startDevicesSelectRefresh();
                showToast("Logged in successfully", "success");
            } catch (error) {
                showToast(error.message || "Login failed", "error");
            }
        }

        function logout() {
            clearAuthenticatedUser(true);
            showToast("Logged out", "info");
        }

        let activeInstructionsPage = 1;

        function renderInstructionsPage() {
            const page1 = document.getElementById("instructionsPage1");
            const page2 = document.getElementById("instructionsPage2");
            const page3 = document.getElementById("instructionsPage3");
            const pageIndicator = document.getElementById("instructionsPageIndicator");
            const backButton = document.getElementById("instructionsBackBtn");
            const nextButton = document.getElementById("instructionsNextBtn");

            if (!page1 || !page2 || !page3 || !pageIndicator || !backButton || !nextButton) {
                return;
            }

            const onFirstPage = activeInstructionsPage === 1;
            const onLastPage = activeInstructionsPage === 3;
            page1.classList.toggle("panel-hidden", activeInstructionsPage !== 1);
            page2.classList.toggle("panel-hidden", activeInstructionsPage !== 2);
            page3.classList.toggle("panel-hidden", activeInstructionsPage !== 3);

            pageIndicator.textContent = `${activeInstructionsPage} / 3`;
            backButton.classList.toggle("panel-hidden", onFirstPage);
            nextButton.classList.toggle("panel-hidden", onLastPage);
        }

        function goToInstructionsPage(pageNumber) {
            activeInstructionsPage = Math.min(Math.max(Number(pageNumber) || 1, 1), 3);
            renderInstructionsPage();
        }

        function goToPreviousInstructionsPage() {
            goToInstructionsPage(activeInstructionsPage - 1);
        }

        function goToNextInstructionsPage() {
            goToInstructionsPage(activeInstructionsPage + 1);
        }

        function openInstructions() {
            const overlay = document.getElementById("instructionsOverlay");
            if (!overlay) return;
            if (instructionsOverlayCloseTimerId) {
                clearTimeout(instructionsOverlayCloseTimerId);
                instructionsOverlayCloseTimerId = null;
            }
            activeInstructionsPage = 1;
            renderInstructionsPage();
            overlay.classList.remove("panel-hidden");
            requestAnimationFrame(() => {
                overlay.classList.add("is-visible");
            });
            syncOverlayScrollLock();
        }

        function closeInstructions() {
            const overlay = document.getElementById("instructionsOverlay");
            if (!overlay) return;
            overlay.classList.remove("is-visible");
            if (instructionsOverlayCloseTimerId) {
                clearTimeout(instructionsOverlayCloseTimerId);
            }
            instructionsOverlayCloseTimerId = setTimeout(() => {
                overlay.classList.add("panel-hidden");
                instructionsOverlayCloseTimerId = null;
                syncOverlayScrollLock();
            }, INSTRUCTIONS_OVERLAY_ANIMATION_MS);
            syncOverlayScrollLock();
        }

        function handleInstructionsOverlayClick(event) {
            const overlay = document.getElementById("instructionsOverlay");
            if (!overlay) return;
            if (event.target === overlay) {
                closeInstructions();
            }
        }

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeInstructions();
                closeClaimDeviceModal();
                cancelDeviceActionDialog();
                cancelCommandConfirmDialog();
                cancelContactSaveDialog();
                closeAddressBookModal();
            }
        });

        function parseDateValue(dateText) {
            if (!dateText) return 0;

            if (typeof dateText === "number") {
                return Number.isFinite(dateText) ? dateText : 0;
            }

            if (typeof dateText !== "string") {
                return 0;
            }

            const normalized = dateText.trim();
            const localFormatMatch = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})$/);
            if (localFormatMatch) {
                const [, day, month, year, hour, minute, second] = localFormatMatch;
                return new Date(
                    Number(year),
                    Number(month) - 1,
                    Number(day),
                    Number(hour),
                    Number(minute),
                    Number(second)
                ).getTime();
            }

            const parsed = Date.parse(normalized);
            return Number.isNaN(parsed) ? 0 : parsed;
        }

        function setRawFallback(id, value, showFallback) {
            const pre = document.getElementById(id);
            if (!pre) return;
            pre.innerText = JSON.stringify(value, null, 2);
            pre.style.display = showFallback ? "block" : "none";
        }

        function renderDevicesTable(devices) {
            const container = document.getElementById("devicesTable");
            if (!container) {
                return;
            }
            if (!Array.isArray(devices) || devices.length === 0) {
                container.innerHTML = "<p class='table-empty'>No devices available.</p>";
                return;
            }

            const rows = devices.map((device, index) => {
                const rawUid = typeof device.deviceUid === "string" ? device.deviceUid : "";
                const uid = escapeHtml(asDisplayValue(device.deviceUid));
                const deviceName = escapeHtml(asDisplayValue(device.deviceName));
                const renameValue = escapeHtml(typeof device.deviceName === "string" ? device.deviceName : "");
                const escapedRawUid = escapeHtml(rawUid);
                const renameInputId = `renameDeviceInput_${index}`;
                const onlineIndicator = device.online ? "🟢" : "🔴";
                const lastSeen = escapeHtml(asDisplayValue(device.lastSeen));
                return `
                    <tr>
                        <td>
                            <div class="device-name-line">${deviceName}</div>
                            <div class="device-uid-line">${uid}</div>
                        </td>
                        <td>${lastSeen} ${onlineIndicator}</td>
                        <td class="rename-cell">
                            <div class="rename-inline">
                                <input id="${renameInputId}" placeholder="Device name" value="${renameValue}" />
                                <button
                                    type="button"
                                    class="rename-device-btn"
                                    data-device-uid="${escapedRawUid}"
                                    data-input-id="${renameInputId}">
                                    Rename
                                </button>
                            </div>
                        </td>
                        <td class="table-action-cell">
                            <button
                                type="button"
                                class="device-delete-btn"
                                data-device-uid="${escapedRawUid}">
                                Delete
                            </button>
                        </td>
                    </tr>
                `;
            }).join("");

            container.innerHTML = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Device</th>
                            <th>Last Seen</th>
                            <th>Rename</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            `;

            container.querySelectorAll(".rename-device-btn").forEach((button) => {
                button.addEventListener("click", async () => {
                    const deviceUid = button.getAttribute("data-device-uid") || "";
                    const inputId = button.getAttribute("data-input-id") || "";
                    await renameDevice(deviceUid, inputId);
                });
            });

            container.querySelectorAll(".device-delete-btn").forEach((button) => {
                button.addEventListener("click", async () => {
                    const deviceUid = button.getAttribute("data-device-uid") || "";
                    await deleteDevice(deviceUid);
                });
            });
        }

        function toNonEmptyString(value) {
            if (typeof value !== "string") return "";
            const trimmed = value.trim();
            return trimmed ? trimmed : "";
        }

        function truncateText(value, maxLength) {
            const text = toNonEmptyString(value);
            if (!text) return "";
            const limit = Number.isInteger(maxLength) && maxLength > 0 ? maxLength : 60;
            if (text.length <= limit) return text;
            return `${text.slice(0, Math.max(1, limit - 3))}...`;
        }

        function getCommandType(command) {
            const fromType = toNonEmptyString(command?.type).toUpperCase();
            if (supportedCommandTypes.has(fromType)) {
                return fromType;
            }

            const normalizedAction = toNonEmptyString(command?.action).toLowerCase();
            const mappedType = commandActionToType[normalizedAction];
            return mappedType && supportedCommandTypes.has(mappedType) ? mappedType : "-";
        }

        function appendScheduledDetail(details, command) {
            const scheduledAt = toNonEmptyString(command?.scheduledAt);
            if (!scheduledAt) return details;

            const scheduledLabel = `Scheduled: ${scheduledAt}`;
            if (details.secondary) {
                details.secondary = `${details.secondary} | ${scheduledLabel}`;
                return details;
            }

            if (details.primary && details.primary !== "-") {
                details.secondary = scheduledLabel;
                return details;
            }

            details.primary = scheduledLabel;
            return details;
        }

        function appendCommandSubscriptionDetail(parts, command) {
            const subscriptionId = Number(command?.subscriptionId);
            if (Number.isInteger(subscriptionId) && subscriptionId >= 0) {
                parts.push(`SIM: subscription ${subscriptionId}`);
            }
        }

        function getCommandDetails(command) {
            const commandType = getCommandType(command);
            const details = {
                primary: "-",
                secondary: ""
            };

            if (commandType === "CALL") {
                const parts = [];
                const number = toNonEmptyString(command?.phoneNumber);
                if (number) {
                    parts.push(`Number: ${number}`);
                }

                const durationSeconds = Number(command?.durationSeconds);
                if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
                    parts.push(`Duration: ${Math.round(durationSeconds)}s`);
                }
                appendCommandSubscriptionDetail(parts, command);

                details.primary = parts.length ? parts.join(" | ") : "-";
                return appendScheduledDetail(details, command);
            }

            if (commandType === "SMS") {
                const parts = [];
                const number = toNonEmptyString(command?.phoneNumber);
                const message = truncateText(command?.message, 52);

                if (number) {
                    parts.push(`To: ${number}`);
                }
                if (message) {
                    parts.push(`Message: ${message}`);
                }
                appendCommandSubscriptionDetail(parts, command);

                details.primary = parts.length ? parts.join(" | ") : "-";
                return appendScheduledDetail(details, command);
            }

            if (commandType === "OPEN_URL") {
                details.primary = toNonEmptyString(command?.url) || "-";
                return appendScheduledDetail(details, command);
            }

            if (commandType === "OPEN_APP") {
                const appName = toNonEmptyString(command?.appName);
                const packageName = toNonEmptyString(command?.resolvedPackageName);
                details.primary = appName ? `App: ${appName}` : "-";
                details.secondary = packageName ? `Package: ${packageName}` : "";
                return appendScheduledDetail(details, command);
            }

            if (commandType === "DOWNLOAD_DATA") {
                const parts = [];
                const sizeMb = Number(command?.downloadSizeMb);
                if (Number.isFinite(sizeMb) && sizeMb > 0) {
                    parts.push(`Size: ${Math.round(sizeMb)} MB`);
                }

                const durationSeconds = Number(command?.downloadDurationSeconds);
                if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
                    parts.push(`Duration: ${Math.round(durationSeconds)} sec`);
                }

                details.primary = parts.length ? parts.join(" | ") : "-";
                return appendScheduledDetail(details, command);
            }

            if (commandType === "ACTIVATE_ESIM") {
                const activationCode = toNonEmptyString(command?.activationCode);
                if (activationCode) {
                    const visibleStart = activationCode.slice(0, 8);
                    const visibleEnd = activationCode.length > 14 ? activationCode.slice(-4) : "";
                    details.primary = visibleEnd
                        ? `Activation code: ${visibleStart}...${visibleEnd}`
                        : `Activation code: ${visibleStart}...`;
                } else {
                    details.primary = "Activate eSIM";
                }
                return appendScheduledDetail(details, command);
            }

            if (commandType === "DELETE_ESIM") {
                const subscriptionId = Number(command?.esimSubscriptionId);
                const portIndex = Number(command?.esimPortIndex);
                const parts = [];
                if (Number.isInteger(subscriptionId) && subscriptionId >= 0) {
                    parts.push(`Subscription: ${subscriptionId}`);
                }
                if (Number.isInteger(portIndex) && portIndex >= 0) {
                    parts.push(`Port: ${portIndex}`);
                }
                details.primary = parts.length ? parts.join(" | ") : "Delete eSIM";
                return appendScheduledDetail(details, command);
            }

            if (commandType === "AUTO_ANSWER") {
                const parts = [];
                if (typeof command?.enabled === "boolean") {
                    parts.push(`Enabled: ${command.enabled ? "Yes" : "No"}`);
                }

                const autoHangupSeconds = Number(command?.autoHangupSeconds);
                if (Number.isFinite(autoHangupSeconds) && autoHangupSeconds > 0) {
                    parts.push(`Auto hangup: ${Math.round(autoHangupSeconds)}s`);
                }

                details.primary = parts.length ? parts.join(" | ") : "-";
                return appendScheduledDetail(details, command);
            }

            if (commandType === "RETURN_TO_AUTOCALL") {
                details.primary = "Return app to foreground";
                return appendScheduledDetail(details, command);
            }

            if (commandType === "CLOSE_WEBVIEW") {
                details.primary = "Close WebView";
                return appendScheduledDetail(details, command);
            }

            if (commandType === "START_SCREEN_MIRROR") {
                details.primary = "Start live screen mirror";
                return appendScheduledDetail(details, command);
            }

            if (commandType === "STOP_SCREEN_MIRROR") {
                details.primary = "Stop live screen mirror";
                return appendScheduledDetail(details, command);
            }

            if (commandType === "SCREEN_TOUCH") {
                const touchTarget = toNonEmptyString(command?.touchTarget);
                if (touchTarget) {
                    details.primary = `Global action: ${touchTarget.toUpperCase()}`;
                    return appendScheduledDetail(details, command);
                }

                const x = Number(command?.x);
                const y = Number(command?.y);
                const screenWidth = Number(command?.screenWidth);
                const screenHeight = Number(command?.screenHeight);
                if (
                    Number.isFinite(x) &&
                    Number.isFinite(y) &&
                    Number.isFinite(screenWidth) &&
                    Number.isFinite(screenHeight)
                ) {
                    details.primary = `Tap: (${Math.round(x)}, ${Math.round(y)})`;
                    details.secondary = `Screen: ${Math.round(screenWidth)} x ${Math.round(screenHeight)}`;
                } else {
                    details.primary = "Tap on mirrored screen";
                }
                return appendScheduledDetail(details, command);
            }

            if (commandType === "SCREEN_SWIPE") {
                const startX = Number(command?.startX);
                const startY = Number(command?.startY);
                const endX = Number(command?.endX);
                const endY = Number(command?.endY);
                const durationMs = Number(command?.durationMs);
                if (
                    Number.isFinite(startX) &&
                    Number.isFinite(startY) &&
                    Number.isFinite(endX) &&
                    Number.isFinite(endY)
                ) {
                    details.primary =
                        `Swipe: (${Math.round(startX)}, ${Math.round(startY)}) -> ` +
                        `(${Math.round(endX)}, ${Math.round(endY)})`;
                    if (Number.isFinite(durationMs) && durationMs > 0) {
                        details.secondary = `Duration: ${Math.round(durationMs)} ms`;
                    }
                } else {
                    details.primary = "Swipe on mirrored screen";
                }
                return appendScheduledDetail(details, command);
            }

            if (commandType === "END") {
                details.primary = "End current call";
                return appendScheduledDetail(details, command);
            }

            return appendScheduledDetail(details, command);
        }

        function getCommandNotes(command) {
            return toNonEmptyString(command?.notes) || "-";
        }

        async function cancelPendingCommandAndSendEnd(commandId, deviceUid) {
            const normalizedCommandId = toNonEmptyString(commandId);
            const normalizedDeviceUid = normalizeDeviceUidInput(deviceUid || "");
            if (!normalizedCommandId || !normalizedDeviceUid) {
                showToast("Invalid command", "error");
                return false;
            }

            const confirmed = await openCommandConfirmDialog({
                title: "Cancel Pending Command",
                message: `Cancel pending command for device ${normalizedDeviceUid} and send END command?`,
                confirmLabel: "Cancel + Send END"
            });
            if (!confirmed) {
                return false;
            }

            try {
                const response = await apiFetch(
                    `/commands/${encodeURIComponent(normalizedCommandId)}/cancel-and-end`,
                    {
                        method: "POST"
                    }
                );
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(parseApiErrorMessage(payload, "Failed to cancel pending command"));
                }

                const message = payload?.endCommand
                    ? "Pending command cancelled and END command queued"
                    : "Pending command cancelled";
                showToast(message, "success");
                await loadCommands();
                return true;
            } catch (error) {
                showToast(error.message || "Failed to cancel pending command", "error");
                return false;
            }
        }

        function getStatusMeta(status) {
            const normalizedStatus = toNonEmptyString(status).toLowerCase();
            if (normalizedStatus === "executed") {
                return { label: "executed", className: "status-executed" };
            }
            if (normalizedStatus === "failed") {
                return { label: "failed", className: "status-failed" };
            }
            if (normalizedStatus === "cancelled") {
                return { label: "cancelled", className: "status-cancelled" };
            }
            if (normalizedStatus === "pending") {
                return { label: "pending", className: "status-pending" };
            }
            if (normalizedStatus === "executing") {
                return { label: "executing", className: "status-executing" };
            }
            return { label: normalizedStatus || "unknown", className: "status-unknown" };
        }

        function sortCommands(commands) {
            return [...commands].sort((a, b) => {
                const aStatus = String(a.status || "").toLowerCase();
                const bStatus = String(b.status || "").toLowerCase();
                const aPriority = aStatus in statusPriority ? statusPriority[aStatus] : Number.MAX_SAFE_INTEGER;
                const bPriority = bStatus in statusPriority ? statusPriority[bStatus] : Number.MAX_SAFE_INTEGER;

                if (prioritizeActiveStatuses && aPriority !== bPriority) {
                    return aPriority - bPriority;
                }

                return parseDateValue(b.createdAt) - parseDateValue(a.createdAt);
            });
        }

        function renderCommandsTable(commands) {
            const container = document.getElementById("commandsTable");
            if (!Array.isArray(commands) || commands.length === 0) {
                container.innerHTML = "<p class='table-empty'>No commands available.</p>";
                return;
            }

            const rows = sortCommands(commands).map((command) => {
                const normalizedUid =
                    typeof command.deviceUid === "string" ? command.deviceUid.trim().toLowerCase() : "";
                const resolvedName =
                    (typeof command.deviceName === "string" && command.deviceName.trim()) ||
                    deviceNameByUid.get(normalizedUid) ||
                    "-";
                const device = `
                    <div class="device-name-line">${escapeHtml(asDisplayValue(resolvedName))}</div>
                    <div class="device-uid-line">${escapeHtml(asDisplayValue(command.deviceUid))}</div>
                `;
                const commandType = getCommandType(command);
                const details = getCommandDetails(command);
                const detailsPrimary = toNonEmptyString(details?.primary) || "-";
                const detailsSecondary = toNonEmptyString(details?.secondary);
                const detailsTitle = detailsSecondary
                    ? `${detailsPrimary} | ${detailsSecondary}`
                    : detailsPrimary;
                const detailsSecondaryHtml = detailsSecondary
                    ? `<span class="command-details-subtle" title="${escapeHtml(detailsSecondary)}">${escapeHtml(detailsSecondary)}</span>`
                    : "";

                const statusMeta = getStatusMeta(command?.status);
                const createdAt = asDisplayValue(command?.createdAt);
                const notesText = getCommandNotes(command);
                const commandId = toNonEmptyString(command?.id);
                const canCancelAndEnd =
                    toNonEmptyString(command?.status).toLowerCase() === "pending" &&
                    Boolean(commandId) &&
                    Boolean(normalizedUid);
                const actionContent = canCancelAndEnd
                    ? `
                        <button
                            type="button"
                            class="command-cancel-btn"
                            data-command-action="cancel-and-end"
                            data-command-id="${escapeHtml(commandId)}"
                            data-device-uid="${escapeHtml(normalizedUid)}">
                            Cancel + END
                        </button>
                    `
                    : "";

                return `
                    <tr>
                        <td>${device}</td>
                        <td><span class="command-type-text">${escapeHtml(commandType)}</span></td>
                        <td>
                            <span class="command-details-main" title="${escapeHtml(detailsTitle)}">${escapeHtml(detailsPrimary)}</span>
                            ${detailsSecondaryHtml}
                        </td>
                        <td>
                            <span class="status-pill ${statusMeta.className}">${escapeHtml(statusMeta.label)}</span>
                        </td>
                        <td>${escapeHtml(createdAt)}</td>
                        <td>
                            <div class="command-notes-cell">
                                ${actionContent}
                            <span class="command-notes-text" title="${escapeHtml(notesText)}">${escapeHtml(notesText)}</span>
                            </div>
                        </td>
                    </tr>
                `;
            }).join("");

            container.innerHTML = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Device</th>
                            <th>Command</th>
                            <th>Details</th>
                            <th>Status</th>
                            <th>Created</th>
                            <th>Notes</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            `;

            container
                .querySelectorAll("[data-command-action='cancel-and-end']")
                .forEach((button) => {
                    button.addEventListener("click", async () => {
                        const commandId = button.getAttribute("data-command-id") || "";
                        const deviceUid = button.getAttribute("data-device-uid") || "";
                        const originalLabel = toNonEmptyString(button.textContent) || "Cancel + END";
                        button.disabled = true;
                        button.textContent = "Processing...";
                        try {
                            await cancelPendingCommandAndSendEnd(commandId, deviceUid);
                        } finally {
                            button.disabled = false;
                            button.textContent = originalLabel;
                        }
                    });
                });
        }

        function setActionTab(tab) {
            const targetTab = tabOrder[tab] !== undefined ? tab : "call";
            const previousTab = activeTab;
            activeTab = targetTab;
            const isCall = activeTab === "call";
            const isSms = activeTab === "sms";
            const isAutoAnswer = activeTab === "auto_answer";
            const isOpenApp = activeTab === "open_app";
            const isDownloadData = activeTab === "download_data";
            const isActivateEsim = activeTab === "activate_esim";
            const isWebView = activeTab === "webview";

            const callPanel = document.getElementById("callTabPanel");
            const smsPanel = document.getElementById("smsTabPanel");
            const autoAnswerPanel = document.getElementById("autoAnswerTabPanel");
            const openAppPanel = document.getElementById("openAppTabPanel");
            const downloadDataPanel = document.getElementById("downloadDataTabPanel");
            const activateEsimPanel = document.getElementById("activateEsimTabPanel");
            const webViewPanel = document.getElementById("webViewTabPanel");
            const panels = [callPanel, smsPanel, autoAnswerPanel, openAppPanel, downloadDataPanel, activateEsimPanel, webViewPanel];
            panels.forEach((panel) => panel.classList.remove("tab-enter-left", "tab-enter-right"));

            callPanel.classList.toggle("active", isCall);
            smsPanel.classList.toggle("active", isSms);
            autoAnswerPanel.classList.toggle("active", isAutoAnswer);
            openAppPanel.classList.toggle("active", isOpenApp);
            downloadDataPanel.classList.toggle("active", isDownloadData);
            activateEsimPanel.classList.toggle("active", isActivateEsim);
            webViewPanel.classList.toggle("active", isWebView);

            if (targetTab !== previousTab) {
                const targetPanel = isCall
                    ? callPanel
                    : isSms
                        ? smsPanel
                        : isAutoAnswer
                            ? autoAnswerPanel
                        : isOpenApp
                            ? openAppPanel
                            : isDownloadData
                                ? downloadDataPanel
                                : isActivateEsim
                                    ? activateEsimPanel
                                    : webViewPanel;
                const movingForward = tabOrder[targetTab] > tabOrder[previousTab];
                const animationClass = movingForward ? "tab-enter-right" : "tab-enter-left";
                void targetPanel.offsetWidth;
                targetPanel.classList.add(animationClass);
            }

            document.getElementById("callTabBtn").classList.toggle("active", isCall);
            document.getElementById("smsTabBtn").classList.toggle("active", isSms);
            document.getElementById("autoAnswerTabBtn").classList.toggle("active", isAutoAnswer);
            document.getElementById("openAppTabBtn").classList.toggle("active", isOpenApp);
            document.getElementById("downloadDataTabBtn").classList.toggle("active", isDownloadData);
            document.getElementById("activateEsimTabBtn").classList.toggle("active", isActivateEsim);
            document.getElementById("webViewTabBtn").classList.toggle("active", isWebView);

            document.getElementById("callTabBtn").setAttribute("aria-selected", String(isCall));
            document.getElementById("smsTabBtn").setAttribute("aria-selected", String(isSms));
            document.getElementById("autoAnswerTabBtn").setAttribute("aria-selected", String(isAutoAnswer));
            document.getElementById("openAppTabBtn").setAttribute("aria-selected", String(isOpenApp));
            document.getElementById("downloadDataTabBtn").setAttribute("aria-selected", String(isDownloadData));
            document.getElementById("activateEsimTabBtn").setAttribute("aria-selected", String(isActivateEsim));
            document.getElementById("webViewTabBtn").setAttribute("aria-selected", String(isWebView));
        }

        function updatePanelToggleUI(panelName) {
            const capitalizedName = panelName.charAt(0).toUpperCase() + panelName.slice(1);
            const buttonId = `toggle${capitalizedName}Btn`;
            const labelId = `toggle${capitalizedName}Label`;
            const isVisible = Boolean(panelVisibility[panelName]);

            const button = document.getElementById(buttonId);
            const label = document.getElementById(labelId);
            if (!button || !label) {
                return;
            }

            button.classList.toggle("active", isVisible);
            button.classList.toggle("inactive", !isVisible);
            label.textContent = isVisible ? "Hide" : "Show";
        }

        function setPanelContentVisibility(contentElement, isVisible) {
            if (!contentElement) return;

            if (isVisible) {
                contentElement.classList.add("is-open");
                contentElement.style.maxHeight = "0px";
                requestAnimationFrame(() => {
                    contentElement.style.maxHeight = `${contentElement.scrollHeight}px`;
                });

                const handleOpenEnd = (event) => {
                    if (event.propertyName !== "max-height") return;
                    if (contentElement.classList.contains("is-open")) {
                        contentElement.style.maxHeight = "none";
                    }
                    contentElement.removeEventListener("transitionend", handleOpenEnd);
                };
                contentElement.addEventListener("transitionend", handleOpenEnd);
            } else {
                const currentHeight = contentElement.scrollHeight;
                contentElement.style.maxHeight = `${currentHeight}px`;
                void contentElement.offsetHeight;
                contentElement.classList.remove("is-open");
                contentElement.style.maxHeight = "0px";
            }
        }

        async function togglePanel(panelName) {
            const capitalizedName = panelName.charAt(0).toUpperCase() + panelName.slice(1);
            const contentId = `${panelName}PanelContent`;

            panelVisibility[panelName] = !panelVisibility[panelName];
            const isVisible = panelVisibility[panelName];

            const contentElement = document.getElementById(contentId);
            setPanelContentVisibility(contentElement, isVisible);
            updatePanelToggleUI(panelName);

            if (isVisible) {
                if (panelName === "commands") {
                    await loadCommands();
                } else if (panelName === "contacts") {
                    await loadContactsList();
                }
            }
        }

        async function loadDevices() {
            try {
                const res = await apiFetch("/devices");
                if (!res.ok) throw new Error("Failed to load devices");
                const data = await res.json();
                rememberDevices(data);
                syncCommandDashboardSubscriptions(data);
                renderDevicesTable(data);
                renderActiveEsimProfiles();
                setRawFallback("devices", data, false);
            } catch (error) {
                renderDevicesTable([]);
                setRawFallback("devices", {
                    error: error.message
                }, true);
            }
        }

        async function renameDeviceByValue(deviceUid, deviceName) {
            const normalizedUid = normalizeDeviceUidInput(deviceUid || "");
            const normalizedName = String(deviceName || "").trim();
            if (!normalizedUid) {
                showToast("Invalid device UID", "error");
                return;
            }
            if (!normalizedName) {
                showToast("Please enter a device name", "error");
                return;
            }

            try {
                const res = await apiFetch("/devices/rename", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        deviceUid: normalizedUid,
                        deviceName: normalizedName
                    })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to rename device");

                showToast("Device renamed", "success");
                await loadDevices();
                await loadDevicesToSelect();
            } catch (error) {
                showToast(error.message || "Failed to rename device", "error");
            }
        }

        async function renameDevice(deviceUid, inputId) {
            const input = document.getElementById(inputId);
            if (!input) return;
            const deviceName = input.value.trim();
            await renameDeviceByValue(deviceUid, deviceName);
        }

        async function deleteDevice(deviceUid) {
            if (!deviceUid) {
                showToast("Invalid device UID", "error");
                return;
            }

            try {
                const res = await apiFetch("/devices/" + encodeURIComponent(deviceUid), {
                    method: "DELETE"
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to delete device");

                showToast("Device delete command executed", "success");
                await loadDevices();
                await loadDevicesToSelect();
            } catch (error) {
                showToast(error.message || "Failed to delete device", "error");
            }
        }

        async function loadDevicesToSelect() {
            try {
                const res = await apiFetch("/devices");
                if (!res.ok) throw new Error("Failed to load devices");
                const data = await res.json();
                const globalSelect = getGlobalDeviceSelectElement();
                const previousGlobalValue = globalSelect?.value || "";

                rememberDevices(data);
                syncCommandDashboardSubscriptions(data);
                populateDeviceSelect(globalSelect, data, previousGlobalValue);
                renderActiveEsimProfiles();
                renderScreenMirrorMultiGrid();
            } catch (error) {
                populateDeviceSelect(getGlobalDeviceSelectElement(), [], "");
                renderScreenMirrorMultiGrid();
            }
        }

        function populateDeviceSelect(select, devices, previousValue) {
            if (!select) return;
            const normalizedDevices = sortHeaderDevicesByOnlineFirst(devices);
            globalDeviceDropdownDevices = normalizedDevices;
            select.innerHTML = "";

            if (normalizedDevices.length === 0) {
                const emptyOption = document.createElement("option");
                emptyOption.value = "";
                emptyOption.textContent = "No devices found";
                select.appendChild(emptyOption);
                select.value = "";
                syncGlobalDeviceDropdown([], "");
                closeGlobalDeviceDropdown(true);
                if (select.id === "globalDeviceSelect") {
                    updateScreenMirrorFloatingTitle();
                }
                return;
            }

            normalizedDevices.forEach((device) => {
                const option = document.createElement("option");
                option.value = device.deviceUid;
                option.textContent = `${device.deviceName || device.deviceUid} (${device.deviceUid})`;
                select.appendChild(option);
            });

            const hasPrevious = normalizedDevices.some((device) => device.deviceUid === previousValue);
            if (hasPrevious) {
                select.value = previousValue;
            } else {
                select.value = String(normalizedDevices[0]?.deviceUid || "");
            }
            syncGlobalDeviceDropdown(normalizedDevices, select.value);
            if (select.id === "globalDeviceSelect") {
                updateScreenMirrorFloatingTitle();
            }
        }

        async function loadCommands() {
            try {
                const res = await apiFetch("/commands", {
                    cache: "no-store"
                });
                if (!res.ok) throw new Error("Failed to load commands");
                const data = await res.json();
                replaceCommandsCache(data);
            } catch (error) {
                commandsCache = [];
                renderCommandsFromCache();
                setRawFallback("commands", {
                    error: error.message
                }, true);
            }
        }

        async function loadContacts() {
            try {
                const res = await apiFetch("/contacts");
                if (!res.ok) throw new Error("Failed to load contacts");
                const data = await res.json();
                populateContactsDatalist(data);
            } catch (error) {
                console.error("Failed to load contacts:", error);
                clearContactsDatalist();
            }
        }

        async function loadContactsList() {
            try {
                const res = await apiFetch("/contacts");
                if (!res.ok) throw new Error("Failed to load contacts");
                const data = await res.json();
                renderContactsTable(data);
            } catch (error) {
                console.error("Failed to load contacts list:", error);
                const container = document.getElementById("contactsTable");
                if (container) {
                    container.innerHTML = `<p class="table-empty">Error: ${error.message}</p>`;
                }
            }
        }

        function renderContactsTable(contacts) {
            const container = document.getElementById("contactsTable");
            if (!container) return;

            if (!Array.isArray(contacts) || contacts.length === 0) {
                container.innerHTML = "<p class='table-empty'>No contacts saved.</p>";
                return;
            }

            const rows = contacts.map(contact => {
                const id = escapeHtml(contact._id);
                const name = escapeHtml(contact.name);
                const phoneNumber = escapeHtml(contact.phoneNumber);
                return `
                    <tr>
                        <td>${name}</td>
                        <td>${phoneNumber}</td>
                        <td class="table-action-cell">
                            <button
                                type="button"
                                class="device-delete-btn contact-delete-btn"
                                onclick="deleteContactByUI('${id}')">
                                Delete
                            </button>
                        </td>
                    </tr>
                `;
            }).join("");

            container.innerHTML = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Phone Number</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            `;
        }

        async function deleteContactByUI(contactId) {
            const confirmed = await showCustomConfirm(
                "Confirm Deletion",
                "Are you sure you want to delete this contact?"
            );
            if (!confirmed) {
                return;
            }

            try {
                const res = await apiFetch(`/contacts/${contactId}`, {
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
        }

        let contactsOverlayCloseTimerId = null;

        function openAddressBookModal() {
            const overlay = document.getElementById("contactsOverlay");
            if (!overlay) return;
            if (contactsOverlayCloseTimerId) {
                clearTimeout(contactsOverlayCloseTimerId);
                contactsOverlayCloseTimerId = null;
            }
            void loadContactsList();
            overlay.classList.remove("panel-hidden");
            requestAnimationFrame(() => {
                overlay.classList.add("is-visible");
            });
            syncOverlayScrollLock();
        }

        function closeAddressBookModal() {
            const overlay = document.getElementById("contactsOverlay");
            if (!overlay) return;
            overlay.classList.remove("is-visible");
            if (contactsOverlayCloseTimerId) {
                clearTimeout(contactsOverlayCloseTimerId);
            }
            contactsOverlayCloseTimerId = setTimeout(() => {
                overlay.classList.add("panel-hidden");
                contactsOverlayCloseTimerId = null;
                syncOverlayScrollLock();
            }, INSTRUCTIONS_OVERLAY_ANIMATION_MS);
            syncOverlayScrollLock();
        }

        function handleContactsOverlayClick(event) {
            const overlay = document.getElementById("contactsOverlay");
            if (!overlay) return;
            if (event.target === overlay) {
                closeAddressBookModal();
            }
        }

        function populateContactsDatalist(contacts) {
            const datalist = document.getElementById("contactsDatalist");
            if (!datalist) return;
            datalist.innerHTML = "";

            if (!Array.isArray(contacts)) return;

            contacts.forEach(contact => {
                const option = document.createElement("option");
                option.value = contact.phoneNumber;
                option.textContent = contact.name;
                datalist.appendChild(option);
            });
        }

        function clearContactsDatalist() {
            const datalist = document.getElementById("contactsDatalist");
            if (datalist) {
                datalist.innerHTML = "";
            }
        }

        async function saveContactFromAddressBook() {
            const nameInput = document.getElementById("newContactName");
            const phoneInput = document.getElementById("newContactPhone");
            if (!nameInput || !phoneInput) return;

            const trimmedName = typeof nameInput.value === "string" ? nameInput.value.trim() : "";
            const trimmedPhone = typeof phoneInput.value === "string" ? phoneInput.value.trim() : "";

            if (!trimmedName) {
                showToast("Please enter a contact name", "error");
                return;
            }
            if (!trimmedPhone) {
                showToast("Please enter a phone number", "error");
                return;
            }

            try {
                const res = await apiFetch("/contacts", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ name: trimmedName, phoneNumber: trimmedPhone })
                });

                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(parseApiErrorMessage(payload, "Failed to save contact"));
                }

                showToast("Contact added successfully!", "success");
                
                // Clear input fields
                nameInput.value = "";
                phoneInput.value = "";

                // Refresh global contacts datalists and local table view
                await loadContacts();
                await loadContactsList();
            } catch (error) {
                showToast(error.message || "Failed to save contact", "error");
            }
        }

        async function promptSaveContact(inputId) {
            const input = document.getElementById(inputId);
            if (!input) return;

            const phoneNumber = typeof input.value === "string" ? input.value.trim() : "";
            if (!phoneNumber) {
                showToast("Please enter a phone number first", "error");
                return;
            }

            // Open custom modal and wait for result
            const dialogResult = await openContactSaveDialog({ phoneNumber });
            if (!dialogResult || !dialogResult.confirmed) {
                return; // User cancelled
            }

            const trimmedName = typeof dialogResult.value === "string" ? dialogResult.value.trim() : "";
            if (!trimmedName) {
                showToast("Contact name cannot be empty", "error");
                return;
            }

            try {
                const res = await apiFetch("/contacts", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ name: trimmedName, phoneNumber })
                });

                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(parseApiErrorMessage(payload, "Failed to save contact"));
                }

                showToast("Contact saved successfully!", "success");
                await loadContacts();
                const contactsOverlay = document.getElementById("contactsOverlay");
                if (contactsOverlay && !contactsOverlay.classList.contains("panel-hidden")) {
                    await loadContactsList();
                }
            } catch (error) {
                showToast(error.message || "Failed to save contact", "error");
            }
        }

        function sanitizeDurationInput(event) {
            const input = event.target;
            input.value = input.value.replace(/[^\d]/g, "");
        }

        function getValidDurationSeconds(rawValue) {
            if (!rawValue) return null;
            const parsed = Number(rawValue);
            if (!Number.isInteger(parsed) || parsed <= 0) return null;
            return parsed;
        }

        function getValidDownloadSizeMb(rawValue) {
            if (typeof rawValue !== "string") return null;
            const trimmed = rawValue.trim();
            if (!trimmed) return null;
            if (!/^\d+$/.test(trimmed)) return null;

            const parsed = Number(trimmed);
            if (!Number.isInteger(parsed)) return null;
            if (parsed < 10 || parsed > 1000) return null;
            return parsed;
        }

        function isValidHttpUrl(value) {
            if (typeof value !== "string") return false;
            const trimmed = value.trim();
            if (!trimmed) return false;
            try {
                const parsed = new URL(trimmed);
                return parsed.protocol === "http:" || parsed.protocol === "https:";
            } catch (_error) {
                return false;
            }
        }

        async function sendWebViewCommand() {
            const deviceUid = requireSelectedGlobalDeviceUid();
            const notes = document.getElementById("webViewNotes").value.trim();
            const rawUrl = document.getElementById("webViewUrl").value.trim();

            if (!deviceUid) {
                return;
            }

            if (!rawUrl) {
                showToast("URL is required for OPEN_URL", "error");
                return;
            }
            if (!isValidHttpUrl(rawUrl)) {
                showToast("URL must start with http:// or https://", "error");
                return;
            }

            const payload = {
                deviceUid,
                action: "open_url",
                type: "OPEN_URL",
                url: rawUrl,
                notes: notes || null
            };

            try {
                const res = await apiFetch("/commands", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to send WebView command");

                showToast("OPEN_URL command sent", "success");
                await loadCommands();
            } catch (error) {
                showToast(error.message, "error");
            }
        }

        async function sendCloseWebViewCommand() {
            const deviceUid = requireSelectedGlobalDeviceUid();

            if (!deviceUid) {
                return;
            }

            const payload = {
                deviceUid,
                action: "close_webview",
                type: "CLOSE_WEBVIEW"
            };

            try {
                const res = await apiFetch("/commands", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to send WebView command");

                showToast("CLOSE_WEBVIEW command sent", "success");
                await loadCommands();
            } catch (error) {
                showToast(error.message, "error");
            }
        }

        /* TIMELINE COMMAND COLLECTION BUILDER JAVASCRIPT STATE ENGINE */
        let timelineSteps = [
            { id: "tl_step_0", action: "open_url", params: { url: "https://example.com" }, delayAfterSeconds: 0 }
        ];
        let loadedCollectionTemplates = []; // Local cache of templates

        function populateCollectionDeviceDropdown() {
            const select = document.getElementById("collectionDeviceUidSelect");
            if (!select) return;

            select.innerHTML = "";

            if (!globalDeviceDropdownDevices || globalDeviceDropdownDevices.length === 0) {
                const opt = document.createElement("option");
                opt.value = "";
                opt.textContent = "No devices found";
                select.appendChild(opt);
                return;
            }

            const activeDeviceUid = requireSelectedGlobalDeviceUid();

            globalDeviceDropdownDevices.forEach(dev => {
                const opt = document.createElement("option");
                opt.value = dev.deviceUid;
                opt.textContent = `${dev.deviceName || "Unnamed"} (${dev.deviceUid}) - ${dev.online ? "🟢 Online" : "🔴 Offline"}`;
                if (activeDeviceUid && String(dev.deviceUid).toLowerCase() === String(activeDeviceUid).toLowerCase()) {
                    opt.selected = true;
                }
                select.appendChild(opt);
            });
        }

        async function openCollectionModal() {
            const overlay = document.getElementById("collectionBuilderOverlay");
            if (overlay) {
                overlay.classList.remove("panel-hidden");
                
                // Populate target device dropdown dynamically from global devices array
                populateCollectionDeviceDropdown();
                
                renderTimelineSteps();
                
                // Fetch and populate collection templates datalist
                await populateTemplatesDatalist();
            }
        }

        function closeCollectionModal() {
            const overlay = document.getElementById("collectionBuilderOverlay");
            if (overlay) {
                overlay.classList.add("panel-hidden");
            }
        }

        function handleCollectionOverlayClick(event) {
            if (event.target === event.currentTarget) {
                closeCollectionModal();
            }
        }

        let activeSelectedTemplateId = null;

        async function populateTemplatesDatalist() {
            const panel = document.getElementById("customTemplatesDropdown");
            if (!panel) return;

            panel.innerHTML = "";

            try {
                const res = await apiFetch("/collection-templates", { method: "GET" });
                if (!res.ok) throw new Error("Failed to load templates.");

                loadedCollectionTemplates = await res.json();
                renderTemplatesDropdownOptions();
            } catch (err) {
                console.error("Error fetching templates:", err);
            }
        }

        function renderTemplatesDropdownOptions(filterText = "") {
            const panel = document.getElementById("customTemplatesDropdown");
            if (!panel) return;

            panel.innerHTML = "";
            const search = filterText.trim().toLowerCase();

            const filtered = loadedCollectionTemplates.filter(t => 
                t.name.trim().toLowerCase().includes(search)
            );

            if (filtered.length === 0) {
                const noResult = document.createElement("div");
                noResult.className = "custom-dropdown-option";
                noResult.style.color = "rgba(255,255,255,0.4)";
                noResult.style.fontStyle = "italic";
                noResult.style.cursor = "default";
                noResult.textContent = "No templates found";
                panel.appendChild(noResult);
                return;
            }

            filtered.forEach(tpl => {
                const opt = document.createElement("div");
                opt.className = "custom-dropdown-option";
                if (String(tpl._id) === String(activeSelectedTemplateId)) {
                    opt.classList.add("selected");
                }

                const nameSpan = document.createElement("span");
                nameSpan.textContent = tpl.name;
                opt.appendChild(nameSpan);

                if (String(tpl._id) === String(activeSelectedTemplateId)) {
                    const checkSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                    checkSvg.setAttribute("class", "custom-dropdown-option-check");
                    checkSvg.setAttribute("viewBox", "0 0 24 24");
                    checkSvg.setAttribute("fill", "none");
                    checkSvg.setAttribute("stroke", "currentColor");
                    checkSvg.setAttribute("stroke-width", "3");
                    checkSvg.setAttribute("stroke-linecap", "round");
                    checkSvg.setAttribute("stroke-linejoin", "round");
                    
                    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
                    poly.setAttribute("points", "20 6 9 17 4 12");
                    checkSvg.appendChild(poly);
                    opt.appendChild(checkSvg);
                }

                opt.onmousedown = (e) => {
                    e.preventDefault(); 
                    selectTemplateFromDropdown(tpl);
                };

                panel.appendChild(opt);
            });
        }

        function handleCollectionNameInputChange(val) {
            renderTemplatesDropdownOptions(val);
            
            // Check for exact match (case-insensitive) to load
            const matchedTemplate = loadedCollectionTemplates.find(
                t => t.name.trim().toLowerCase() === val.trim().toLowerCase()
            );
            if (matchedTemplate) {
                activeSelectedTemplateId = matchedTemplate._id;
                loadSelectedCollectionTemplate(matchedTemplate._id);
            } else {
                activeSelectedTemplateId = null;
            }
        }

        function selectTemplateFromDropdown(tpl) {
            const input = document.getElementById("collectionNameInput");
            if (input) {
                input.value = tpl.name;
            }
            activeSelectedTemplateId = tpl._id;
            loadSelectedCollectionTemplate(tpl._id);
            toggleTemplatesDropdown(false);
        }

        function toggleTemplatesDropdown(show) {
            const container = document.getElementById("templatesDropdownContainer");
            if (!container) return;

            if (show) {
                container.classList.add("is-open");
                const input = document.getElementById("collectionNameInput");
                renderTemplatesDropdownOptions(input ? input.value : "");
            } else {
                container.classList.remove("is-open");
            }
        }

        // Setup close on click outside for custom dropdown
        document.addEventListener("click", (e) => {
            const container = document.getElementById("templatesDropdownContainer");
            if (container && !container.contains(e.target)) {
                toggleTemplatesDropdown(false);
            }
        });

        // Global Resolver for Custom Confirm Modal
        let customConfirmResolver = null;

        function showCustomConfirm(title, message, confirmLabel = "Delete", cancelLabel = "Cancel") {
            return new Promise((resolve) => {
                const overlay = document.getElementById("customConfirmOverlay");
                const titleEl = document.getElementById("customConfirmTitle");
                const messageEl = document.getElementById("customConfirmMessage");
                const approveBtn = document.getElementById("customConfirmApproveBtn");
                const cancelBtn = document.getElementById("customConfirmCancelBtn");

                if (!overlay || !titleEl || !messageEl || !approveBtn || !cancelBtn) {
                    resolve(false);
                    return;
                }

                titleEl.textContent = title;
                messageEl.textContent = message;
                approveBtn.textContent = confirmLabel;
                cancelBtn.textContent = cancelLabel;

                customConfirmResolver = resolve;

                overlay.classList.remove("panel-hidden");
                requestAnimationFrame(() => {
                    overlay.classList.add("is-visible");
                    approveBtn.focus();
                });
                
                syncOverlayScrollLock();
            });
        }

        function resolveCustomConfirm(value) {
            const overlay = document.getElementById("customConfirmOverlay");
            if (!overlay) return;

            overlay.classList.remove("is-visible");
            setTimeout(() => {
                overlay.classList.add("panel-hidden");
                syncOverlayScrollLock();
            }, 240);

            if (customConfirmResolver) {
                customConfirmResolver(value);
                customConfirmResolver = null;
            }
        }

        function handleCustomConfirmOverlayClick(event) {
            const overlay = document.getElementById("customConfirmOverlay");
            if (!overlay) return;
            if (event.target === overlay) {
                resolveCustomConfirm(false);
            }
        }

        function loadSelectedCollectionTemplate(templateId) {
            if (!templateId) return;

            const template = loadedCollectionTemplates.find(t => String(t._id) === String(templateId));
            if (!template) {
                showToast("Collection not found in cache.", "error");
                return;
            }

            // Fill template name
            const nameInput = document.getElementById("collectionNameInput");
            if (nameInput) {
                nameInput.value = template.name;
            }

            // Map templates to steps, restricting to ONLY the 8 allowed actions
            const allowedActions = new Set([
                "call", "sms", "auto_answer", "open_url", "close_webview", "open_app", "return_to_autocall", "download_data"
            ]);

            const filteredTemplates = template.commandTemplates.filter(t => allowedActions.has(t.action));

            timelineSteps = filteredTemplates.map((tmpl) => {
                const action = tmpl.action;
                const params = {};
                
                if (action === "open_url") {
                    params.url = tmpl.url || "";
                } else if (action === "download_data") {
                    params.downloadSizeMb = tmpl.downloadSizeMb || 150;
                } else if (action === "call") {
                    params.phoneNumber = tmpl.phoneNumber || "";
                    params.durationSeconds = tmpl.durationSeconds || 30;
                    if (Number.isInteger(Number(tmpl.subscriptionId)) && Number(tmpl.subscriptionId) >= 0) {
                        params.subscriptionId = Number(tmpl.subscriptionId);
                    }
                } else if (action === "sms") {
                    params.phoneNumber = tmpl.phoneNumber || "";
                    params.message = tmpl.message || "";
                    if (Number.isInteger(Number(tmpl.subscriptionId)) && Number(tmpl.subscriptionId) >= 0) {
                        params.subscriptionId = Number(tmpl.subscriptionId);
                    }
                } else if (action === "auto_answer") {
                    params.enabled = tmpl.enabled !== false;
                    params.autoHangupSeconds = tmpl.autoHangupSeconds || 15;
                } else if (action === "open_app") {
                    params.appName = tmpl.appName || "";
                }

                return {
                    id: "tl_step_" + Math.random().toString(36).substring(2, 9),
                    action,
                    params,
                    delayAfterSeconds: getTimelineDelayForPayload(tmpl)
                };
            });

            renderTimelineSteps();
            showToast(`Loaded blueprint: '${template.name}' successfully!`, "success");
        }

        async function saveAsCollectionTemplate() {
            const name = document.getElementById("collectionNameInput").value.trim();
            if (!name) {
                showToast("Please enter a name for the template.", "error");
                return;
            }

            if (timelineSteps.length === 0) {
                showToast("A Collection requires at least one command step.", "error");
                return;
            }

            const selectedDeviceUidForTemplate = getSelectedGlobalDeviceUid();
            const templatesPayload = timelineSteps.map(step => {
                const templatePayload = {
                    action: step.action,
                    type: step.action.toUpperCase(),
                    delayAfterSeconds: getTimelineDelayForPayload(step),
                    ...step.params
                };
                const selectedSubscriptionId = getSelectedCommandSubscriptionIdForDevice(selectedDeviceUidForTemplate);
                if (
                    (step.action === "call" || step.action === "sms") &&
                    Number.isInteger(selectedSubscriptionId) &&
                    selectedSubscriptionId >= 0 &&
                    templatePayload.subscriptionId === undefined
                ) {
                    templatePayload.subscriptionId = selectedSubscriptionId;
                }
                return templatePayload;
            });

            const payload = {
                name,
                commandTemplates: templatesPayload
            };

            try {
                const res = await apiFetch("/collection-templates", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || "Failed to save template.");
                }

                showToast(`💾 Collection  '${name}' saved successfully!`, "success");
                
                // Refresh templates list
                await populateTemplatesDatalist();
            } catch (err) {
                showToast(err.message, "error");
            }
        }

        async function deleteCollectionTemplate() {
            const nameInput = document.getElementById("collectionNameInput");
            if (!nameInput) return;

            const val = nameInput.value.trim();
            if (!val) {
                showToast("Please type or select a Collection name to delete.", "error");
                return;
            }

            const template = loadedCollectionTemplates.find(
                t => t.name.trim().toLowerCase() === val.toLowerCase()
            );

            if (!template) {
                showToast(`No stored Collection named '${val}' was found.`, "error");
                return;
            }

            const confirmed = await showCustomConfirm(
                "Confirm Deletion",
                `Are you sure you want to delete the Collection '${template.name}'?`
            );
            if (!confirmed) {
                return;
            }

            try {
                const res = await apiFetch(`/collection-templates/${template._id}`, {
                    method: "DELETE"
                });

                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || "Failed to delete template.");
                }

                showToast(`🗑️ Collection '${template.name}' deleted successfully!`, "success");
                
                // Clear the input
                nameInput.value = "";
                activeSelectedTemplateId = null;

                // Reset timeline
                timelineSteps = [];
                renderTimelineSteps();

                // Refresh templates list
                await populateTemplatesDatalist();
            } catch (err) {
                showToast(err.message, "error");
            }
        }

        function addNewTimelineStep() {
            const id = "tl_step_" + Math.random().toString(36).substring(2, 9);
            timelineSteps.push({ id, action: "open_url", params: { url: "" }, delayAfterSeconds: 0 });
            renderTimelineSteps();
        }

        function removeTimelineStep(id) {
            timelineSteps = timelineSteps.filter(s => s.id !== id);
            renderTimelineSteps();
        }

        function moveTimelineStep(id, direction) {
            const idx = timelineSteps.findIndex(s => s.id === id);
            if (idx === -1) return;
            const targetIdx = idx + direction;
            if (targetIdx < 0 || targetIdx >= timelineSteps.length) return;

            const temp = timelineSteps[idx];
            timelineSteps[idx] = timelineSteps[targetIdx];
            timelineSteps[targetIdx] = temp;
            renderTimelineSteps();
        }

        function handleTimelineActionChange(id, action) {
            const step = timelineSteps.find(s => s.id === id);
            if (!step) return;
            step.action = action;
            
            // Set default parameters for only the 8 allowed actions
            if (action === "open_url") {
                step.params = { url: "" };
            } else if (action === "download_data") {
                step.params = { downloadSizeMb: 150 };
            } else if (action === "call") {
                step.params = { phoneNumber: "", durationSeconds: 30 };
            } else if (action === "sms") {
                step.params = { phoneNumber: "", message: "" };
            } else if (action === "auto_answer") {
                step.params = { enabled: true, autoHangupSeconds: 15 };
            } else if (action === "open_app") {
                step.params = { appName: "" };
            } else {
                // close_webview, return_to_autocall
                step.params = {};
            }
            renderTimelineSteps();
        }

        function updateTimelineParamValue(id, key, val) {
            const step = timelineSteps.find(s => s.id === id);
            if (!step) return;
            step.params[key] = val;
        }

        function updateTimelineDelayAfterSeconds(id, value) {
            const step = timelineSteps.find(s => s.id === id);
            if (!step) return;
            step.delayAfterSeconds = value === "" ? 0 : Number(value);
        }

        function getTimelineDelayForPayload(step) {
            const rawValue = step?.delayAfterSeconds;
            if (rawValue === undefined || rawValue === null || rawValue === "") {
                return 0;
            }
            const value = Number(rawValue);
            return Number.isFinite(value) ? value : 0;
        }

        function renderTimelineSteps() {
            const container = document.getElementById("timelineSteps");
            if (!container) return;

            container.innerHTML = "";
            if (timelineSteps.length === 0) {
                container.innerHTML = `<p style="text-align: center; color: var(--muted); padding: 12px 0;">No command steps configured. Add at least one step.</p>`;
                return;
            }

            // Exclude SCREEN_TOUCH, SCREEN_SWIPE, END, etc. ONLY include these 8 allowed actions:
            const actionsList = [
                { value: "call", label: "Call" },
                { value: "sms", label: "Send SMS Message" },
                { value: "auto_answer", label: "Auto Answer Status" },
                { value: "download_data", label: "Download Data" },
                { value: "open_app", label: "Open App" },
                { value: "return_to_autocall", label: "Return to AutoCall" },
                { value: "open_url", label: "Open Web View" },
                { value: "close_webview", label: "Close Web View" }
            ];

            timelineSteps.forEach((step, index) => {
                const item = document.createElement("div");
                item.className = "timeline-step-item";

                // Step Badge
                const badge = document.createElement("div");
                badge.className = "timeline-step-badge";
                badge.textContent = index + 1;
                item.appendChild(badge);

                // Card
                const card = document.createElement("div");
                card.className = "timeline-step-card";

                // Card Header Row
                const cardHeader = document.createElement("div");
                cardHeader.className = "card-header-row";

                const select = document.createElement("select");
                select.style.padding = "6px 12px";
                select.style.borderRadius = "8px";
                select.style.border = "1px solid rgba(255,255,255,0.15)";
                select.style.background = "#0b1220";
                select.style.color = "#f8fafc";
                select.style.fontSize = "0.85rem";
                select.style.fontWeight = "600";
                select.style.outline = "none";
                
                actionsList.forEach(opt => {
                    const o = document.createElement("option");
                    o.value = opt.value;
                    o.textContent = opt.label;
                    o.selected = opt.value === step.action;
                    select.appendChild(o);
                });
                select.onchange = (e) => handleTimelineActionChange(step.id, e.target.value);
                cardHeader.appendChild(select);

                // Reorder / Delete Controls
                const controls = document.createElement("div");
                controls.className = "card-controls";

                if (index > 0) {
                    const btnUp = document.createElement("button");
                    btnUp.type = "button";
                    btnUp.className = "timeline-btn-icon";
                    btnUp.textContent = "▲";
                    btnUp.title = "Move Step Up";
                    btnUp.onclick = () => moveTimelineStep(step.id, -1);
                    controls.appendChild(btnUp);
                }

                if (index < timelineSteps.length - 1) {
                    const btnDown = document.createElement("button");
                    btnDown.type = "button";
                    btnDown.className = "timeline-btn-icon";
                    btnDown.textContent = "▼";
                    btnDown.title = "Move Step Down";
                    btnDown.onclick = () => moveTimelineStep(step.id, 1);
                    controls.appendChild(btnDown);
                }

                const btnDel = document.createElement("button");
                btnDel.type = "button";
                btnDel.className = "timeline-btn-icon delete";
                btnDel.textContent = "✖";
                btnDel.title = "Delete Step";
                btnDel.onclick = () => removeTimelineStep(step.id);
                controls.appendChild(btnDel);

                cardHeader.appendChild(controls);
                card.appendChild(cardHeader);

                // Fields Grid
                const grid = document.createElement("div");
                grid.className = "collection-fields-grid";

                // Conditional Param inputs ONLY for allowed actions
                if (step.action === "open_url") {
                    grid.appendChild(createTimelineInputField(step.id, "url", "URL Address", "text", step.params.url || "", "https://example.com"));
                } else if (step.action === "download_data") {
                    grid.appendChild(createTimelineInputField(step.id, "downloadSizeMb", "Size (MB)", "number", step.params.downloadSizeMb || 100, "e.g. 150"));
                } else if (step.action === "call") {
                    grid.appendChild(createTimelineInputField(step.id, "phoneNumber", "Phone Number", "text", step.params.phoneNumber || "", "+966500000000"));
                    grid.appendChild(createTimelineInputField(step.id, "durationSeconds", "Duration (Sec)", "number", step.params.durationSeconds || 30, "e.g. 45"));
                } else if (step.action === "sms") {
                    grid.appendChild(createTimelineInputField(step.id, "phoneNumber", "Recipient Number", "text", step.params.phoneNumber || "", "+966500000000"));
                    grid.appendChild(createTimelineInputField(step.id, "message", "SMS Message", "text", step.params.message || "", "Enter message..."));
                } else if (step.action === "open_app") {
                    grid.appendChild(createTimelineInputField(step.id, "appName", "App Name or Package", "text", step.params.appName || "", "e.g. whatsapp or com.whatsapp"));
                } else if (step.action === "auto_answer") {
                    const fGroup = document.createElement("div");
                    fGroup.className = "field-group";
                    fGroup.style.display = "flex";
                    fGroup.style.flexDirection = "column";
                    fGroup.style.gap = "6px";
                    fGroup.innerHTML = `<label class="field-label" style="font-size: 11px;">Enable Auto-Answer</label>`;
                    
                    const sl = document.createElement("select");
                    sl.style.padding = "8px 12px";
                    sl.style.borderRadius = "8px";
                    sl.style.border = "1px solid rgba(255,255,255,0.15)";
                    sl.style.background = "#0b1220";
                    sl.style.color = "#f8fafc";
                    sl.style.outline = "none";
                    sl.innerHTML = `
                        <option value="true" ${step.params.enabled === true ? 'selected' : ''}>Active</option>
                        <option value="false" ${step.params.enabled === false ? 'selected' : ''}>Disabled</option>
                    `;
                    sl.onchange = (e) => updateTimelineParamValue(step.id, "enabled", e.target.value === "true");
                    fGroup.appendChild(sl);
                    grid.appendChild(fGroup);

                    grid.appendChild(createTimelineInputField(step.id, "autoHangupSeconds", "Auto Hangup (Sec)", "number", step.params.autoHangupSeconds || 15, "e.g. 20"));
                }

                grid.appendChild(createTimelineDelayField(step));
                card.appendChild(grid);
                item.appendChild(card);
                container.appendChild(item);
            });
        }

        function createTimelineDelayField(step) {
            const group = document.createElement("div");
            group.className = "field-group";
            group.style.display = "flex";
            group.style.flexDirection = "column";
            group.style.gap = "6px";

            const label = document.createElement("label");
            label.className = "field-label";
            label.style.fontSize = "11px";
            label.textContent = "Delay after this command (seconds)";
            group.appendChild(label);

            const input = document.createElement("input");
            input.type = "number";
            input.min = "0";
            input.max = "3600";
            input.step = "1";
            input.value = String(getTimelineDelayForPayload(step));
            input.placeholder = "0";
            input.style.padding = "8px 12px";
            input.style.borderRadius = "8px";
            input.style.border = "1px solid rgba(255,255,255,0.15)";
            input.style.background = "#0b1220";
            input.style.color = "#f8fafc";
            input.style.outline = "none";
            input.style.width = "60px";

            input.oninput = (event) => {
                updateTimelineDelayAfterSeconds(step.id, event.target.value);
            };

            group.appendChild(input);
            return group;
        }

        function createTimelineInputField(id, field, labelText, type, value, placeholder) {
            const group = document.createElement("div");
            group.className = "field-group";
            group.style.display = "flex";
            group.style.flexDirection = "column";
            group.style.gap = "6px";

            const label = document.createElement("label");
            label.className = "field-label";
            label.style.fontSize = "11px";
            label.textContent = labelText;
            group.appendChild(label);

            const input = document.createElement("input");
            input.type = type;
            input.value = value;
            input.placeholder = placeholder;
            input.style.padding = "8px 12px";
            input.style.borderRadius = "8px";
            input.style.border = "1px solid rgba(255,255,255,0.15)";
            input.style.background = "#0b1220";
            input.style.color = "#f8fafc";
            input.style.outline = "none";
            
            input.oninput = (e) => {
                const val = type === "number" ? Number(e.target.value) : e.target.value;
                updateTimelineParamValue(id, field, val);
            };

            group.appendChild(input);
            return group;
        }

        async function executeCollection() {
            const nameInput = document.getElementById("collectionNameInput").value.trim();
            const name = nameInput || "Instant Run";
            const deviceUidSelect = document.getElementById("collectionDeviceUidSelect");
            const deviceUid = deviceUidSelect ? deviceUidSelect.value.trim().toLowerCase() : "";
            if (!deviceUid || deviceUid.length !== 5) {
                showToast("Target Device UID must be exactly 5 characters.", "error");
                return;
            }
            if (timelineSteps.length === 0) {
                showToast("A collection requires at least one command step.", "error");
                return;
            }

            const templatesPayload = timelineSteps.map(step => {
                const templatePayload = {
                    action: step.action,
                    type: step.action.toUpperCase(),
                    delayAfterSeconds: getTimelineDelayForPayload(step),
                    ...step.params
                };
                const selectedSubscriptionId = getSelectedCommandSubscriptionIdForDevice(deviceUid);
                if (
                    (step.action === "call" || step.action === "sms") &&
                    Number.isInteger(selectedSubscriptionId) &&
                    selectedSubscriptionId >= 0 &&
                    templatePayload.subscriptionId === undefined
                ) {
                    templatePayload.subscriptionId = selectedSubscriptionId;
                }
                return templatePayload;
            });

            const payload = {
                name,
                deviceUid,
                commandTemplates: templatesPayload
            };

            const submitBtn = document.getElementById("btnExecuteCollectionSequence");
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = "🚀 Executing...";

            try {
                const res = await apiFetch("/collections", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to execute sequence.");

                showToast(`Collection '${data.collection.name}' started successfully!`, "success");
                
                closeCollectionModal();
                
                // Clear state
                document.getElementById("collectionNameInput").value = "";
                timelineSteps = [{ id: "tl_step_0", action: "open_url", params: { url: "" }, delayAfterSeconds: 0 }];
                
                if (typeof loadCommands === "function") {
                    await loadCommands();
                }
            } catch (err) {
                showToast(err.message, "error");
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        }

        async function sendOpenApp() {
            const deviceUid = requireSelectedGlobalDeviceUid();
            const appName = document.getElementById("openAppName").value.trim();
            const notes = document.getElementById("openAppNotes").value.trim();

            if (!deviceUid) {
                return;
            }
            if (!appName) {
                showToast("App Name is required", "error");
                return;
            }

            const payload = {
                deviceUid,
                action: "open_app",
                type: "OPEN_APP",
                appName,
                notes: notes || null
            };

            try {
                const res = await apiFetch("/commands", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to send OPEN_APP command");

                showToast("OPEN_APP command sent", "success");
                await loadCommands();
            } catch (error) {
                showToast(error.message, "error");
            }
        }

        async function sendReturnToAutoCall() {
            const deviceUid = requireSelectedGlobalDeviceUid();

            if (!deviceUid) {
                return;
            }

            const payload = {
                deviceUid,
                action: "return_to_autocall",
                type: "RETURN_TO_AUTOCALL"
            };

            try {
                const res = await apiFetch("/commands", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to send RETURN_TO_AUTOCALL command");

                showToast("RETURN_TO_AUTOCALL command sent", "success");
                await loadCommands();
            } catch (error) {
                showToast(error.message, "error");
            }
        }

        async function sendDownloadDataCommand() {
            const deviceUid = requireSelectedGlobalDeviceUid();
            const rawDownloadSize = String(document.getElementById("downloadSizeMbInput").value || "");
            const downloadSizeMb = getValidDownloadSizeMb(rawDownloadSize);
            const scheduledAt = String(document.getElementById("downloadDataScheduleTime")?.value || "");

            if (!deviceUid) {
                return;
            }

            if (downloadSizeMb === null) {
                showToast("Download Size MB must be a number between 10 and 1000", "error");
                return;
            }

            const payload = {
                deviceUid,
                action: "download_data",
                type: "DOWNLOAD_DATA",
                downloadSizeMb,
                scheduledAt: scheduledAt || null
            };

            try {
                const res = await apiFetch("/commands", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to send DOWNLOAD_DATA command");

                showToast("DOWNLOAD_DATA command sent", "success");
                await loadCommands();
            } catch (error) {
                showToast(error.message || "Failed to send DOWNLOAD_DATA command", "error");
            }
        }

        async function sendActivateEsimCommand() {
            const deviceUid = requireSelectedGlobalDeviceUid();
            const activationCode = String(document.getElementById("esimActivationCode")?.value || "").trim();
            const notes = String(document.getElementById("esimNotes")?.value || "").trim();

            if (!deviceUid) {
                return;
            }

            if (!activationCode) {
                showToast("Activation code is required", "error");
                return;
            }

            const payload = {
                deviceUid,
                action: "activate_esim",
                type: "ACTIVATE_ESIM",
                activationCode,
                notes: notes || null
            };

            try {
                const res = await apiFetch("/commands", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to send ACTIVATE_ESIM command");

                showToast("ACTIVATE_ESIM command sent", "success");
                await loadCommands();
            } catch (error) {
                showToast(error.message || "Failed to send ACTIVATE_ESIM command", "error");
            }
        }

        async function sendDeleteEsimCommand(subscriptionId, portIndex) {
            const deviceUid = requireSelectedGlobalDeviceUid();
            const normalizedSubscriptionId = Number(subscriptionId);
            const normalizedPortIndex = portIndex === null || portIndex === undefined || portIndex === ""
                ? null
                : Number(portIndex);

            if (!deviceUid) {
                return;
            }
            if (!Number.isInteger(normalizedSubscriptionId) || normalizedSubscriptionId < 0) {
                showToast("Invalid eSIM subscription", "error");
                return;
            }
            if (
                normalizedPortIndex !== null &&
                (!Number.isInteger(normalizedPortIndex) || normalizedPortIndex < 0)
            ) {
                showToast("Invalid eSIM port", "error");
                return;
            }

            const confirmed = await openCommandConfirmDialog({
                title: "Delete eSIM",
                message: `Permanently delete eSIM subscription ${normalizedSubscriptionId} from device ${deviceUid}?`,
                confirmLabel: "Delete eSIM"
            });
            if (!confirmed) {
                return;
            }

            const payload = {
                deviceUid,
                action: "delete_esim",
                type: "DELETE_ESIM",
                esimSubscriptionId: normalizedSubscriptionId,
                notes: `Delete eSIM subscription ${normalizedSubscriptionId}`
            };
            if (normalizedPortIndex !== null) {
                payload.esimPortIndex = normalizedPortIndex;
            }

            try {
                const res = await apiFetch("/commands", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to send DELETE_ESIM command");

                showToast("DELETE_ESIM command sent", "success");
                await loadCommands();
            } catch (error) {
                showToast(error.message || "Failed to send DELETE_ESIM command", "error");
            }
        }

        async function sendCall() {
            const deviceUid = requireSelectedGlobalDeviceUid();
            const phoneNumber = String(document.getElementById("phone").value || "").trim();
            const scheduledAt = document.getElementById("scheduleTime").value;
            const durationRaw = document.getElementById("durationSeconds").value.trim();
            const durationSeconds = getValidDurationSeconds(durationRaw);
            const notes = document.getElementById("callNotes").value.trim();

            if (!deviceUid) {
                return;
            }

            const payload = {
                deviceUid,
                action: "call",
                phoneNumber,
                scheduledAt: scheduledAt || null,
                notes: notes || null
            };

            const subscriptionId = getSelectedCommandSubscriptionIdForDevice(deviceUid);
            if (subscriptionId !== null) {
                payload.subscriptionId = subscriptionId;
            }

            if (durationSeconds !== null) {
                payload.durationSeconds = durationSeconds;
            }

            console.log("Sending call command:", {
                phoneNumber,
                durationSeconds,
                deviceUid
            });

            try {
                const res = await apiFetch("/commands", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to send command");

                showToast("Command sent", "success");
                await loadCommands();
            } catch (error) {
                showToast(error.message, "error");
            }
        }

        async function sendEndCall() {
            const deviceUid = requireSelectedGlobalDeviceUid();
            if (!deviceUid) {
                return;
            }
            const payload = {
                deviceUid,
                action: "end"
            };

            try {
                const res = await apiFetch("/commands", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to send end command");

                showToast("End command sent", "success");
                await loadCommands();
            } catch (error) {
                showToast(error.message, "error");
            }
        }

        async function sendSms() {
            const deviceUid = requireSelectedGlobalDeviceUid();
            const phoneNumber = document.getElementById("smsPhone").value;
            const message = document.getElementById("smsMessage").value;
            const scheduledAt = document.getElementById("smsScheduleTime").value;
            const notes = document.getElementById("smsNotes").value.trim();

            if (!deviceUid) {
                return;
            }

            const payload = {
                deviceUid,
                type: "SMS",
                phoneNumber,
                message,
                scheduledAt: scheduledAt || null,
                notes: notes || null
            };

            const subscriptionId = getSelectedCommandSubscriptionIdForDevice(deviceUid);
            if (subscriptionId !== null) {
                payload.subscriptionId = subscriptionId;
            }

            try {
                const res = await apiFetch("/commands", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to send SMS command");

                showToast("SMS command sent", "success");
                await loadCommands();
            } catch (error) {
                showToast(error.message, "error");
            }
        }

        async function sendAutoAnswer() {
            const deviceUid = requireSelectedGlobalDeviceUid();
            const enabled = document.getElementById("autoAnswerEnabled").checked;
            const rawHangupSeconds = document.getElementById("autoAnswerHangupSeconds").value.trim();
            const parsedHangupSeconds = getValidDurationSeconds(rawHangupSeconds);
            const notes = document.getElementById("autoAnswerNotes").value.trim();

            if (!deviceUid) {
                return;
            }

            const payload = {
                deviceUid,
                type: "AUTO_ANSWER",
                enabled,
                notes: notes || null
            };

            if (enabled) {
                if (parsedHangupSeconds === null) {
                    showToast("Please enter a valid auto hangup seconds value", "error");
                    return;
                }
                payload.autoHangupSeconds = parsedHangupSeconds;
            }

            try {
                const res = await apiFetch("/commands", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to apply auto answer");

                showToast("Auto Answer command sent", "success");
                await loadCommands();
            } catch (error) {
                showToast(error.message, "error");
            }
        }

        async function clearCommands() {
            try {
                const res = await apiFetch("/commands", {
                    method: "DELETE"
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(parseApiErrorMessage(data, "Failed to clear commands"));
                }

                commandsCache = [];
                renderCommandsFromCache();
                showToast("Commands cleared", "success");
            } catch (error) {
                showToast(error.message || "Failed to clear commands", "error");
            }
        }

        // ==========================================
        // Autonomous AI Agent Chat Handlers
        // ==========================================
        let aiChatHistory = [];

        async function sendAgentChat(event) {
            event.preventDefault();
            const input = document.getElementById("aiChatInput");
            const message = input.value.trim();
            if (!message) return;

            // Render user message in chat
            appendChatBubble("user", message);
            input.value = "";

            // Show typing indicator
            const indicator = document.getElementById("aiChatTypingIndicator");
            indicator.classList.remove("panel-hidden");

            // Disable submit button during flight
            const submitBtn = document.getElementById("aiChatSubmitBtn");
            submitBtn.disabled = true;

            try {
                const res = await apiFetch("/agent/chat", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ 
                        message, 
                        history: aiChatHistory,
                        deviceUid: getSelectedGlobalDeviceUid() || null
                    })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed to process agent request");

                // Hide typing indicator
                indicator.classList.add("panel-hidden");
                submitBtn.disabled = false;

                // Render agent response
                appendChatBubble("ai", data.response);

                // Update chat history
                aiChatHistory.push({ role: "user", content: message });
                aiChatHistory.push({ role: "assistant", content: data.response });

                // Limit local history to last 20 messages for performance and context limits
                if (aiChatHistory.length > 20) {
                    aiChatHistory = aiChatHistory.slice(-20);
                }

                // Execute templates based on response status
                if (data.status === "auto_executed") {
                    appendChatSuccessIndicator();
                    if (typeof loadCommands === "function") {
                        await loadCommands();
                    }
                } else if (data.status === "pending_approval" && data.draftCommand) {
                    appendDraftCommandCard(data.draftCommand);
                }
            } catch (error) {
                indicator.classList.add("panel-hidden");
                submitBtn.disabled = false;
                appendChatBubble("system-message", "Error: " + error.message);
                showToast(error.message, "error");
            }
        }

        function appendChatBubble(role, text) {
            const chatLog = document.getElementById("aiChatLog");
            if (!chatLog) return;

            const bubble = document.createElement("div");
            bubble.className = "ai-bubble " + role;
            bubble.innerText = text;

            chatLog.appendChild(bubble);
            chatLog.scrollTop = chatLog.scrollHeight;
        }

        function appendChatSuccessIndicator() {
            const chatLog = document.getElementById("aiChatLog");
            if (!chatLog) return;

            const div = document.createElement("div");
            div.className = "success-indicator";
            div.innerHTML = "<span>&#10004;</span> Command auto-created and pushed successfully!";
            chatLog.appendChild(div);
            chatLog.scrollTop = chatLog.scrollHeight;
        }

        function appendDraftCommandCard(draftCommand) {
            const chatLog = document.getElementById("aiChatLog");
            if (!chatLog) return;

            const cardId = "draft_" + Date.now();
            const card = document.createElement("div");
            card.id = cardId;
            card.className = "ai-draft-card";

            let detailsHtml = `
                <h4>Proposed Draft Command</h4>
                <p><strong>Device:</strong> ${draftCommand.deviceUid}</p>
                <p><strong>Action:</strong> ${draftCommand.action.toUpperCase()}</p>
            `;

            if (draftCommand.phoneNumber) {
                detailsHtml += `<p><strong>Destination Number:</strong> ${draftCommand.phoneNumber}</p>`;
            }
            if (draftCommand.message) {
                detailsHtml += `<p><strong>Message Text:</strong> "${draftCommand.message}"</p>`;
            }
            if (draftCommand.url) {
                detailsHtml += `<p><strong>Target URL:</strong> <a href="${draftCommand.url}" target="_blank">${draftCommand.url}</a></p>`;
            }
            if (draftCommand.appName) {
                detailsHtml += `<p><strong>Target App:</strong> ${draftCommand.appName}</p>`;
            }
            if (draftCommand.scheduledAt) {
                const displayDate = new Date(draftCommand.scheduledAt).toLocaleString("en-GB", { hour12: false });
                detailsHtml += `<p><strong>Scheduled At (Riyadh):</strong> ${displayDate}</p>`;
            }

            // Standardize stringified JSON to bind inside onclick event safely
            const escapedCommandJson = JSON.stringify(draftCommand).replace(/'/g, "\\'").replace(/"/g, "&quot;");

            detailsHtml += `
                <div class="actions">
                    <button class="btn-approve" onclick="approveDraftCommand('${cardId}', ${escapedCommandJson})">Approve Action</button>
                    <button class="btn-cancel" onclick="cancelDraftCommand('${cardId}')">Cancel</button>
                </div>
            `;

            card.innerHTML = detailsHtml;
            chatLog.appendChild(card);
            chatLog.scrollTop = chatLog.scrollHeight;
        }

        async function approveDraftCommand(cardId, draftCommand) {
            const card = document.getElementById(cardId);
            if (!card) return;

            const buttons = card.querySelectorAll("button");
            buttons.forEach(btn => btn.disabled = true);

            try {
                const res = await apiFetch("/agent/chat/confirm", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ draftCommand })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Execution failed");

                card.innerHTML = `
                    <h4 style="color: #22c55e; margin: 0 0 4px 0;">Proposed Draft Command - Approved</h4>
                    <p style="margin: 0; color: #84cc16; font-size: 13px;">&#10004; Approved! Command is now pending execution on device ${draftCommand.deviceUid}.</p>
                `;

                showToast("Action approved and queued", "success");
                if (typeof loadCommands === "function") {
                    await loadCommands();
                }
            } catch (error) {
                buttons.forEach(btn => btn.disabled = false);
                showToast(error.message, "error");
            }
        }

        function cancelDraftCommand(cardId) {
            const card = document.getElementById(cardId);
            if (!card) return;

            card.innerHTML = `
                <h4 style="color: #94a3b8; margin: 0 0 4px 0;">Proposed Draft Command - Declined</h4>
                <p style="margin: 0; color: #94a3b8; font-size: 13px;">Declined by the user.</p>
            `;
            showToast("Draft command discarded", "info");
        }

        function toggleAiChat() {
            const popup = document.getElementById("aiChatPopup");
            if (!popup) return;

            popup.classList.toggle("active");

            // Focus input when opened
            if (popup.classList.contains("active")) {
                const input = document.getElementById("aiChatInput");
                if (input) input.focus();

                // Scroll chat log to bottom
                const chatLog = document.getElementById("aiChatLog");
                if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
            }
        }

        // Click outside of the chat container to automatically dismiss/close the popup
        document.addEventListener("click", function(event) {
            const popup = document.getElementById("aiChatPopup");
            const fab = document.getElementById("aiChatFab");
            if (!popup || !fab) return;

            // Only run dismissal if the popup is currently visible/active
            if (popup.classList.contains("active")) {
                const clickedInsidePopup = popup.contains(event.target);
                const clickedInsideFab = fab.contains(event.target);

                // If click is outside both elements, hide popup
                if (!clickedInsidePopup && !clickedInsideFab) {
                    popup.classList.remove("active");
                }
            }
        });

        initializeGlobalDeviceSelector();
        initializeDeviceActionDialog();
        initializeCommandConfirmDialog();
        initializeContactSaveDialog();
        initializeScreenMirrorFloatingUI();
        initializeScreenMirrorPinnedPanel();
        initializeScreenMirrorTouchControl();
        resetScreenMirrorView();
        renderScreenMirrorMultiGrid();
        updatePanelToggleUI("commands");
        renderInstructionsPage();
        initializeSession();
