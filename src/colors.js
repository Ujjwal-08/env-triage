/**
 * Twenty lines of ANSI instead of a dependency.
 */

const CODES = {
    red: ["\u001B[31m", "\u001B[39m"],
    yellow: ["\u001B[33m", "\u001B[39m"],
    green: ["\u001B[32m", "\u001B[39m"],
    cyan: ["\u001B[36m", "\u001B[39m"],
    dim: ["\u001B[2m", "\u001B[22m"],
    bold: ["\u001B[1m", "\u001B[22m"],
};

const identity = (text) => String(text);

/**
 * @param {boolean} enabled
 * @returns {Record<keyof typeof CODES, (text: string) => string>}
 */
export function createColors(enabled) {
    const colors = {};
    for (const [name, [open, close]] of Object.entries(CODES)) {
        colors[name] = enabled ? (text) => `${open}${text}${close}` : identity;
    }
    return colors;
}

/**
 * Honours NO_COLOR and non-TTY output.
 *
 * @param {NodeJS.WriteStream} [stream]
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function supportsColor(stream, env) {
    const environment = env ?? process.env;
    if (environment.NO_COLOR !== undefined && environment.NO_COLOR !== "") {
        return false;
    }
    if (environment.FORCE_COLOR !== undefined && environment.FORCE_COLOR !== "0") {
        return true;
    }
    const target = stream ?? process.stdout;
    return Boolean(target && target.isTTY);
}
