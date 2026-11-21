import {readFile,copyFile,mkdir,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
const args=process.argv.slice(2),vaultArg=args.find(x=>!x.startsWith('--'));
if(!vaultArg) throw Error('Usage: npm run deploy -- /absolute/test-vault [--config-dir=.obsidian] [--legacy]');
const vault=path.resolve(vaultArg);
const config=args.find(x=>x.startsWith('--config-dir='))?.slice(13)||'.obsidian';
if(path.isAbsolute(config)||config.split(/[\\/]/).includes('..')) throw Error('Use a vault-relative config directory.');
const manifest=JSON.parse(await readFile('manifest.json','utf8'));
if(args.includes('--legacy')) manifest.id='notes-typing-helpers';
const folder=path.join(vault,config,'plugins',manifest.id);
await access(vault); await mkdir(folder,{recursive:true});
// Do not copy source or data.json. User configuration stays in the target vault.
for(const name of ['main.js','styles.css']) await copyFile(name,path.join(folder,name));
await writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Deployed '+folder+'; enable/reload this plugin in Obsidian. Settings preserved.');
