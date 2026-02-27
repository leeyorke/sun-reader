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
            <CardDescription>
              自定义阅读器的默认设置
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              阅读设置功能正在开发中...
            </p>
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle>关于</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">
              <strong>Sun Reader</strong> v1.0.0
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
