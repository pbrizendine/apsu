import { soloCreate } from '../worker/solo-create.mjs';
import { soloImagine } from '../worker/solo-imagine.mjs';
// Local-only server for the static app plus its guest BYOK relay. No Supabase mutations.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { soloChat } from '../worker/solo-chat.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.APSU_SOLO_PORT || 8787),
  origin = `http://127.0.0.1:${port}`;
const counters = new Map();
const env = {
  IMAGINE_LIMIT: {
    async limit({ key }) {
      const now = Math.floor(Date.now() / 60000),
        previous = counters.get('image:' + key);
      counters.set('image:' + key, { minute: now });
      return { success: previous?.minute !== now };
    },
  },
  SOLO_LIMIT: {
    async limit({ key }) {
      const now = Math.floor(Date.now() / 60000);
      const old = counters.get(key);
      const next =
        old?.minute === now ? { minute: now, count: old.count + 1 } : { minute: now, count: 1 };
      counters.set(key, next);

      return { success: next.count <= 12 };
    },
  },
};
setInterval(() => {
  const now = Math.floor(Date.now() / 60000);

  for (const [key, v] of counters) if (v.minute < now) counters.delete(key);
}, 60000).unref();
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);

      if (['/api/solo-chat', '/api/solo-imagine', '/api/solo-create'].includes(url.pathname)) {
        const chunks = [];
        let size = 0;

        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1000000) {
            res.writeHead(413);
            res.end('Request too large');
            return;
          }

          chunks.push(chunk);
        }

        const headers = new Headers();

        for (const [k, v] of Object.entries(req.headers))
          if (v) headers.set(k, Array.isArray(v) ? v.join(',') : v);

        headers.set('CF-Connecting-IP', '127.0.0.1');
        const request = new Request(url, {
          method: req.method,
          headers,
          ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
        });
        const response = await (
          url.pathname === '/api/solo-create'
            ? soloCreate
            : url.pathname === '/api/solo-chat'
              ? soloChat
              : soloImagine
        )(request, env);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));

        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405);
        res.end();
        return;
      }

      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      // Serve the same public surface as build-site, never SQL, credentials, or backups.

      if (
        !(
          /^\/[\w-]+\.html$/.test(pathname) ||
          /^\/(js|css|fonts)\/[\w.-]+\.(js|css|woff2|txt)$/.test(pathname) ||
          /^\/assets\/world-(deco|fantasy|cyberpunk)\.svg$/.test(pathname)
        )
      ) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const file = resolve(root, '.' + pathname);

      if (!file.startsWith(root + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }

      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': types[extname(file)] || 'text/plain',
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  })
  .listen(port, '127.0.0.1', () =>
    console.log(`APSU solo preview: ${origin}/launchpad.html#single-player`),
  );
