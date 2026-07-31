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
    // npm outdated returns exit code 1 when packages are outdated (not a real error)
    if (err.stdout && (command.includes('outdated') || command.includes('ls'))) {
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
  // Some commands (yarn) wrap output in extra lines; find the JSON
  const jsonStart = output.indexOf('{');
  const jsonEnd = output.lastIndexOf('}');
  if (jsonStart === -1) return {};
  const jsonStr = output.slice(jsonStart, jsonEnd + 1);
  try {
    return JSON.parse(jsonStr);
  } catch {
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
