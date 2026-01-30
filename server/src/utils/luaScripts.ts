import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPTS_DIR = path.join(__dirname, '..', 'lua');

class LuaScriptLoader {
  private scripts = new Map<string, string>();

  constructor() {
    this.loadAllScripts();
  }

  private loadAllScripts(): void {
    const scriptFiles = [
      'atomicCharUpdate.lua',
      'registerRoomCreation.lua',
      'unregisterRoomCreation.lua',
      'releaseLock.lua'
    ];

    for (const filename of scriptFiles) {
      const scriptPath = path.join(SCRIPTS_DIR, filename);
      try {
        const content = fs.readFileSync(scriptPath, 'utf8');
        const name = filename.replace('.lua', '');
        this.scripts.set(name, content);
        console.log(`Loaded Lua script: ${name}`);
      } catch (error: any) {
        console.error(`Failed to load Lua script ${filename}:`, error.message);
        throw error;
      }
    }
  }

  public getScript(name: string): string {
    const script = this.scripts.get(name);
    if (!script) {
      throw new Error(`Lua script not found: ${name}`);
    }
    return script;
  }
}

export default new LuaScriptLoader();