import chalk from 'chalk';
import { SlashContext } from './types.js';

export async function handleConnectCommands(command: string, arg: string, ctx: SlashContext): Promise<boolean> {
  const { ui } = ctx;

  if (command === '/search') {
    const { isPro } = await import('@unit01/core/tier.js');
    if (!isPro()) {
      ui.printSystemMessage('error', 'Web search configuration is a Pro tier feature. Upgrade to Pro to configure search integration.');
      return true;
    }
    const PROVIDERS = ['scrapling', 'tavily', 'brave', 'exa', 'serper', 'duckduckgo', 'auto'];
    const argTrimmed = arg ? arg.trim().toLowerCase() : '';

    if (argTrimmed.startsWith('limit ')) {
      const limitVal = parseInt(argTrimmed.substring(6).trim(), 10);
      if (isNaN(limitVal) || limitVal < 1 || limitVal > 20) {
        ui.printSystemMessage('error', 'Search limit must be a valid integer between 1 and 20.');
      } else {
        try {
          const { setSearchLimit } = await import('@unit01/pro/connect/integrations/search.js');
          setSearchLimit(limitVal);
          ui.printSystemMessage('info', `Search result count limit set to: ${limitVal}`);
        } catch (e: any) {
          ui.printSystemMessage('error', `Failed to set search limit: ${e.message}`);
        }
      }
      return true;
    }

    if (arg && PROVIDERS.includes(arg.trim().toLowerCase())) {
      const provider = arg.trim().toLowerCase();
      try {
        const { setSearchProvider } = await import('@unit01/pro/connect/integrations/search.js');
        setSearchProvider(provider);
        ui.printSystemMessage('info', `Web search provider switched to: ${provider}`);
      } catch (e: any) {
        ui.printSystemMessage('error', `Failed to switch search provider: ${e.message}`);
      }
      return true;
    }

    try {
      const { getSearchProvider, getSearchLimit } = await import('@unit01/pro/connect/integrations/search.js');
      const currentProvider = getSearchProvider();
      const currentLimit = getSearchLimit();

      const options = PROVIDERS.map(p => {
        const active = p === currentProvider ? ' (active)' : '';
        return `${p}${active}`;
      });

      const choiceIdx = await ui.interactiveSelect('Select Web Search Provider:', options);
      if (choiceIdx !== -1) {
        const chosen = PROVIDERS[choiceIdx];
        const { setSearchProvider } = await import('@unit01/pro/connect/integrations/search.js');
        setSearchProvider(chosen);
        ui.printSystemMessage('info', `Web search provider set to: ${chosen} (limit: ${currentLimit})`);
      }
    } catch (e: any) {
      ui.printSystemMessage('error', `Search config error: ${e.message}`);
    }
    return true;
  }

  if (command === '/connect') {
    let service = '';
    let token = '';

    if (arg) {
      const parts = arg.trim().split(/\s+/);
      if (parts.length === 2) {
        [service, token] = parts;
      } else {
        ui.printSystemMessage('error', 'Usage: /connect <service> <token> or just /connect to open the interactive menu.');
        return true;
      }
    } else {
      const { isPro, isServiceConnected } = await import('@unit01/core/tier.js');

      const serviceOptions = [
        { id: 'tavily', label: 'Tavily (Web Search)' },
        { id: 'brave', label: 'Brave Web Search' },
        { id: 'exa', label: 'Exa (Web Search)' },
        { id: 'jina', label: 'Jina (Web Search)' },
        { id: 'serper', label: 'Serper (Web Search)' },
        { id: 'github', label: 'GitHub API Integration' },
        { id: 'slack', label: 'Slack Integration' },
        { id: 'linear', label: 'Linear (Issue Tracking)' },
        { id: 'sentry', label: 'Sentry (Error Tracking)' },
        { id: 'notion', label: 'Notion Database Integration' }
      ];

      const options = serviceOptions.map(opt => {
        const connected = isServiceConnected(opt.id);
        const statusSuffix = connected ? chalk.hex('#10B981')(' (Connected)') : '';
        return `${opt.label}${statusSuffix}`;
      });
      options.push('Disconnect Service');

      const choiceIdx = await ui.interactiveSelect('Select Service to Connect:', options);
      if (choiceIdx === -1) return true;

      if (choiceIdx === options.length - 1) {
        const activeServices = serviceOptions.filter(opt => isServiceConnected(opt.id));

        if (activeServices.length === 0) {
          ui.printSystemMessage('info', 'No active services to disconnect.');
          return true;
        }

        const disconnectLabels = activeServices.map(opt => opt.label);
        const selectDisconnectIdx = await ui.interactiveSelect('Select Service to Disconnect:', disconnectLabels);
        if (selectDisconnectIdx === -1) return true;

        const targetService = activeServices[selectDisconnectIdx].id;
        try {
          if (!isPro()) {
            const { deletePlaintextToken } = await import('@unit01/core/tier.js');
            deletePlaintextToken(targetService);
            ui.printSystemMessage('info', `Disconnected credentials for service: ${targetService}`);
            return true;
          }
          const { disconnectService } = await import('@unit01/pro/connect/index.js');
          disconnectService(targetService);
          ui.printSystemMessage('info', `Disconnected credentials for service: ${targetService}`);
        } catch (e: any) {
          ui.printSystemMessage('error', `Failed to disconnect service: ${e.message}`);
        }
        return true;
      }

      const selectedOpt = serviceOptions[choiceIdx];
      if (isServiceConnected(selectedOpt.id)) {
        ui.printSystemMessage('error', `Service "${selectedOpt.id}" is already connected. Please disconnect it first before entering a new token.`);
        return true;
      }

      service = selectedOpt.id;
      const inputPrompt = `Enter API Token/Key for ${selectedOpt.label}:`;
      token = await ui.interactiveInput(inputPrompt);
      if (!token || token.trim().length === 0) {
        ui.printSystemMessage('error', 'API Token/Key cannot be empty.');
        return true;
      }
      token = token.trim();
    }

    ui.showToolProgress(`Connecting service ${service}...`);
    try {
      const { isPro, savePlaintextToken } = await import('@unit01/core/tier.js');

      if (!isPro()) {
        const isValid = token.length > 0;
        ui.hideToolProgress();
        if (!isValid) {
          ui.printSystemMessage('error', `Failed to validate token for ${service}. Please check your credentials.`);
          return true;
        }
        savePlaintextToken(service, token);
        ui.printSystemMessage('info', `Successfully connected service: ${service}`);
        ui.addTextOutput(
          `\n  ${chalk.hex('#F59E0B')('⚠️ Warning:')} ${chalk.hex('#6B7280')('Stored credentials in plaintext at ~/.unit01/config.json.')}\n  ${chalk.hex('#6B7280')('Upgrade to Pro to use the secure OS Keychain / encrypted Vault.')}\n`
        );
        return true;
      }

      const { validateServiceToken, connectService, isSecretToolAvailable } = await import('@unit01/pro/connect/index.js');
      const isValid = await validateServiceToken(service, token);
      if (!isValid) {
        ui.hideToolProgress();
        ui.printSystemMessage('error', `Failed to validate token for ${service}. Please check your credentials.`);
        return true;
      }

      if (process.platform !== 'darwin' && !isSecretToolAvailable()) {
        const { vaultExists, unlockWithPassword, initializeVault } = await import('@unit01/pro/connect/vault.js');
        if (vaultExists()) {
          let unlocked = false;
          while (!unlocked) {
            const password = await ui.interactiveInput('Enter Vault Master Password to unlock credentials store:');
            if (!password) {
              ui.printSystemMessage('error', 'Password required to unlock credentials vault.');
              ui.hideToolProgress();
              return true;
            }
            unlocked = unlockWithPassword(password);
            if (!unlocked) {
              ui.printSystemMessage('error', 'Incorrect password. Try again.');
            }
          }
        } else {
          const password = await ui.interactiveInput('Create a new Vault Master Password to encrypt API credentials:');
          if (!password) {
            ui.printSystemMessage('error', 'Password required to initialize credentials vault.');
            ui.hideToolProgress();
            return true;
          }
          const confirmPassword = await ui.interactiveInput('Confirm Vault Master Password:');
          if (password !== confirmPassword) {
            ui.printSystemMessage('error', 'Passwords do not match. Vault initialization aborted.');
            ui.hideToolProgress();
            return true;
          }
          const recoveryKey = initializeVault(password);
          ui.printSystemMessage('info', `Vault initialized successfully!\nYour Recovery Key (keep this safe!):\n--> ${recoveryKey}`);
        }
      }

      await connectService(service, token);
      ui.hideToolProgress();
      ui.printSystemMessage('info', `Successfully connected service: ${service}`);
    } catch (e: any) {
      ui.hideToolProgress();
      ui.printSystemMessage('error', `Failed to connect service: ${e.message}`);
    }
    return true;
  }

  if (command === '/reset-password') {
    if (process.platform === 'darwin') {
      ui.printSystemMessage('info', 'Password vault not used on macOS (using native Keychain).');
      return true;
    }
    const { isSecretToolAvailable } = await import('@unit01/pro/connect/index.js');
    if (isSecretToolAvailable()) {
      ui.printSystemMessage('info', 'Password vault not used (using Linux Secret Service Keyring).');
      return true;
    }

    const { vaultExists, unlockWithRecoveryKey, resetVaultPassword } = await import('@unit01/pro/connect/vault.js');
    if (!vaultExists()) {
      ui.printSystemMessage('error', 'Vault does not exist. Use /connect to initialize it first.');
      return true;
    }

    const recoveryKey = await ui.interactiveInput('Enter Vault Master Recovery Key:');
    if (!recoveryKey) {
      ui.printSystemMessage('error', 'Recovery key required.');
      return true;
    }

    const unlocked = unlockWithRecoveryKey(recoveryKey.trim());
    if (!unlocked) {
      ui.printSystemMessage('error', 'Invalid Recovery Key.');
      return true;
    }

    const newPassword = await ui.interactiveInput('Enter new Master Password:');
    if (!newPassword) {
      ui.printSystemMessage('error', 'New password required.');
      return true;
    }
    const confirmPassword = await ui.interactiveInput('Confirm new Master Password:');
    if (newPassword !== confirmPassword) {
      ui.printSystemMessage('error', 'Passwords do not match.');
      return true;
    }

    const success = resetVaultPassword(recoveryKey.trim(), newPassword);
    if (success) {
      ui.printSystemMessage('info', 'Vault master password reset successfully.');
    } else {
      ui.printSystemMessage('error', 'Failed to reset vault password.');
    }
    return true;
  }

  return false;
}
