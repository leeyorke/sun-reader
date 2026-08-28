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
  /** FONT_FAMILIES 的 value 键（'serif' | 'sans' | 'mono'） */
  fontFamily: string;
}

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  fontSize: 21,
  lineHeight: 1.9,
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

/**
 * 该字体名当前是否真能被 Chromium 命中（generic 键恒可用）。
 * 旧版本从注册表值名存下的名字可能是乱码或不存在的家族名，
 * CSS 静默回退成微软雅黑很难排查；这里用 document.fonts.check 显式验证。
 */
export function isFontFamilyAvailable(value: string): boolean {
  if (!value || FONT_FAMILIES.some((f) => f.value === value)) return true;
  try {
    if (typeof document === 'undefined' || !document.fonts?.check) return true;
    return document.fonts.check(`16px "${value.replace(/["'\\]/g, '')}"`);
  } catch {
    return true;
  }
}

/**
 * 偏好值 → CSS font-family 串：
 * - FONT_FAMILIES 的键（serif/sans/mono）→ 对应字体栈；
 * - 其他非空值视为系统字体 family 名 → '字体名' + 衬线栈兜底（缺字回退）；
 * - 空/未知/无法命中的名字 → 默认衬线栈（不静默回退成系统黑体）。
 */
export function resolveFontFamily(value: string): string {
  const generic = FONT_FAMILIES.find((f) => f.value === value);
  if (generic) return generic.family;
  if (!value) return FONT_FAMILIES[0].family;
  if (!isFontFamilyAvailable(value)) return FONT_FAMILIES[0].family;
  const safe = normalizeSystemFontName(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
  return `'${safe}', ${FONT_FAMILIES[0].family}`;
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
