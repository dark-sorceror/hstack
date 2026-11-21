import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const tests=(await readdir('tests')).filter(name=>name.endsWith('.test.cjs')).sort().map(name=>'tests/'+name);
const child=spawnSync(process.execPath,['--test',...tests],{stdio:'inherit'});
if(child.error) throw child.error;
process.exitCode=child.status ?? 1;
