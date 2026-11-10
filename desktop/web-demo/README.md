# Charter 官网交互预览

在 `desktop` 目录使用现有依赖启动：`npm exec -- vite --config web-demo/vite.config.ts --port 4176 --strictPort`。

构建静态预览：`npm exec -- vite build --config web-demo/vite.config.ts`，产物在 `web-demo/dist`。GitHub Pages 工作流发布这份产物，并保留 `site/assets` 下的既有公开资源。桌面应用仍使用自己的构建入口。

演示窗口直接运行桌面应用的 Shell 和真实页面。每个窗口使用独立的内存工作区和 Charter 自带的虚构示例数据，刷新后重置。官网只负责介绍、滚动换幕和入口导航。窄屏和减少动态效果模式顺序展开，可在新标签页打开演示以获得更大的操作空间。
