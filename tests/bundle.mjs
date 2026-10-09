import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
const here = path.resolve(path.dirname(new URL(import.meta.url).pathname));

/** Gera o app (ou um módulo) com o Firebase falso. `pushUrl` simula a configuração das notificações. */
export async function bundle({ entry = path.resolve(here, '../js/main.js'), out = '/tmp/app.bundle.js', platform = 'browser', format = 'iife', pushUrl = '' } = {}) {
  await esbuild.build({
    entryPoints: [entry], bundle: true, format, platform, outfile: out, logLevel: 'error',
    plugins: [{ name: 'test-config', setup(b) {
      b.onResolve({ filter: /^https:\/\/www\.gstatic\.com\/firebasejs\// }, () => ({ path: path.join(here, 'fake-firebase.js') }));
      b.onLoad({ filter: /js[\\/]config\.js$/ }, (args) => ({
        contents: fs.readFileSync(args.path, 'utf8').replace("export const PUSH_URL = '';", `export const PUSH_URL = '${pushUrl}';`), loader: 'js'
      }));
    } }]
  });
  return out;
}
if (process.argv[1] && process.argv[1].endsWith('bundle.mjs')) bundle().then(o => console.log('ok', o));
