import React from 'react';
import { useTheme } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FontPicker } from '@/components/font-picker';
import {
  clampFontSize,
  healStoredFontFamily,
  isFontFamilyAvailable,
  loadReaderPrefs,
  resolveFontFamily,
  saveReaderPrefs,
  type ReaderPrefs,
} from '@/lib/prefs';

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [appVersion, setAppVersion] = React.useState('');

  // 版本号以 package.json 为唯一来源，经主进程 get-config 下发
  React.useEffect(() => {
    window.electronAPI?.app
      .getConfig()
      .then((cfg) => setAppVersion(cfg.version))
      .catch(() => {});
  }, []);

  // 阅读偏好：与阅读页共用 lib/prefs（整对象保存，不互相覆盖字段）
  const [prefs, setPrefsState] = React.useState<ReaderPrefs>(loadReaderPrefs);
  const updatePrefs = (patch: Partial<ReaderPrefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      saveReaderPrefs(next);
      return next;
    });

  // 字体名失效自愈：旧存档名命中不了字体时换成能命中的别名（与阅读页一致）
  React.useEffect(() => {
    const name = prefs.fontFamily;
    if (isFontFamilyAvailable(name)) return;
    let alive = true;
    healStoredFontFamily(name).then((fixed) => {
      if (!alive || !fixed) return;
      setPrefsState((p) => {
        if (p.fontFamily !== name) return p;
        const next = { ...p, fontFamily: fixed };
        saveReaderPrefs(next);
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [prefs.fontFamily]);

  const changeFontSize = (delta: number) =>
    updatePrefs({ fontSize: clampFontSize(prefs.fontSize + delta) });

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">设置</h1>

      <div className="space-y-6">
        {/* Theme Settings */}
        <Card>
          <CardHeader>
            <CardTitle>外观</CardTitle>
            <CardDescription>
              自定义应用的外观主题
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>主题</Label>
              <Select value={theme} onValueChange={setTheme}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="选择主题" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">浅色</SelectItem>
                  <SelectItem value="dark">深色</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Reading Settings */}
        <Card>
          <CardHeader>
            <CardTitle>阅读设置</CardTitle>
            <CardDescription>自定义阅读器的默认排版</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>正文字号</Label>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => changeFontSize(-2)}
                  disabled={prefs.fontSize <= 14}
                >
                  -
                </Button>
                <span className="w-12 text-center text-sm tabular-nums">{prefs.fontSize}px</span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => changeFontSize(2)}
                  disabled={prefs.fontSize >= 32}
                >
                  +
                </Button>
                <span className="text-xs text-muted-foreground">范围 14 - 32</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>正文字体</Label>
              <FontPicker value={prefs.fontFamily} onChange={(v) => updatePrefs({ fontFamily: v })} />
              <p
                className="text-xs text-muted-foreground border border-border rounded-md px-3 py-2"
                style={{ fontFamily: resolveFontFamily(prefs.fontFamily) }}
              >
                预览：永和九年，岁在癸丑。Sun Reader 0123456789
              </p>
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle>关于</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">
              <strong>Sun Reader</strong>
              {appVersion ? ` v${appVersion}` : ''}
            </p>
            <p className="text-sm text-muted-foreground">
              一款简洁优雅的桌面端电子书阅读器
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
