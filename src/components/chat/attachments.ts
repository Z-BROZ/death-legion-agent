'use client';

/**
 * Client-side attachment processing for DL AGENT.
 * Images → compressed JPEG data URLs (sent to vision).
 * Videos → ONE captured frame as an image + metadata (no video upload).
 * Text-ish files → inline content for the agent context.
 */

export type AttachmentKind = 'image' | 'video' | 'text' | 'other';

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  size: number;
  /** image: compressed data URL · video: captured frame data URL */
  dataUrl?: string;
  /** video duration in seconds */
  durationSec?: number;
  /** text file contents */
  text?: string;
  error?: string;
}

const TEXT_EXTS = [
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'yml', 'yaml',
  'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'kt', 'c', 'cpp', 'h', 'cs', 'go',
  'rb', 'rs', 'php', 'sh', 'bat', 'ps1', 'sql', 'html', 'htm', 'css', 'scss',
  'ini', 'toml', 'env', 'gitignore',
];

const MAX_TEXT_BYTES = 120_000; // 120KB of text into context

export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fileKind(file: File): AttachmentKind {
  const name = file.name.toLowerCase();
  const ext = name.split('.').pop() ?? '';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('text/') || file.type === 'application/json') return 'text';
  if (TEXT_EXTS.includes(ext)) return 'text';
  return 'other';
}

/** Downscale + compress an image file to a JPEG data URL (max 1280px, ~q0.85). */
export function compressImage(file: File, maxDim = 1280, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas unavailable');
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    img.src = url;
  });
}

/** Capture one representative frame from a video (client-side, no upload). */
export function captureVideoFrame(
  file: File
): Promise<{ thumb: string; durationSec: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    const cleanup = () => URL.revokeObjectURL(url);
    const fail = (msg: string) => {
      cleanup();
      reject(new Error(msg));
    };

    const timer = setTimeout(() => fail('video load timeout'), 15000);

    video.onloadedmetadata = () => {
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      video.currentTime = dur > 2 ? Math.min(1.5, dur / 2) : 0;
    };

    video.onseeked = () => {
      try {
        const scale = Math.min(1, 960 / Math.max(video.videoWidth || 960, 1));
        const w = Math.max(1, Math.round((video.videoWidth || 640) * scale));
        const h = Math.max(1, Math.round((video.videoHeight || 360) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas unavailable');
        ctx.drawImage(video, 0, 0, w, h);
        const thumb = canvas.toDataURL('image/jpeg', 0.8);
        const durationSec = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
        clearTimeout(timer);
        cleanup();
        resolve({ thumb, durationSec });
      } catch (e) {
        clearTimeout(timer);
        fail((e as Error).message);
      }
    };

    video.onerror = () => {
      clearTimeout(timer);
      fail('video decode failed');
    };

    video.src = url;
  });
}

/** Read a small text file's contents. */
export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_TEXT_BYTES) {
      reject(new Error(`text file too large (max ${humanSize(MAX_TEXT_BYTES)})`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('file read failed'));
    reader.readAsText(file);
  });
}

/** Process a picked file into an Attachment (never throws). */
export async function processFile(file: File): Promise<Attachment> {
  const kind = fileKind(file);
  const base: Attachment = { id: uid(), kind, name: file.name, size: file.size };

  if (kind === 'image') {
    if (file.size > 20_000_000) return { ...base, error: 'image too large (max 20MB)' };
    try {
      return { ...base, dataUrl: await compressImage(file) };
    } catch {
      return { ...base, error: 'could not process image' };
    }
  }

  if (kind === 'video') {
    if (file.size > 200_000_000) return { ...base, error: 'video too large (max 200MB)' };
    try {
      const { thumb, durationSec } = await captureVideoFrame(file);
      return { ...base, dataUrl: thumb, durationSec };
    } catch {
      // still send metadata without a frame
      return { ...base, error: 'frame capture failed — sending name only' };
    }
  }

  if (kind === 'text') {
    try {
      return { ...base, text: await readTextFile(file) };
    } catch (e) {
      return { ...base, error: (e as Error).message };
    }
  }

  return {
    ...base,
    error: `unsupported file type (.${file.name.split('.').pop() ?? '?'} — try image, video, or text/code file)`,
  };
}
