import * as esbuild from 'esbuild';
import { builtinModules } from 'node:module';
const options = {entryPoints:['src/main.ts'], bundle:true, platform:'node', format:'cjs', target:'es2021', external:['obsidian','electron','@codemirror/*','@lezer/*',...builtinModules], outfile:'main.js'};
if(process.argv.includes('--watch')) { const context=await esbuild.context(options); await context.watch(); }
else await esbuild.build(options);
