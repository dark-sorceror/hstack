import {mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const {version}=JSON.parse(await readFile('manifest.json','utf8'));
execFileSync(process.execPath,['scripts/verify-package.mjs'],{stdio:'inherit'});
const directory=`dist/${version}`;
await mkdir(directory,{recursive:true});
const checks=[];
for(const name of ['main.js','manifest.json','styles.css']) {
  await copyFile(name,`${directory}/${name}`);
  checks.push(createHash('sha256').update(await readFile(name)).digest('hex')+'  '+name);
}
await writeFile(`${directory}/SHA256SUMS`,checks.join('\n')+'\n');
console.log(`Release assets: ${directory}. Attach the three plugin files to GitHub tag ${version}.`);
