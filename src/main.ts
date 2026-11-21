import CorePlugin from "./plugin.js";
import { createPublicAPI } from "./public-api.js";
import type { HstackAPI } from "./api";

/** Obsidian entry point and the typed public facade. */
export default class HstackPlugin extends CorePlugin {
  declare api: HstackAPI;
  async onload(): Promise<void> {
    await super.onload();
    this.api = createPublicAPI(this);
  }
}
