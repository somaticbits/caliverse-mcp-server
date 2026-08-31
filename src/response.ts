import { z } from "zod";

const DEFAULT_MAX_RESULT_BYTES = 65_536;
const MIN_MAX_RESULT_BYTES = 4_096;
const MAX_MAX_RESULT_BYTES = 4_194_304;
const PREVIEW_BYTES = 2_048;

function configuredMaxResultBytes(value = process.env.CALIVERSE_MAX_RESULT_BYTES): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    return DEFAULT_MAX_RESULT_BYTES;
  }
  return Math.min(MAX_MAX_RESULT_BYTES, Math.max(MIN_MAX_RESULT_BYTES, Number(value)));
}

export const maxResultBytes = configuredMaxResultBytes();

export const pageSchema = {
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().max(200).default(50)
};

export const fieldsSchema = z.array(z.string().trim().min(1).max(100)).min(1).max(50).optional();

function preview(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  return bytes.subarray(0, PREVIEW_BYTES).toString("utf8");
}

export function textResult(value: unknown) {
  const text = JSON.stringify(value) ?? "null";
  const bytes = Buffer.byteLength(text, "utf8");
  const safeText = bytes <= maxResultBytes
    ? text
    : JSON.stringify({
      error: "result_too_large",
      bytes,
      limit: maxResultBytes,
      hint: "Retry with detail: \"summary\", selected fields, a narrower query, or a smaller limit.",
      preview: preview(text)
    });
  return { content: [{ type: "text" as const, text: safeText }] };
}

export function pagedResult(items: unknown[], offset: number, limit: number, detail: string, omitted: string[] = []) {
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length < items.length ? offset + page.length : null;
  return {
    total: items.length,
    offset,
    limit,
    returned: page.length,
    nextOffset,
    detail,
    ...(omitted.length === 0 ? {} : { omitted }),
    items: page
  };
}

export function resultByteLimitForTest(value: string | undefined): number {
  return configuredMaxResultBytes(value);
}
