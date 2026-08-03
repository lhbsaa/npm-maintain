import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Execute a shell command and return stdout.
 * @param {string} command - Full command string
 * @param {string} cwd - Working directory
 * @param {number} timeout - Timeout in ms (default 120000)
 * @returns {Promise<string>} stdout output
 */
export async function execCommand(command, cwd, timeout = 120000) {
  try {
    const { stdout } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      encoding: 'utf-8',
      shell: true,
    });
    return stdout.trim();
  } catch (err) {
    // npm/pnpm/yarn exit with code 1 for outdated/ls when there ARE findings
    // (outdated packages, or missing/peer deps) — stdout still holds valid output.
    // Exit code 2+ means a real failure (bad flag, missing command) → throw.
    const expectedFindings = err.code === 1
      && (command.includes('outdated') || /\b(?:ls|list)\b/.test(command));
    if (expectedFindings && err.stdout) {
      return err.stdout.trim();
    }
    throw new Error(`Command failed: ${command}\n${err.stderr || err.message}`);
  }
}

/**
 * Execute a command and parse JSON output.
 * npm/pnpm/yarn commands often output JSON to stdout.
 * @param {string} command - Full command string
 * @param {string} cwd - Working directory
 * @returns {Promise<object>} Parsed JSON object
 */
export async function execJSON(command, cwd) {
  const output = await execCommand(command, cwd);
  if (!output) return {};
  // Fast path: most npm/pnpm --json output is pure JSON.
  try {
    return JSON.parse(output);
  } catch {
    // Fall back: some commands (yarn) prefix JSON with log lines. Scan for
    // the first valid JSON object/array rather than blindly slicing on the
    // first '{' (which could sit inside a log message and grab the wrong span).
    for (let i = 0; i < output.length; i++) {
      const ch = output[i];
      if (ch !== '{' && ch !== '[') continue;
      const close = ch === '{' ? '}' : ']';
      const j = output.lastIndexOf(close);
      if (j <= i) continue;
      try {
        return JSON.parse(output.slice(i, j + 1));
      } catch {
        // keep scanning for a later valid start
      }
    }
    return { raw: output };
  }
}

/**
 * Execute a command that may produce non-JSON output.
 * Returns trimmed stdout string.
 */
export async function execText(command, cwd) {
  return execCommand(command, cwd);
}
