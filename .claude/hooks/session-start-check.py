#!/usr/bin/env python3
"""
SessionStart Hook - 环境检查
启动时检查必需的工具和依赖是否已安装
"""

import sys
import shutil

# 检查必需的工具
required_tools = {
    "node": "Node.js (npm install)",
    "python": "Python 3.x",
    "git": "Git版本控制",
}

# 可选但推荐的工具
optional_tools = {
    "prettier": "Prettier代码格式化 (npm install -g prettier)",
    "black": "Black Python格式化 (pip install black)",
}

missing_required = []
missing_optional = []

# 检查必需工具
for tool, desc in required_tools.items():
    if not shutil.which(tool):
        missing_required.append(f"  X {tool}: {desc}")

# 检查可选工具
for tool, desc in optional_tools.items():
    if not shutil.which(tool):
        missing_optional.append(f"  ! {tool}: {desc}")

# 输出检查结果
if missing_required or missing_optional:
    print("\n" + "=" * 50, file=sys.stderr)
    print("环境检查结果", file=sys.stderr)
    print("=" * 50, file=sys.stderr)

    if missing_required:
        print("\nX 缺少必需工具（请安装）：", file=sys.stderr)
        for item in missing_required:
            print(item, file=sys.stderr)

    if missing_optional:
        print("\n! 缺少可选工具（建议安装）：", file=sys.stderr)
        for item in missing_optional:
            print(item, file=sys.stderr)

    print("\n" + "=" * 50 + "\n", file=sys.stderr)
else:
    print("V 环境检查通过，所有工具已就绪", file=sys.stderr)

sys.exit(0)
