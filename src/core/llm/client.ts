import { execSync } from 'child_process';

export interface OllamaModel {
  name: string;
  details: {
    parameter_size: string;
    quantization_level: string;
  };
}

export class OllamaClient {
  private host: string;

  constructor(host = 'http://127.0.0.1:11434') {
    this.host = host;
  }

  /**
   * List all downloaded local models.
   */
  public async listModels(): Promise<OllamaModel[]> {
    try {
      const res = await fetch(`${this.host}/api/tags`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = (await res.json()) as { models: OllamaModel[] };
      return data.models || [];
    } catch (err) {
      console.warn('[Ollama Client] Could not query local Ollama server. Ensure it is running.');
      return [];
    }
  }

  /**
   * Query model details to extract the native context window limit (num_ctx).
   */
  public async getContextLimit(modelName: string): Promise<number> {
    try {
      const res = await fetch(`${this.host}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName })
      });
      if (!res.ok) return 4096; // Fallback default
      
      const data = (await res.json()) as { 
        parameters?: string; 
        system?: string;
        model_info?: Record<string, any>;
      };
      
      // 1. Try checking model_info for any key ending in .context_length
      if (data.model_info) {
        for (const [key, val] of Object.entries(data.model_info)) {
          if (key.endsWith('.context_length') && typeof val === 'number') {
            return val;
          }
        }
      }
      
      return 2048; // Default Ollama context window size fallback
    } catch (err) {
      return 2048; // Fallback default on error
    }
  }

  public async checkModelToolsCapability(modelName: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName })
      });
      if (!res.ok) return false;
      const data = await res.json() as { model_info?: Record<string, any>; capabilities?: string[] };
      if (data.capabilities && data.capabilities.includes('tools')) {
        return true;
      }
      const name = modelName.toLowerCase();
      if (name.includes('qwen') || name.includes('llama3.1') || name.includes('llama3.2') || name.includes('llama3.3') || name.includes('mistral') || name.includes('gemma2') || name.includes('gemma')) {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if a model supports native reasoning/thinking tokens.
   */
  public async checkModelThinkingCapability(modelName: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName })
      });
      if (!res.ok) return false;
      const data = await res.json() as { capabilities?: string[] };
      return !!(data.capabilities && data.capabilities.includes('thinking'));
    } catch (e) {
      return false;
    }
  }

  /**
   * Send a streaming chat payload to the local model.
   */
  public async chatStream(
    modelName: string,
    messages: { role: string; content: string; tool_calls?: any[] }[],
    contextLimit: number,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
    tools?: any[],
    modelSupportsThinking?: boolean
  ): Promise<{ content: string; tool_calls?: any[]; usage: { input_tokens: number; output_tokens: number } }> {
    // Do NOT override num_ctx unless the user explicitly set one in unit01.json.
    // Ollama already auto-selects context based on available VRAM:
    //   <24 GiB VRAM  → 4K default
    //   24-48 GiB     → 32K default
    //   ≥48 GiB       → 256K default
    // Overriding this with our own cap would undo Ollama's hardware-aware decision.
    const requestBody: Record<string, any> = {
      model: modelName,
      messages,
      options: {
        ...(contextLimit > 0 ? { num_ctx: contextLimit } : {}),
        temperature: 0.1,
        repeat_penalty: 1.15
      },
      stream: true
    };
    // Only enable thinking for models that explicitly declare thinking capability
    if (modelSupportsThinking) {
      requestBody.think = true;
    }
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    const res = await fetch(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal
    });

    if (!res.ok) {
      throw new Error(`Ollama chat stream failed: ${res.statusText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('Could not get response stream reader');
    }

    let input_tokens = 0;
    let output_tokens = 0;
    let tool_calls: any[] | undefined;
    let isThinkingActive = false;

    try {
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          let chunk: string | undefined;
          try {
            const json = JSON.parse(line) as {
              message?: { content: string; thinking?: string; tool_calls?: any[] };
              done?: boolean;
              prompt_eval_count?: number;
              eval_count?: number;
            };
            if (json.message?.thinking) {
              if (!isThinkingActive) {
                isThinkingActive = true;
                fullText += '<think>\n';
                onChunk('<think>\n');
              }
              chunk = json.message.thinking;
            } else if (json.message?.content) {
              if (isThinkingActive) {
                isThinkingActive = false;
                fullText += '\n</think>\n';
                onChunk('\n</think>\n');
              }
              chunk = json.message.content;
            }
            if (json.message?.tool_calls && json.message.tool_calls.length > 0) {
              tool_calls = json.message.tool_calls;
            }
            if (json.prompt_eval_count !== undefined) {
              input_tokens = json.prompt_eval_count;
            }
            if (json.eval_count !== undefined) {
              output_tokens = json.eval_count;
            }
          } catch (e) {
            // ignore parsing error for malformed lines
          }

          if (chunk !== undefined) {
            fullText += chunk;
            onChunk(chunk);
          }
        }
      }

      if (isThinkingActive) {
        fullText += '\n</think>\n';
        onChunk('\n</think>\n');
      }

      return {
        content: fullText,
        tool_calls,
        usage: {
          input_tokens,
          output_tokens
        }
      };
    } catch (err) {
      try {
        await reader.cancel();
      } catch (_) {}
      throw err;
    }
  }
}
export const ollama = new OllamaClient();
