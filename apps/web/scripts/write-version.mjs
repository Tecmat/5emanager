// scrive public/version.json con la versione del root package.json + timestamp di build:
// la web app la usa per capire se il server sta servendo una build più recente (check update)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rootPkg = JSON.parse(readFileSync(join(here, '..', '..', '..', 'package.json'), 'utf8'));
const pub = join(here, '..', 'public');
mkdirSync(pub, { recursive: true });
writeFileSync(
  join(pub, 'version.json'),
  JSON.stringify({ version: rootPkg.version, build: new Date().toISOString() }, null, 2) + '\n',
);
console.log(`version.json -> ${rootPkg.version} (${new Date().toISOString()})`);
