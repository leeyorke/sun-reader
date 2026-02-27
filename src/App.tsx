import React from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { Layout } from '@/components/layout/Layout';
import { LibraryPage } from '@/pages/LibraryPage';
import { ReaderPage } from '@/pages/ReaderPage';
import { SettingsPage } from '@/pages/SettingsPage';

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="sun-reader-theme">
      <Router>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<LibraryPage />} />
            <Route path="reader/:bookId" element={<ReaderPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </Router>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
