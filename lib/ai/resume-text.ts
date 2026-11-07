import "server-only";

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { fileExtension } from "@/lib/experts/documents";

/**
 * 이력서 원문 → AI 입력 (기획 2026-11-07, 08번).
 *  - PDF·이미지: 모델에 문서/이미지 블록으로 직접 (base64)
 *  - DOCX: mammoth로 텍스트 추출
 *  - HWP/HWPX: rhwp(@rhwp/core, Rust+WASM, MIT)로 텍스트 추출 — 기획 보정 2026-11-07
 *  - 그 외(doc/xls/ppt…): 미지원 — 안내 문구
 * 서버 전용. 원문은 메모리에서만 다루고 어디에도 저장하지 않는다.
 */

export type ResumeInput =
  | { kind: "pdf"; base64: string; sourceKind: "pdf" }
  | { kind: "image"; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; base64: string; sourceKind: "image" }
  | { kind: "text"; text: string; sourceKind: "docx" | "hwp" | "hwpx" }
  | { kind: "unsupported"; reason: string };

/** 요약에 넣을 텍스트 상한 — 이력서는 보통 1~3쪽. 너무 길면 앞부분만 */
const MAX_TEXT_CHARS = 40_000;

export async function resumeToAiInput(file: { bytes: Uint8Array; fileName: string; mimeType: string | null }): Promise<ResumeInput> {
  const ext = fileExtension(file.fileName) || mimeToExt(file.mimeType);
  switch (ext) {
    case "pdf":
      return { kind: "pdf", base64: Buffer.from(file.bytes).toString("base64"), sourceKind: "pdf" };
    case "jpg":
    case "jpeg":
      return { kind: "image", mediaType: "image/jpeg", base64: Buffer.from(file.bytes).toString("base64"), sourceKind: "image" };
    case "png":
      return { kind: "image", mediaType: "image/png", base64: Buffer.from(file.bytes).toString("base64"), sourceKind: "image" };
    case "gif":
      return { kind: "image", mediaType: "image/gif", base64: Buffer.from(file.bytes).toString("base64"), sourceKind: "image" };
    case "webp":
      return { kind: "image", mediaType: "image/webp", base64: Buffer.from(file.bytes).toString("base64"), sourceKind: "image" };
    case "docx": {
      const text = await docxToText(file.bytes);
      return text ? { kind: "text", text: clip(text), sourceKind: "docx" } : { kind: "unsupported", reason: "DOCX에서 글자를 읽어내지 못했습니다 (이미지로만 된 문서일 수 있음)." };
    }
    case "hwp":
    case "hwpx": {
      const text = await hwpToText(file.bytes);
      if (text === null) return { kind: "unsupported", reason: "한글 문서를 해석하지 못했습니다 (암호가 걸려 있거나 지원하지 않는 버전). PDF로 다시 올려 주세요." };
      return text ? { kind: "text", text: clip(text), sourceKind: ext } : { kind: "unsupported", reason: "한글 문서에서 글자를 읽어내지 못했습니다 (이미지로만 된 문서일 수 있음)." };
    }
    default:
      return { kind: "unsupported", reason: `${ext ? `.${ext}` : "이"} 형식은 아직 요약하지 못합니다. PDF·이미지·DOCX·HWP/HWPX만 지원합니다.` };
  }
}

function clip(text: string): string {
  const t = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > MAX_TEXT_CHARS ? `${t.slice(0, MAX_TEXT_CHARS)}\n…(이하 생략)` : t;
}

function mimeToExt(mime: string | null): string {
  switch (mime) {
    case "application/pdf": return "pdf";
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "docx";
    case "application/x-hwp": return "hwp";
    case "application/hwp+zip": return "hwpx";
    default: return "";
  }
}

async function docxToText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return result.value ?? "";
}

type RhwpModule = {
  initSync: (opts: { module: Uint8Array | WebAssembly.Module }) => unknown;
  HwpDocument: new (data: Uint8Array) => { getTextFileUnicode(): string; free?: () => void };
};

let rhwpReady: Promise<RhwpModule> | null = null;

/** rhwp WASM 1회 초기화 — 렌더링용 글자폭 측정 훅은 서버에서 쓰지 않으므로 단순 근사 */
function loadRhwp(): Promise<RhwpModule> {
  if (!rhwpReady) {
    rhwpReady = (async () => {
      const g = globalThis as { measureTextWidth?: (font: string, text: string) => number };
      if (!g.measureTextWidth) g.measureTextWidth = (_font, text) => text.length * 8;
      const mod = (await import("@rhwp/core")) as unknown as RhwpModule;
      // Node에서는 fetch(import.meta.url) 경로를 쓸 수 없다 — 패키지 폴더의 wasm을 직접 읽어 동기 초기화
      const req = createRequire(path.join(process.cwd(), "package.json"));
      const wasmPath = path.join(path.dirname(req.resolve("@rhwp/core")), "rhwp_bg.wasm");
      mod.initSync({ module: fs.readFileSync(wasmPath) });
      return mod;
    })().catch((e) => {
      rhwpReady = null;
      throw e;
    });
  }
  return rhwpReady;
}

/** HWP/HWPX → 본문 텍스트. 해석 실패는 null, 글자 없음은 "" */
async function hwpToText(bytes: Uint8Array): Promise<string | null> {
  try {
    const { HwpDocument } = await loadRhwp();
    const doc = new HwpDocument(bytes);
    try {
      // getTextFileUnicode()는 본문 전체를 JSON 문자열 리터럴로 돌려준다 ("...\n...")
      const raw = doc.getTextFileUnicode();
      let text: string;
      try {
        const parsed: unknown = JSON.parse(raw);
        text = typeof parsed === "string" ? parsed : raw;
      } catch {
        text = raw;
      }
      return text;
    } finally {
      doc.free?.();
    }
  } catch (error) {
    console.warn("[resume-text] hwp parse failed:", error instanceof Error ? error.message : error);
    return null;
  }
}
