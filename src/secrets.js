/**
 * Secret shaped-value detection.
 *
 * Everything here returns the NAME of the pattern that matched and never the
 * value itself, so a report can be pasted into an issue without leaking.
 */

const NAMED_PATTERNS = [
    { name: "private key header", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{22,})\b/ },
    { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
    { name: "Stripe live key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{10,}\b/ },
    { name: "OpenAI-style secret key", re: /\bsk-(?:proj-|ant-|or-)?[A-Za-z0-9_-]{16,}\b/ },
    { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
    { name: "SendGrid API key", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/ },
    { name: "JSON web token", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
    { name: "npm access token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
];

const BASE64ISH = /^[A-Za-z0-9+/=_-]{32,}$/;
const LONG_HEX = /^[0-9a-fA-F]{40,}$/;

/**
 * Shannon entropy in bits per character.
 *
 * @param {string} value
 * @returns {number}
 */
export function shannonEntropy(value) {
    if (!value) {
        return 0;
    }
    const counts = new Map();
    for (const ch of value) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    let entropy = 0;
    for (const count of counts.values()) {
        const p = count / value.length;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

/**
 * @param {string} value
 * @returns {{ pattern: string } | null} the pattern name, never the value
 */
export function detectSecret(value) {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    if (trimmed.length < 16) {
        return null;
    }
    for (const { name, re } of NAMED_PATTERNS) {
        if (re.test(trimmed)) {
            return { pattern: name };
        }
    }
    if (LONG_HEX.test(trimmed) && shannonEntropy(trimmed) >= 3.0) {
        return { pattern: "long hex string (40+ chars)" };
    }
    if (BASE64ISH.test(trimmed) && shannonEntropy(trimmed) >= 3.6) {
        return { pattern: "high-entropy base64-like string (32+ chars)" };
    }
    return null;
}
