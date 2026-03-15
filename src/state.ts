import * as fs from "fs";
import { config, type State } from "./config.ts";

export function loadState(): State {
  try {
    if (fs.existsSync(config.stateFile)) {
      return JSON.parse(fs.readFileSync(config.stateFile, "utf-8"));
    }
  } catch {}
  return {};
}

export function saveState(state: State): void {
  fs.writeFileSync(config.stateFile, JSON.stringify(state, null, 2), "utf-8");
}
