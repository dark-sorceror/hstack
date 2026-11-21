import type { App, Editor } from 'obsidian';
export type BridgeMethod = 'capabilities' | 'context' | 'query' | 'readSection' | 'sql' | 'patch' | 'reveal';
export interface BridgeRequest { apiVersion?:1; id?:string | number; method:BridgeMethod; params?:Record<string,unknown>; }
export type BridgeResponse = {apiVersion:1;id:string|number|null;ok:true;result:unknown} |
  {apiVersion:1;id:string|number|null;ok:false;error:{code:string;message:string;details?:unknown}};
export interface SlashCommandContext { editor:Editor; from:number; to:number; title:string; app:App; }
export interface SlashCommand {
  id:string; name:string; aliases?:string[]; icon?:string; description:string;
  run(context:SlashCommandContext):void | Promise<void>;
}
export interface HstackAPI {
  readonly version:1;
  request(request:BridgeRequest):Promise<BridgeResponse>;
  formatMarkdown(markdown:string):string;
  /** Dispose the registration on unload. Never execute code taken from a note. */
  registerSlashCommand(command:SlashCommand):()=>void;
}
