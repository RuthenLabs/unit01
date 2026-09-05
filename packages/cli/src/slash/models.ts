import { ollama } from '@unit01/core/llm/client.js';
import { PERSONALITY_TONES } from '../prompt/instructions.js';
import { SlashContext } from './types.js';

export async function handleModelCommands(command: string, arg: string, ctx: SlashContext): Promise<boolean> {
  const {
    ui,
    activeModel,
    setActiveModel,
    setModelContextWindow,
    gitBranch,
    activePersonality,
    setActivePersonality,
    thinkingEnabled,
    setThinkingEnabled
  } = ctx;

  if (command === '/models' || command === '/model') {
    const models = await ollama.listModels();
    if (models.length === 0) {
      ui.printSystemMessage('warn', 'No models found in Ollama. Run `ollama pull qwen2.5-coder:7b` to install one.');
      return true;
    }

    if (arg.trim()) {
      const match = models.find(m => m.name.toLowerCase() === arg.trim().toLowerCase());
      if (match) {
        setActiveModel(match.name);
        const limit = await ollama.getContextLimit(match.name);
        setModelContextWindow(limit);
        const modelSupportsThinking = await ollama.checkModelThinkingCapability(match.name).catch(() => false);
        setThinkingEnabled(modelSupportsThinking);
        ui.updateStatus(match.name, '0', gitBranch);
        ui.printSystemMessage('info', `Switched to active model: ${match.name} (Thinking: ${modelSupportsThinking ? 'yes' : 'no'})`);
        return true;
      }
    }

    const options = models.map(m => {
      const activeIndicator = m.name === activeModel ? ' (active)' : '';
      return `${m.name}${activeIndicator}`;
    });
    const chosenIdx = await ui.interactiveSelect('Select Active Model:', options);
    if (chosenIdx !== -1) {
      const newModel = models[chosenIdx].name;
      setActiveModel(newModel);
      const limit = await ollama.getContextLimit(newModel);
      setModelContextWindow(limit);
      const modelSupportsThinking = await ollama.checkModelThinkingCapability(newModel).catch(() => false);
      setThinkingEnabled(modelSupportsThinking);
      ui.updateStatus(newModel, '0', gitBranch);
      ui.printSystemMessage('info', `Switched to active model: ${newModel} (Thinking: ${modelSupportsThinking ? 'yes' : 'no'})`);
    }
    return true;
  }

  if (command === '/thinking') {
    const chosenIdx = await ui.interactiveSelect('Model Thinking Mode:', [
      `Enable Thinking  ${thinkingEnabled ? '✓' : ''}`,
      `Disable Thinking ${!thinkingEnabled ? '✓' : ''}`
    ]);
    if (chosenIdx === 0) {
      setThinkingEnabled(true);
      ui.printSystemMessage('info', 'Model thinking enabled.');
    } else if (chosenIdx === 1) {
      setThinkingEnabled(false);
      ui.printSystemMessage('info', 'Model thinking disabled.');
    }
    return true;
  }

  if (command === '/personality') {
    const keys = Object.keys(PERSONALITY_TONES);
    const options = keys.map(k => {
      const activeIndicator = k === activePersonality ? ' (active)' : '';
      return `${PERSONALITY_TONES[k].label}${activeIndicator}`;
    });
    const chosenIdx = await ui.interactiveSelect('Select Personality:', options);
    if (chosenIdx !== -1) {
      const newPersonality = keys[chosenIdx];
      setActivePersonality(newPersonality);
      ui.printSystemMessage('info', `Switched to personality: ${PERSONALITY_TONES[newPersonality].label}`);
    }
    return true;
  }

  return false;
}
