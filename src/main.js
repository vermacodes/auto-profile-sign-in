// Auto Profile Sign-In — background service worker
// https://github.com/vermacodes/AutoProfileSignIn
//
// Reads the current browser-profile email and registers declarativeNetRequest
// rules that bypass the Microsoft account picker by attaching login_hint /
// whr query parameters to outbound login.microsoftonline.com requests.

'use strict';

// ---------- Configuration ----------

const VERBOSE_LOGGING = false;
const STORAGE_KEY_ENABLED = 'autoProfileEnabled';
const RULE_ID_AAD_AUTHORIZE = 101;
const RULE_ID_FEDERATED = 102;
const RULE_ID_COMMON_CHOOSER = 103;
const ALL_RULE_IDS = [
    RULE_ID_AAD_AUTHORIZE,
    RULE_ID_FEDERATED,
    RULE_ID_COMMON_CHOOSER,
];

// ---------- Module state ----------

let cachedProfileEmail = '';
let isAutoSignInEnabled = true;

// ---------- Logging helpers ----------

function logDebug(message, ...rest) {
    if (VERBOSE_LOGGING) {
        console.log(`[AutoProfileSignIn] ${message}`, ...rest);
    }
}

function logWarn(message, ...rest) {
    if (VERBOSE_LOGGING) {
        console.warn(`[AutoProfileSignIn] ${message}`, ...rest);
    }
}

function logError(message, ...rest) {
    console.error(`[AutoProfileSignIn] ${message}`, ...rest);
}

// ---------- Identity ----------

function fetchProfileUserInfo() {
    // Edge / Chromium variants disagree on whether getProfileUserInfo accepts
    // a details object and whether it returns a Promise. Always invoke as a
    // method on chrome.identity (no destructuring) to keep `this` bound.
    return new Promise((resolve) => {
        const identity = chrome.identity;
        if (!identity || typeof identity.getProfileUserInfo !== 'function') {
            logWarn('chrome.identity.getProfileUserInfo unavailable');
            resolve({ email: '' });
            return;
        }

        const onResult = (info) => resolve(info || { email: '' });

        try {
            const maybePromise = identity.getProfileUserInfo({ accountStatus: 'ANY' }, onResult);
            if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.then(onResult, (err) => {
                    logError('getProfileUserInfo (with details) rejected:', err);
                    resolve({ email: '' });
                });
            }
        } catch (errWithDetails) {
            logWarn('getProfileUserInfo with details threw, retrying:', errWithDetails);
            try {
                const maybePromise = identity.getProfileUserInfo(onResult);
                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.then(onResult, (err) => {
                        logError('getProfileUserInfo (callback) rejected:', err);
                        resolve({ email: '' });
                    });
                }
            } catch (errCallback) {
                logError('getProfileUserInfo failed entirely:', errCallback);
                resolve({ email: '' });
            }
        }
    });
}

async function resolveProfileEmail() {
    if (cachedProfileEmail) {
        return cachedProfileEmail;
    }
    const info = await fetchProfileUserInfo();
    if (info && info.email) {
        cachedProfileEmail = info.email;
        logDebug('Resolved profile email:', cachedProfileEmail);
    } else {
        logWarn('No profile email available; sign in to the browser profile.');
    }
    return cachedProfileEmail;
}

// ---------- Persistence ----------

function loadEnabledState() {
    return new Promise((resolve) => {
        chrome.storage.local.get(STORAGE_KEY_ENABLED, (data) => {
            const stored = data ? data[STORAGE_KEY_ENABLED] : undefined;
            isAutoSignInEnabled = (stored === undefined) ? true : !!stored;
            resolve(isAutoSignInEnabled);
        });
    });
}

function persistEnabledState(nextEnabled) {
    isAutoSignInEnabled = !!nextEnabled;
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEY_ENABLED]: isAutoSignInEnabled }, resolve);
    });
}

// ---------- Redirect rules ----------

function buildRedirectRules(emailAddress) {
    const tenantDomain = emailAddress.split('@').pop();

    const aadAuthorizeRule = {
        id: RULE_ID_AAD_AUTHORIZE,
        priority: 1,
        action: {
            type: 'redirect',
            redirect: {
                transform: {
                    queryTransform: {
                        addOrReplaceParams: [
                            { key: 'login_hint', value: emailAddress },
                        ],
                        removeParams: ['prompt'],
                    },
                },
            },
        },
        condition: {
            regexFilter: '^https://login\\.microsoftonline\\.com/[^/]+/oauth2/(?:v2\\.0/)?authorize',
            resourceTypes: ['main_frame', 'sub_frame'],
        },
    };

    const federatedRule = {
        id: RULE_ID_FEDERATED,
        priority: 1,
        action: {
            type: 'redirect',
            redirect: {
                transform: {
                    queryTransform: {
                        addOrReplaceParams: [
                            { key: 'whr', value: tenantDomain },
                        ],
                    },
                },
            },
        },
        condition: {
            regexFilter: '^https://login\\.microsoftonline\\.com/.*/(?:saml2|wsfed)',
            resourceTypes: ['main_frame', 'sub_frame'],
        },
    };

    const commonChooserRule = {
        id: RULE_ID_COMMON_CHOOSER,
        priority: 1,
        action: {
            type: 'redirect',
            redirect: {
                transform: {
                    queryTransform: {
                        addOrReplaceParams: [
                            { key: 'login_hint', value: emailAddress },
                        ],
                        removeParams: ['prompt'],
                    },
                },
            },
        },
        condition: {
            regexFilter: '^https://login\\.microsoftonline\\.com/(?:common|organizations|consumers)/(?:reprocess|login)',
            resourceTypes: ['main_frame', 'sub_frame'],
        },
    };

    return [aadAuthorizeRule, federatedRule, commonChooserRule];
}

async function syncRedirectRules() {
    const emailAddress = await resolveProfileEmail();

    if (!emailAddress || !isAutoSignInEnabled) {
        logDebug('Clearing rules. email=', emailAddress, 'enabled=', isAutoSignInEnabled);
        try {
            await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ALL_RULE_IDS });
        } catch (err) {
            logError('Failed to clear rules:', err);
        }
        return;
    }

    const newRules = buildRedirectRules(emailAddress);
    try {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: ALL_RULE_IDS,
            addRules: newRules,
        });
        logDebug('Installed redirect rules for', emailAddress);
    } catch (err) {
        logError('Failed to install rules:', err);
    }
}

// ---------- Toolbar / icon ----------

function refreshToolbarBadge() {
    const badgeText = isAutoSignInEnabled ? '' : 'Off';
    const badgeColor = [200, 0, 0, 255];
    chrome.action.setBadgeBackgroundColor({ color: badgeColor });
    chrome.action.setBadgeText({ text: badgeText });
}

async function toggleEnabledState() {
    await persistEnabledState(!isAutoSignInEnabled);
    refreshToolbarBadge();
    await syncRedirectRules();
}

// ---------- Bootstrapping ----------

async function bootstrap() {
    await loadEnabledState();
    refreshToolbarBadge();
    await syncRedirectRules();
}

bootstrap();

chrome.runtime.onInstalled.addListener(() => {
    logDebug('onInstalled');
    bootstrap();
});

if (chrome.runtime.onStartup && typeof chrome.runtime.onStartup.addListener === 'function') {
    chrome.runtime.onStartup.addListener(() => {
        logDebug('onStartup');
        bootstrap();
    });
}

if (chrome.identity && chrome.identity.onSignInChanged
    && typeof chrome.identity.onSignInChanged.addListener === 'function') {
    chrome.identity.onSignInChanged.addListener(() => {
        logDebug('Profile sign-in changed; clearing cached email.');
        cachedProfileEmail = '';
        bootstrap();
    });
}

chrome.action.onClicked.addListener(() => {
    toggleEnabledState();
});

