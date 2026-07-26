import { execFileSync, execSync } from 'child_process';

/**
 * Save a credential token to the macOS Keychain.
 */
export function saveToKeychain(service: string, token: string): void {
  try {
    // -a: Account, -s: Service, -w: Password data, -U: Update if exists
    execFileSync('security', ['add-generic-password', '-a', 'unit01', '-s', `unit01-${service}`, '-w', token, '-U'], { stdio: 'ignore' });
  } catch (err) {
    throw new Error(`Failed to save credential for ${service} to macOS Keychain.`);
  }
}

/**
 * Retrieve a credential token from the macOS Keychain.
 */
export function getFromKeychain(service: string): string | null {
  try {
    const output = execFileSync('security', ['find-generic-password', '-a', 'unit01', '-s', `unit01-${service}`, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return output.trim();
  } catch (err) {
    return null;
  }
}

/**
 * Delete a credential from the macOS Keychain.
 */
export function deleteFromKeychain(service: string): void {
  try {
    execFileSync('security', ['delete-generic-password', '-a', 'unit01', '-s', `unit01-${service}`], { stdio: 'ignore' });
  } catch (err) {
    // Ignore errors if the item does not exist
  }
}

/**
 * Check if the Linux Secret Service command-line tool (secret-tool) is available.
 */
export function isSecretToolAvailable(): boolean {
  if (process.platform === 'darwin') return false;
  try {
    execSync('which secret-tool', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Save a credential token to the Linux Secret Service Keyring.
 */
export function saveToSecretTool(service: string, token: string): void {
  try {
    execFileSync('secret-tool', ['store', '--label=Unit01 Credentials', 'application', 'unit01', 'service', service], {
      input: token,
      stdio: ['pipe', 'ignore', 'ignore']
    });
  } catch (err) {
    throw new Error(`Failed to save credential for ${service} to Linux Secret Service Keyring.`);
  }
}

/**
 * Retrieve a credential token from the Linux Secret Service Keyring.
 */
export function getFromSecretTool(service: string): string | null {
  try {
    const output = execFileSync('secret-tool', ['lookup', 'application', 'unit01', 'service', service], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return output.trim();
  } catch (err) {
    return null;
  }
}

/**
 * Delete a credential from the Linux Secret Service Keyring.
 */
export function deleteFromSecretTool(service: string): void {
  try {
    execFileSync('secret-tool', ['clear', 'application', 'unit01', 'service', service], {
      stdio: 'ignore'
    });
  } catch (err) {
    // Ignore errors if it does not exist
  }
}
