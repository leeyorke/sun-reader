import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/toast';
import { Layout } from '@/components/layout/Layout';
import { LibraryPage } from '@/pages/LibraryPage';
import { ReaderPage } from '@/pages/ReaderPage';
import { SettingsPage } from '@/pages/SettingsPage';

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="sun-reader-theme">
      <ErrorBoundary>
        <Router>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<LibraryPage />} />
              {/* /reader 缺少书籍 ID：回书库 */}
              <Route path="reader" element={<Navigate to="/" replace />} />
              <Route path="reader/:bookId" element={<ReaderPage />} />
              <Route path="settings" element={<SettingsPage />} />
              {/* 兜底：未知路径回书库 */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          <Toaster />
        </Router>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
