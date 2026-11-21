import CorePlugin from "./plugin.js";
import { createPublicAPI } from "./public-api.js";
import type { HstackAPI } from "./api";

/** Typed public entry point. Existing tested algorithms remain plain JS. */
export default class HstackPlugin extends CorePlugin {
  api!: HstackAPI;
  async onload(): Promise<void> {
    await super.onload();
    this.api = createPublicAPI(this);
  }
}
