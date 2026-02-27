/**
 * Sun Reader - 电子书阅读器应用程序
 * 包含主题切换、字体大小调整、阅读进度等功能
 */

(function() {
    'use strict';

    // ========================================
    // 配置和状态
    // ========================================
    const CONFIG = {
        storageKey: 'sun-reader-settings',
        defaultSettings: {
            theme: 'light',
            fontSize: 21,
            readingProgress: {
                '黄金时代': { current: 67, chapter: '第一章' }
            }
        }
    };

    // 应用状态
    let state = {
        theme: 'light',
        fontSize: 21,
        isReadingMode: false
    };

    // ========================================
    // 工具函数
    // ========================================
    const utils = {
        /**
         * 节流函数
         * @param {Function} func - 要执行的函数
         * @param {number} wait - 等待时间（毫秒）
         * @returns {Function}
         */
        throttle(func, wait) {
            let timeout = null;
            let previous = 0;
            return function(...args) {
                const now = Date.now();
                const remaining = wait - (now - previous);
                if (remaining <= 0 || remaining > wait) {
                    if (timeout) {
                        clearTimeout(timeout);
                        timeout = null;
                    }
                    previous = now;
                    func.apply(this, args);
                } else if (!timeout) {
                    timeout = setTimeout(() => {
                        previous = Date.now();
                        timeout = null;
                        func.apply(this, args);
                    }, remaining);
                }
            };
        },

        /**
         * 从 localStorage 读取设置
         * @returns {Object}
         */
        loadSettings() {
            try {
                const saved = localStorage.getItem(CONFIG.storageKey);
                return saved ? JSON.parse(saved) : CONFIG.defaultSettings;
            } catch (e) {
                console.warn('无法读取设置:', e);
                return CONFIG.defaultSettings;
            }
        },

        /**
         * 保存设置到 localStorage
         * @param {Object} settings
         */
        saveSettings(settings) {
            try {
                localStorage.setItem(CONFIG.storageKey, JSON.stringify(settings));
            } catch (e) {
                console.warn('无法保存设置:', e);
            }
        },

        /**
         * 设置 CSS 变量
         * @param {string} name
         * @param {string} value
         */
        setCSSVariable(name, value) {
            document.documentElement.style.setProperty(name, value);
        }
    };

    // ========================================
    // 主题管理
    // ========================================
    const themeManager = {
        /**
         * 初始化主题
         */
        init() {
            const settings = utils.loadSettings();
            this.setTheme(settings.theme);
            this.bindEvents();
        },

        /**
         * 设置主题
         * @param {string} themeName - 'light' | 'dark' | 'sepia'
         */
        setTheme(themeName) {
            state.theme = themeName;
            document.body.setAttribute('data-theme', themeName);

            // 更新主题按钮状态
            const themeBtn = document.getElementById('themeBtn');
            if (themeBtn) {
                const icon = themeBtn.querySelector('svg');
                if (icon) {
                    // 更新图标根据当前主题
                    if (themeName === 'dark') {
                        icon.innerHTML = `<circle cx="9" cy="9" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M9 1V3M9 15V17M1 9H3M15 9H17M3.343 3.343L4.757 4.757M13.243 13.243L14.657 14.657M3.343 14.657L4.757 13.243M13.243 4.757L14.657 3.343" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`;
                    } else {
                        icon.innerHTML = `<circle cx="9" cy="9" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M9 1V3M9 15V17M1 9H3M15 9H17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`;
                    }
                }
            }

            // 保存设置
            const settings = utils.loadSettings();
            settings.theme = themeName;
            utils.saveSettings(settings);
        },

        /**
         * 切换主题
         */
        toggleTheme() {
            const themes = ['light', 'dark', 'sepia'];
            const currentIndex = themes.indexOf(state.theme);
            const nextIndex = (currentIndex + 1) % themes.length;
            this.setTheme(themes[nextIndex]);
        },

        /**
         * 绑定事件
         */
        bindEvents() {
            const themeBtn = document.getElementById('themeBtn');
            if (themeBtn) {
                themeBtn.addEventListener('click', () => this.toggleTheme());
            }
        }
    };

    // ========================================
    // 字体大小管理
    // ========================================
    const fontSizeManager = {
        minSize: 14,
        maxSize: 32,
        step: 2,

        /**
         * 初始化
         */
        init() {
            const settings = utils.loadSettings();
            this.setFontSize(settings.fontSize || 21);
            this.bindEvents();
        },

        /**
         * 设置字体大小
         * @param {number} size
         */
        setFontSize(size) {
            // 限制范围
            size = Math.max(this.minSize, Math.min(this.maxSize, size));
            state.fontSize = size;

            // 应用字体大小
            const readingText = document.querySelector('.reading-text, .immersive-text');
            if (readingText) {
                readingText.style.fontSize = size + 'px';
            }

            // 保存设置
            const settings = utils.loadSettings();
            settings.fontSize = size;
            utils.saveSettings(settings);
        },

        /**
         * 增加字体大小
         */
        increase() {
            this.setFontSize(state.fontSize + this.step);
        },

        /**
         * 减小字体大小
         */
        decrease() {
            this.setFontSize(state.fontSize - this.step);
        },

        /**
         * 绑定事件
         */
        bindEvents() {
            const fontSizeBtn = document.getElementById('fontSizeBtn');
            if (fontSizeBtn) {
                fontSizeBtn.addEventListener('click', () => this.increase());
                // 右键减小字体
                fontSizeBtn.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.decrease();
                });
            }
        }
    };

    // ========================================
    // 阅读进度管理
    // ========================================
    const progressManager = {
        /**
         * 初始化
         */
        init() {
            this.loadProgress();
            this.bindEvents();
        },

        /**
         * 加载阅读进度
         */
        loadProgress() {
            const settings = utils.loadSettings();
            const bookProgress = settings.readingProgress || {};
            const currentBook = bookProgress['黄金时代'] || { current: 67, chapter: '第一章' };

            // 更新进度条
            this.updateProgressUI(currentBook.current);
        },

        /**
         * 更新进度显示
         * @param {number} percent
         */
        updateProgressUI(percent) {
            const progressBars = document.querySelectorAll('.progress-fill');
            progressBars.forEach(bar => {
                bar.style.width = percent + '%';
            });

            // 更新文本
            const progressTexts = document.querySelectorAll('.progress-text');
            progressTexts.forEach(text => {
                if (text.textContent.includes('%')) {
                    text.textContent = percent + '%';
                }
            });
        },

        /**
         * 保存进度
         * @param {number} percent
         * @param {string} chapter
         */
        saveProgress(percent, chapter) {
            const settings = utils.loadSettings();
            settings.readingProgress = settings.readingProgress || {};
            settings.readingProgress['黄金时代'] = {
                current: percent,
                chapter: chapter,
                timestamp: Date.now()
            };
            utils.saveSettings(settings);
        },

        /**
         * 绑定事件
         */
        bindEvents() {
            // 监听滚动更新进度
            const readingText = document.querySelector('.reading-text, .immersive-text');
            if (readingText) {
                const updateProgress = utils.throttle(() => {
                    const scrollTop = readingText.scrollTop;
                    const scrollHeight = readingText.scrollHeight - readingText.clientHeight;
                    const percent = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0;
                    this.updateProgressUI(percent);
                }, 200);

                readingText.addEventListener('scroll', updateProgress);
            }
        }
    };

    // ========================================
    // 导航管理
    // ========================================
    const navigationManager = {
        /**
         * 初始化
         */
        init() {
            this.bindEvents();
        },

        /**
         * 绑定事件
         */
        bindEvents() {
            // 上一页/下一页按钮
            const prevBtn = document.getElementById('prevPage');
            const nextBtn = document.getElementById('nextPage');

            if (prevBtn) {
                prevBtn.addEventListener('click', () => this.goToPrevPage());
            }

            if (nextBtn) {
                nextBtn.addEventListener('click', () => this.goToNextPage());
            }

            // 点击区域翻页（沉浸模式）
            const prevZone = document.getElementById('prevZone');
            const nextZone = document.getElementById('nextZone');

            if (prevZone) {
                prevZone.addEventListener('click', () => this.goToPrevPage());
            }

            if (nextZone) {
                nextZone.addEventListener('click', () => this.goToNextPage());
            }

            // 键盘导航
            document.addEventListener('keydown', (e) => {
                // 左箭头或 PageUp - 上一页
                if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
                    e.preventDefault();
                    this.goToPrevPage();
                }
                // 右箭头或 PageDown/空格 - 下一页
                else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
                    e.preventDefault();
                    this.goToNextPage();
                }
                // Esc - 退出沉浸模式
                else if (e.key === 'Escape') {
                    this.exitImmersiveMode();
                }
            });
        },

        /**
         * 上一页
         */
        goToPrevPage() {
            const readingText = document.querySelector('.reading-text, .immersive-text');
            if (readingText) {
                const pageHeight = readingText.clientHeight * 0.9;
                readingText.scrollBy({ top: -pageHeight, behavior: 'smooth' });
            }
        },

        /**
         * 下一页
         */
        goToNextPage() {
            const readingText = document.querySelector('.reading-text, .immersive-text');
            if (readingText) {
                const pageHeight = readingText.clientHeight * 0.9;
                readingText.scrollBy({ top: pageHeight, behavior: 'smooth' });
            }
        },

        /**
         * 退出沉浸模式
         */
        exitImmersiveMode() {
            if (document.body.getAttribute('data-view') === 'immersive') {
                window.location.href = 'read.html';
            }
        }
    };

    // ========================================
    // 批注管理
    // ========================================
    const annotationManager = {
        /**
         * 初始化
         */
        init() {
            this.bindEvents();
        },

        /**
         * 绑定事件
         */
        bindEvents() {
            // 批注标记点击事件
            const markers = document.querySelectorAll('.annotation-marker');
            markers.forEach(marker => {
                marker.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const note = marker.getAttribute('data-note');
                    if (note) {
                        this.showAnnotationPopup(marker, note);
                    }
                });
            });

            // 点击其他地方关闭弹窗
            document.addEventListener('click', () => {
                this.hideAnnotationPopup();
            });
        },

        /**
         * 显示批注弹窗
         * @param {HTMLElement} marker
         * @param {string} note
         */
        showAnnotationPopup(marker, note) {
            const popup = document.getElementById('annotationPopup');
            if (!popup) return;

            const rect = marker.getBoundingClientRect();
            const content = popup.querySelector('.annotation-text');

            if (content) {
                content.textContent = note;
            }

            // 定位弹窗
            popup.style.left = (rect.left + rect.width / 2 - 150) + 'px';
            popup.style.top = (rect.bottom + 10) + 'px';
            popup.classList.add('show');
        },

        /**
         * 隐藏批注弹窗
         */
        hideAnnotationPopup() {
            const popup = document.getElementById('annotationPopup');
            if (popup) {
                popup.classList.remove('show');
            }
        }
    };

    // ========================================
    // 搜索功能
    // ========================================
    const searchManager = {
        /**
         * 初始化
         */
        init() {
            this.bindEvents();
        },

        /**
         * 绑定事件
         */
        bindEvents() {
            const searchBtn = document.getElementById('searchBtn');
            if (searchBtn) {
                searchBtn.addEventListener('click', () => this.toggleSearchBox());
            }
        },

        /**
         * 切换搜索框显示
         */
        toggleSearchBox() {
            // 创建搜索弹窗
            let searchModal = document.getElementById('searchModal');
            if (!searchModal) {
                searchModal = document.createElement('div');
                searchModal.id = 'searchModal';
                searchModal.className = 'search-modal';
                searchModal.innerHTML = `
                    <div class="search-modal-content">
                        <div class="search-input-wrapper">
                            <input type="text" id="searchInput" placeholder="搜索内容..." autocomplete="off">
                            <button id="closeSearchModal">
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                    <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                                </svg>
                            </button>
                        </div>
                        <div class="search-results" id="searchResults"></div>
                    </div>
                `;
                document.body.appendChild(searchModal);

                // 绑定事件
                const closeBtn = document.getElementById('closeSearchModal');
                const input = document.getElementById('searchInput');

                if (closeBtn) {
                    closeBtn.addEventListener('click', () => this.closeSearchModal());
                }

                if (input) {
                    input.addEventListener('input', utils.throttle((e) => this.performSearch(e.target.value), 300));
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') this.closeSearchModal();
                    });
                    // 自动聚焦
                    setTimeout(() => input.focus(), 100);
                }

                // 点击背景关闭
                searchModal.addEventListener('click', (e) => {
                    if (e.target === searchModal) this.closeSearchModal();
                });
            }

            searchModal.classList.add('show');
        },

        /**
         * 关闭搜索弹窗
         */
        closeSearchModal() {
            const searchModal = document.getElementById('searchModal');
            if (searchModal) {
                searchModal.classList.remove('show');
            }
        },

        /**
         * 执行搜索
         * @param {string} query
         */
        performSearch(query) {
            const resultsContainer = document.getElementById('searchResults');
            if (!resultsContainer) return;

            if (!query.trim()) {
                resultsContainer.innerHTML = '';
                return;
            }

            // 在当前页面内容中搜索
            const content = document.querySelector('.reading-text, .immersive-text, .classic-text');
            if (!content) {
                resultsContainer.innerHTML = '<div class="search-no-results">未找到相关内容</div>';
                return;
            }

            const paragraphs = content.querySelectorAll('p');
            const matches = [];

            paragraphs.forEach((p, index) => {
                const text = p.textContent;
                const lowerText = text.toLowerCase();
                const lowerQuery = query.toLowerCase();

                if (lowerText.includes(lowerQuery)) {
                    // 高亮匹配文本
                    const regex = new RegExp(`(${query})`, 'gi');
                    const highlighted = text.replace(regex, '<mark>$1</mark>');

                    matches.push({
                        index: index,
                        highlighted: highlighted,
                        element: p
                    });
                }
            });

            // 显示结果
            if (matches.length === 0) {
                resultsContainer.innerHTML = '<div class="search-no-results">未找到相关内容</div>';
            } else {
                resultsContainer.innerHTML = matches.map(match => `
                    <div class="search-result-item" data-index="${match.index}">
                        <div class="search-result-text">${match.highlighted}</div>
                    </div>
                `).join('');

                // 绑定点击事件
                const items = resultsContainer.querySelectorAll('.search-result-item');
                items.forEach((item, idx) => {
                    item.addEventListener('click', () => {
                        const index = parseInt(item.getAttribute('data-index'));
                        this.scrollToParagraph(index);
                        this.closeSearchModal();
                    });
                });
            }
        },

        /**
         * 滚动到指定段落
         * @param {number} index
         */
        scrollToParagraph(index) {
            const content = document.querySelector('.reading-text, .immersive-text, .classic-text');
            if (!content) return;

            const paragraphs = content.querySelectorAll('p');
            if (paragraphs[index]) {
                paragraphs[index].scrollIntoView({ behavior: 'smooth', block: 'center' });

                // 高亮显示
                paragraphs[index].classList.add('highlight-pulse');
                setTimeout(() => {
                    paragraphs[index].classList.remove('highlight-pulse');
                }, 2000);
            }
        }
    };

    // ========================================
    // 初始化
    // ========================================
    function init() {
        // 加载保存的设置
        const settings = utils.loadSettings();
        state.theme = settings.theme;
        state.fontSize = settings.fontSize || 21;

        // 初始化各个模块
        themeManager.init();
        fontSizeManager.init();
        progressManager.init();
        navigationManager.init();
        annotationManager.init();
        searchManager.init();

        // 添加全局样式
        addGlobalStyles();

        console.log('Sun Reader 已初始化');
    }

    /**
     * 添加全局样式
     */
    function addGlobalStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* 高亮脉冲动画 */
            @keyframes highlightPulse {
                0% { background-color: transparent; }
                50% { background-color: rgba(242, 84, 45, 0.2); }
                100% { background-color: transparent; }
            }

            .highlight-pulse {
                animation: highlightPulse 2s ease;
            }

            /* 搜索弹窗样式 */
            .search-modal {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(4px);
                z-index: 1000;
                display: flex;
                align-items: flex-start;
                justify-content: center;
                padding-top: 100px;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.25s ease, visibility 0.25s ease;
            }

            .search-modal.show {
                opacity: 1;
                visibility: visible;
            }

            .search-modal-content {
                background-color: var(--white);
                border-radius: var(--radius-medium);
                width: 90%;
                max-width: 600px;
                max-height: 70vh;
                display: flex;
                flex-direction: column;
                box-shadow: var(--shadow-lg);
                transform: translateY(-20px);
                transition: transform 0.25s ease;
            }

            .search-modal.show .search-modal-content {
                transform: translateY(0);
            }

            .search-input-wrapper {
                display: flex;
                align-items: center;
                padding: var(--space-md);
                border-bottom: 1px solid rgba(0, 0, 0, 0.05);
                gap: var(--space-sm);
            }

            .search-input-wrapper input {
                flex: 1;
                border: none;
                outline: none;
                font-size: 1rem;
                padding: 8px;
                font-family: var(--font-ui);
            }

            .search-input-wrapper input::placeholder {
                color: var(--text-secondary);
            }

            .search-input-wrapper button {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 36px;
                height: 36px;
                border-radius: 50%;
                color: var(--text-secondary);
                transition: all 0.15s ease;
            }

            .search-input-wrapper button:hover {
                background-color: var(--bg-secondary);
                color: var(--text-primary);
            }

            .search-results {
                flex: 1;
                overflow-y: auto;
                padding: var(--space-md);
            }

            .search-no-results {
                text-align: center;
                padding: var(--space-xl);
                color: var(--text-secondary);
                font-size: 0.9375rem;
            }

            .search-result-item {
                padding: var(--space-md);
                border-radius: var(--radius-small);
                cursor: pointer;
                transition: background-color 0.15s ease;
                margin-bottom: var(--space-sm);
            }

            .search-result-item:hover {
                background-color: var(--bg-secondary);
            }

            .search-result-text {
                font-size: 0.9375rem;
                line-height: 1.6;
                color: var(--text-primary);
            }

            .search-result-text mark {
                background-color: rgba(242, 84, 45, 0.2);
                color: var(--accent);
                padding: 0 2px;
                border-radius: 2px;
                font-weight: 500;
            }
        `;
        document.head.appendChild(style);
    }

    // ========================================
    // DOM 加载完成后初始化
    // ========================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
