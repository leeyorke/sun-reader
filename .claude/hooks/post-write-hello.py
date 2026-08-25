#!/usr/bin/env python3
"""
最简单的PostToolUse Hook示例
每次Write工具执行后打印一条消息
"""

import sys
import json

# 从stdin读取工具执行信息
try:
    input_data = json.loads(sys.stdin.read())
except:
    sys.exit(0)

# 获取工具名称和文件路径
tool_name = input_data.get("tool_name", "")
tool_input = input_data.get("tool_input", {})
file_path = tool_input.get("file_path", "")

# 只处理Write工具
if tool_name == "Write":
    # 打印到stderr（会显示在Claude Code界面）
    print(f"\n{'=' * 50}", file=sys.stderr)
    print("✅ Hook触发成功！", file=sys.stderr)
    print(f"📄 文件已保存: {file_path}", file=sys.stderr)
    print(f"{'=' * 50}\n", file=sys.stderr)

sys.exit(0)
