/**
 * 人物画像生成服务（AI 生成主题的 Logo）
 *
 * 默认路径：pollinations.ai——免费、免 Key 的文生图服务，零配置即可用；
 *   seed 由人物名哈希派生，同一人物画像大致稳定。
 *   注意：pollinations 对携带 Origin 的 CORS fetch 要求 Turnstile token（403），
 *   而普通 <img> 加载不发送 Origin，可正常出图——因此本路径不走 fetch→blob，
 *   改用 Image 预检（onload/onerror + 超时）后直接把远程 URL 作为 theme.logo。
 * 可选路径：设置 VITE_IMAGE_BASE_URL 后改走服务端代理（api/image.ts 或
 *   Cloudflare Worker 的 /v1/images/generations），OpenAI images 兼容格式，
 *   真实密钥只在服务端；bearer 为无害占位（代理端不校验）。
 *
 * 失败容错：任何失败都抛 ImageGenError，由调用方（HeroSection 流水线）
 * 降级为 emoji/默认标识，绝不阻塞主题应用。
 */

import { hashString } from '@/themes';

const TIMEOUT_MS = 60_000;

export class ImageGenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageGenError';
  }
}

/* ------------------------------ 默认：pollinations.ai ------------------------------ */

/** 免费免 Key 文生图地址（GET 即图片） */
function pollinationsUrl(prompt: string, seed: number): string {
  return (
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=512&height=512&nologo=true&seed=${seed}`
  );
}

/**
 * 用 <img> 预检远程画像 URL：加载成功且非空即 resolve。
 * 不用 fetch 的原因见文件头（Origin → Turnstile 403）。
 */
function probeImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.src = '';
      reject(new ImageGenError(`画像生成超时（${TIMEOUT_MS / 1000} 秒）`));
    }, TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      if (img.naturalWidth > 0) resolve();
      else reject(new ImageGenError('画像服务返回的不是有效图片'));
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new ImageGenError('画像服务加载失败'));
    };
    img.src = url;
  });
}

/* --------------------------- 可选：代理 + Keyed 图像 API --------------------------- */

interface KeyedImageConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** VITE_IMAGE_BASE_URL 设置后启用代理路径（OpenAI images 兼容） */
function getKeyedConfig(): KeyedImageConfig | null {
  const baseUrl = (import.meta.env.VITE_IMAGE_BASE_URL as string | undefined)?.trim();
  if (!baseUrl) return null;
  // bearer 为无害占位（代理端不校验，真实 Key 在服务端）
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    model: (import.meta.env.VITE_IMAGE_MODEL as string | undefined) || 'dall-e-3',
    apiKey: 'proxy',
  };
}

async function generateViaKeyed(config: KeyedImageConfig, prompt: string): Promise<Blob> {
  const blob = await (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          prompt,
          size: '1024x1024',
          response_format: 'b64_json',
        }),
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new ImageGenError(`画像生成超时（${TIMEOUT_MS / 1000} 秒）`);
      }
      throw new ImageGenError(e instanceof Error ? e.message : '网络请求失败');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new ImageGenError(`画像服务返回 ${res.status}`);
    }
    const json = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new ImageGenError('画像服务响应缺少 b64_json');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'image/png' });
  })();
  return blob;
}

/* --------------------------------- 主入口 --------------------------------- */

/**
 * 生成人物画像，返回可用的 logo 地址：
 *  - 代理路径：fetch → blob → object URL（调用方负责在主题被替换时 revokeObjectURL）
 *  - 默认路径：pollinations 远程 URL（Image 预检通过后直接使用，无需回收）
 * 失败抛 ImageGenError——调用方必须容错降级，不得阻塞主题应用。
 */
export async function generatePortrait(prompt: string, personName: string): Promise<string> {
  const keyed = getKeyedConfig();
  if (keyed) {
    const blob = await generateViaKeyed(keyed, prompt);
    return URL.createObjectURL(blob);
  }
  // seed 由人物名派生：同一人物在同一部署上画像大致稳定
  const url = pollinationsUrl(prompt, hashString(personName) % 1_000_000);
  await probeImage(url);
  return url;
}
