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

  const [fontSize, setFontSize] = React.useState<number>(() => {
    try {
      const raw = localStorage.getItem('sun-reader-settings');
      return raw ? JSON.parse(raw).fontSize ?? 21 : 21;
    } catch {
      return 21;
    }
  });

  const changeFontSize = (delta: number) => {
    setFontSize((s) => {
      const next = Math.max(14, Math.min(32, s + delta));
      try {
        localStorage.setItem(
          'sun-reader-settings',
          JSON.stringify({ fontSize: next })
        );
      } catch {
        /* ignore */
      }
      return next;
    });
  };

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
                  <SelectItem value="sepia">Sepia</SelectItem>
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
                  disabled={fontSize <= 14}
                >
                  -
                </Button>
                <span className="w-12 text-center text-sm tabular-nums">{fontSize}px</span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => changeFontSize(2)}
                  disabled={fontSize >= 32}
                >
                  +
                </Button>
                <span className="text-xs text-muted-foreground">范围 14 - 32</span>
              </div>
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
