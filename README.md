# Charter 1.4

管理海外子公司的 Mac 应用：公司档案、股权结构、合规日历、文件与打包发送。

## 下载与安装

在 [GitHub Releases](https://github.com/evonotevil/Charter/releases/latest) 下载 DMG 或 ZIP，无需安装 Xcode。

- 系统要求：macOS 26 或更新系统；通用安装包支持 Apple Silicon 和 Intel Mac。
- DMG：打开磁盘映像，将 `Charter.app` 拖到 `Applications`。
- ZIP：解压，将 `Charter.app` 拖到“应用程序”。
- 当前版本使用本地临时签名，未经过 Apple 公证。若系统阻止打开，请先尝试启动一次，再到“系统设置 → 隐私与安全性”点击“仍要打开”，确认打开。不要关闭系统安全检查。
- 示例数据是虚构演示数据。安装包不包含用户自己的公司资料或文件。

## 制作安装包

需要 Xcode 26 或更新版本及 macOS 26。运行以下命令生成 Universal DMG、ZIP 和 SHA-256 校验文件：

```sh
python3 tools/run-regressions.py
python3 tools/package-release.py
```

产物默认位于 `dist/`。可用 `--output /path/to/output` 指定目录；默认执行 Release 构建，也可用 `--app /path/to/Charter.app` 打包已经构建的 Universal 应用。该脚本只使用本地临时签名，不执行 Apple 公证。

## 运行

1. 用 Xcode 26 打开 `Charter.xcodeproj`。
2. 顶部选择 “Charter > My Mac”，按 ⌘R。
3. 第一次打开时，在“今天”页点“载入示例数据”看看效果；或者在“设置 → 通用”里先换一个空文件夹再载入。

不需要 Apple 开发者账号：工程用“本地签名”（Sign to Run Locally）。如果 Xcode 提示签名问题，在 Target → Signing & Capabilities 里选你自己的 Apple ID（Personal Team）即可。

## 数据放在哪

默认在 `iCloud 云盘/Charter/`，两台 Mac 打开同一个文件夹即同步：

```
Charter/
  数据/      companies.json、holdings.json、obligations.json ……
  模板/      templates.json（文件类型库、合规规则、文件包，可在“设置”里改）
  文件/      按公司分的 PDF，自动命名为“公司名_类型_签发日.pdf”
  文件包/    生成的 ZIP
```

## 代码结构

| 目录 | 内容 |
| --- | --- |
| `Charter/Model` | 数据模型（公司、人、持股、任职、文件、事项、负责方、模板） |
| `Charter/Engine` | 截止日计算、穿透持股、文件有效期 |
| `Charter/Storage` | 数据文件夹读写 |
| `Charter/Services` | 通知、Apple 日历、文件识别（Vision + 端侧模型）、打包、邮件 |
| `Charter/Views` | 界面 |
| `Charter/Resources/charter-templates.json` | 7 个法域的内置模板，由 `tools/make_templates.py` 生成 |

## 内置规则是草稿

`charter-templates.json` 里的合规规则都标为“待核对”。请让各法域的代理核对截止日和规则，在“设置 → 合规规则”里修改并取消“待核对”。
