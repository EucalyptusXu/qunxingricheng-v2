/**
 * 群星日程 · 本地开发 /api 中间件（Vite 插件）
 *
 * 让 `npm run dev` 与 Vercel 生产环境完全一致：/api/chat、/api/quotes、
 * /api/image 由同一批 Edge 处理器（api/*.ts，Web 标准 Request/Response）
 * 直接服务，真实 API Key 只存在于服务端（.env.local 的 UPSTREAM_API_KEY，
 * 无 VITE_ 前缀 → 绝不打包进浏览器产物），本地开发零配置开箱即用。
 *
 * 工作原理：
 *  - configureServer 挂接 connect 中间件，拦截 /api/* 请求
 *  - 把 Node 的 req/res 适配成 Web 标准 Request，调用 api/ 下的同一个
 *    handler，再把 Response 写回 Node res（含 vercel.json 的两条 rewrite：
 *    /api/chat/completions → /api/chat，/api/image/images/generations → /api/image）
 *  - 用 Vite 的 loadEnv(mode, cwd, '') 加载 .env.local 等文件中的
 *    非 VITE_ 变量（UPSTREAM_API_KEY / UPSTREAM_BASE_URL / UPSTREAM_MODEL /
 *    IMAGE_* / BING_BASE / ALLOWED_ORIGINS），注入 process.env 供 handler 读取
 *    （process.env 已有的真实环境变量优先，不被 .env 文件覆盖）
 *
 * 仅作用于 vite dev / vite preview 的开发服务器；生产构建（vite build）
 * 不加载本插件的服务器逻辑，api/ 仍由 Vercel 平台托管。
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin } from 'vite';
import chatHandler from './api/chat';
import quotesHandler from './api/quotes';
import imageHandler from './api/image';

type EdgeHandler = (request: Request) => Promise<Response>;

/** 与 vercel.json rewrites 保持一致的路由映射 */
const ROUTES: Record<string, EdgeHandler> = {
  '/api/chat': chatHandler,
  '/api/chat/completions': chatHandler,
  '/api/quotes': quotesHandler,
  '/api/image': imageHandler,
  '/api/image/images/generations': imageHandler,
};

/** Node req → Web 标准 Request */
async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  const method = req.method ?? 'GET';
  let body: Buffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  }
  const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
  return new Request(url, {
    method,
    headers,
    // Buffer 是 Uint8Array 子类，属于合法的 BodyInit
    body: body ?? null,
  });
}

/** Web 标准 Response → Node res */
async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'content-length') return; // 由 Node 自行计算
    res.setHeader(key, value);
  });
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

export function devApi(): Plugin {
  return {
    name: 'qunxing-dev-api',
    apply: 'serve', // 仅 dev/preview 服务器，不参与 build
    configureServer(server) {
      // 加载 .env.local 等文件中的全部变量（含非 VITE_ 前缀的服务端变量），
      // 注入 process.env 供 api/ 处理器读取；真实环境变量优先
      const fileEnv = loadEnv(server.config.mode, server.config.root, '');
      for (const [key, value] of Object.entries(fileEnv)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }

      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const handler = ROUTES[path];
        if (!handler) return next();
        (async () => {
          const request = await toWebRequest(req);
          const response = await handler(request);
          await writeWebResponse(res, response);
        })().catch((err) => {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: { message: `dev-api middleware: ${String(err)}` } }));
        });
      });
    },
  };
}

export default devApi;
