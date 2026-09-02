import type { FetchLike } from "./auth.js";

const DEFAULT_MAX_IMAGE_BYTES = 65_536;
const DEFAULT_MAX_IMAGE_TOTAL_BYTES = 524_288;
const MIN_MAX_IMAGE_BYTES = 4_096;
const MAX_MAX_IMAGE_BYTES = 1_048_576;
const MAX_MAX_IMAGE_TOTAL_BYTES = 4_194_304;
const IMAGE_TIMEOUT_MS = 10_000;
const MAX_CACHE_ENTRIES = 128;
const THUMBNAIL_CONCURRENCY = 5;
const ALLOWED_HOSTS = new Set(["assets.caliverse.app", "cdn.caliverse.app"]);

export type ThumbnailFormat = "webp" | "jpeg";

interface AssetDescriptor {
  bucket: string;
  key: string;
}

export interface ThumbnailOptions {
  size: number;
  format: ThumbnailFormat;
  quality: number;
}

export interface Thumbnail {
  data: string;
  mimeType: "image/webp" | "image/jpeg" | "image/png" | "image/gif";
}

const thumbnailCache = new Map<string, Thumbnail>();

function configuredByteLimit(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(MIN_MAX_IMAGE_BYTES, Number(value)));
}

export const maxImageBytes = configuredByteLimit(process.env.CALIVERSE_MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES, MAX_MAX_IMAGE_BYTES);
export const maxImageTotalBytes = Math.max(
  maxImageBytes,
  configuredByteLimit(process.env.CALIVERSE_MAX_IMAGE_TOTAL_BYTES, DEFAULT_MAX_IMAGE_TOTAL_BYTES, MAX_MAX_IMAGE_TOTAL_BYTES)
);

export function imageByteLimitsForTest(imageValue?: string, totalValue?: string): { image: number; total: number } {
  const image = configuredByteLimit(imageValue, DEFAULT_MAX_IMAGE_BYTES, MAX_MAX_IMAGE_BYTES);
  return {
    image,
    total: Math.max(image, configuredByteLimit(totalValue, DEFAULT_MAX_IMAGE_TOTAL_BYTES, MAX_MAX_IMAGE_TOTAL_BYTES))
  };
}

function decodeAssetUrl(url: string): AssetDescriptor | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "assets.caliverse.app") {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(parsed.pathname.slice(1), "base64").toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    const descriptor = value as Record<string, unknown>;
    return typeof descriptor.bucket === "string" && typeof descriptor.key === "string"
      ? { bucket: descriptor.bucket, key: descriptor.key }
      : undefined;
  } catch {
    return undefined;
  }
}

export function buildThumbnailUrl(url: string, options: ThumbnailOptions): string {
  const asset = decodeAssetUrl(url);
  if (asset === undefined) {
    return url;
  }
  const edits: Record<string, unknown> = {
    resize: { width: options.size, height: options.size, fit: "cover" }
  };
  if (options.format === "webp") {
    edits.webp = { quality: options.quality };
  } else if (options.format === "jpeg") {
    edits.flatten = { background: { r: 255, g: 255, b: 255 } };
    edits.jpeg = { quality: options.quality };
  }
  return `https://assets.caliverse.app/${Buffer.from(JSON.stringify({ ...asset, edits }), "utf8").toString("base64")}`;
}

export function sniffImageMime(data: Buffer): Thumbnail["mimeType"] | undefined {
  if (data.length >= 12 && data.subarray(0, 4).equals(Buffer.from("RIFF")) && data.subarray(8, 12).equals(Buffer.from("WEBP"))) return "image/webp";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 3 && data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (data.length >= 6 && (data.subarray(0, 6).equals(Buffer.from("GIF87a")) || data.subarray(0, 6).equals(Buffer.from("GIF89a")))) return "image/gif";
  return undefined;
}

function cache(url: string, thumbnail: Thumbnail): Thumbnail {
  if (thumbnailCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = thumbnailCache.keys().next().value;
    if (oldest !== undefined) thumbnailCache.delete(oldest);
  }
  thumbnailCache.set(url, thumbnail);
  return thumbnail;
}

function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Exercise image URL is invalid.");
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error("Exercise image URL is not an allowed HTTPS Caliverse asset URL.");
  }
}

export async function fetchThumbnail(url: string, fetchImpl: FetchLike = fetch): Promise<Thumbnail> {
  const cached = thumbnailCache.get(url);
  if (cached !== undefined) return cached;
  validateUrl(url);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Exercise image request failed with HTTP ${response.status}.`);
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxImageBytes) {
    throw new Error(`Exercise image exceeds the ${maxImageBytes}-byte limit.`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > maxImageBytes) {
    throw new Error(`Exercise image exceeds the ${maxImageBytes}-byte limit.`);
  }
  const mimeType = sniffImageMime(data);
  if (mimeType === undefined) {
    throw new Error("Exercise image response was not a supported image.");
  }
  return cache(url, { data: data.toString("base64"), mimeType });
}

export async function fetchThumbnails(urls: string[], fetchImpl: FetchLike): Promise<Map<string, Thumbnail | Error>> {
  const uniqueUrls = [...new Set(urls)];
  const results = new Map<string, Thumbnail | Error>();
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < uniqueUrls.length) {
      const url = uniqueUrls[nextIndex++];
      if (url === undefined) return;
      try {
        results.set(url, await fetchThumbnail(url, fetchImpl));
      } catch (error) {
        results.set(url, error instanceof Error ? error : new Error("Unknown image error."));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(THUMBNAIL_CONCURRENCY, uniqueUrls.length) }, () => worker()));
  return results;
}

export function clearThumbnailCacheForTest(): void {
  thumbnailCache.clear();
}
