/**
 * 阅读偏好（字号/行高/字体）—— localStorage 读写
 *
 * ReaderPage 与 SettingsPage 共用，避免两边各自序列化互相覆盖字段。
 * 存储键：sun-reader-settings
 */

import { FONT_FAMILIES, MAX_FONT_SIZE, MIN_FONT_SIZE } from './constants';

const PREFS_KEY = 'sun-reader-settings';

export interface ReaderPrefs {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  /** FONT_FAMILIES 的 value 键（'serif' | 'sans' | 'mono'） */
  fontFamily: string;
}

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  fontSize: 21,
  lineHeight: 1.9,
  letterSpacing: 0,
  fontFamily: 'serif',
};

export function clampFontSize(size: number): number {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size));
}

export function loadReaderPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        fontSize: clampFontSize(Number(p.fontSize) || DEFAULT_READER_PREFS.fontSize),
        lineHeight: Number(p.lineHeight) || DEFAULT_READER_PREFS.lineHeight,
        letterSpacing: Number(p.letterSpacing) || DEFAULT_READER_PREFS.letterSpacing,
        // fontFamily 既可以是 FONT_FAMILIES 的键（衬线/无衬线/等宽），
        // 也可以是系统字体的 family 名（FontPicker 选择）；读取时归一化
        // （剥离旧版本存档拼进的 " Regular" 样式词，CSS 只认家族名）
        fontFamily: normalizeSystemFontName(
          typeof p.fontFamily === 'string' && p.fontFamily
            ? p.fontFamily
            : DEFAULT_READER_PREFS.fontFamily
        ),
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_READER_PREFS };
}

export function saveReaderPrefs(prefs: ReaderPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/** 系统字体名的兼容性归一化：注册表值名可能把样式词拼在家族名后
 *  （如旧版本存档的 "霞鹜文楷等宽 屏幕阅读版 Regular"），而 CSS 按家族名匹配 */
function normalizeSystemFontName(value: string): string {
  return value.replace(/[\s_-]+Regular$/i, '').trim();
}

/** 单个家族名 → 合法 CSS 值：一律加引号（多词/含数字的名字不加引号会让整条声明失效） */
export function quoteFontFamily(name: string): string {
  return `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// ---------- 字体可用性探测 ----------
// 不能用 document.fonts.check：按规范它只回答「FontFaceSet 里有没有未加载的匹配项」，
// 系统字体不在 FontFaceSet 中，于是任何名字（含 'Zzz No Such Font'）都返回 true，
// 实测在 Electron/Chromium 上恒为 true，完全无法判断系统字体是否存在。
// 这里改用 canvas 宽度法：把候选名放在三种 generic 之前，若渲染宽度与 generic
// 基线一致，说明候选名没被命中（回退到了 generic）。
const PROBE_TEXT = '汉字测试永Abcmw0';
const PROBE_BASES = ['serif', 'sans-serif', 'monospace'];
const probeCache = new Map<string, boolean>();
let probeCtx: CanvasRenderingContext2D | null | undefined;

function getProbeCtx(): CanvasRenderingContext2D | null {
  if (probeCtx !== undefined) return probeCtx;
  try {
    probeCtx = document.createElement('canvas').getContext('2d');
  } catch {
    probeCtx = null;
  }
  return probeCtx;
}

/**
 * 该字体名当前能否被 Chromium 真正命中（generic 键恒可用）。
 * 用于失效名自愈与设置页提示；渲染时**不据此丢弃**用户选择（见 resolveFontFamily）。
 */
export function isFontFamilyAvailable(value: string): boolean {
  if (!value || FONT_FAMILIES.some((f) => f.value === value)) return true;
  const name = normalizeSystemFontName(value);
  if (!name) return true;
  const cached = probeCache.get(name);
  if (cached !== undefined) return cached;
  const ctx = getProbeCtx();
  if (!ctx) return true; // 无 canvas（非浏览器环境）时不做判断
  const quoted = quoteFontFamily(name);
  let hit = false;
  for (const base of PROBE_BASES) {
    ctx.font = `48px ${base}`;
    const baseWidth = ctx.measureText(PROBE_TEXT).width;
    ctx.font = `48px ${quoted}, ${base}`;
    if (Math.abs(ctx.measureText(PROBE_TEXT).width - baseWidth) > 0.5) {
      hit = true;
      break;
    }
  }
  probeCache.set(name, hit);
  return hit;
}

/**
 * 偏好值 → CSS font-family 串：
 * - FONT_FAMILIES 的键（serif/sans/mono）→ 对应字体栈；
 * - 其他非空值视为系统字体 family 名 → 引号包裹后置于最前 + 衬线栈兜底（缺字/未命中回退）；
 * - 空值 → 默认衬线栈。
 * 命不中的名字也保留（宽度探测存在误判空间，丢掉用户选择的代价更大），
 * 反正 CSS 会自然回退到后面的兜底栈。
 */
export function resolveFontFamily(value: string): string {
  const generic = FONT_FAMILIES.find((f) => f.value === value);
  if (generic) return generic.family;
  const name = normalizeSystemFontName(value);
  if (!name) return FONT_FAMILIES[0].family;
  return `${quoteFontFamily(name)}, ${FONT_FAMILIES[0].family}`;
}

/**
 * 失效字体名自愈：存档名命中不了任何字体时，借助主进程的字体名单与别名组
 * （同一字体文件的中英文/typographic 家族名）找一个能命中的替代名。
 * 找不到返回 null（渲染时按衬线兜底，用户可在设置页重选）。
 */
export async function healStoredFontFamily(current: string): Promise<string | null> {
  const api = window.electronAPI;
  if (!api?.system?.listFonts) return null;
  try {
    const res = await api.system.listFonts();
    if (!res?.success) return null;
    const fonts: string[] = Array.isArray(res.fonts) ? res.fonts : [];
    const aliases: Record<string, string[]> = res.aliases ?? {};
    const lower = normalizeSystemFontName(current).toLowerCase();
    if (!lower) return null;

    // 同一字体文件的别名组（如存了中文名而实际只有英文名能命中，反之亦然）
    for (const [name, variants] of Object.entries(aliases)) {
      const group = [name, ...(variants ?? [])];
      if (!group.some((n) => n.toLowerCase() === lower)) continue;
      const hit = group.find((n) => isFontFamilyAvailable(n) && n.toLowerCase() !== lower);
      if (hit) return hit;
    }
    // 名单内就近匹配（大小写差异 / 子串包含，如存档残留的样式词）
    const candidates = fonts.filter(
      (f) =>
        f.toLowerCase() !== lower &&
        (f.toLowerCase().includes(lower) || lower.includes(f.toLowerCase()))
    );
    const hit = candidates.find((f) => isFontFamilyAvailable(f));
    if (hit) return hit;
  } catch {
    /* ignore */
  }
  return null;
}
