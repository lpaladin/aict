# Markdown 渲染验收

2026-11-18，Asia/Shanghai。

将原来的部分手写解析替换为本地markdown-it 15.0.3浏览器包，来源npm registry，下载SHA-512校验通过。
静态资源随项目提供，不使用外部CDN。MIT许可文本随源文件附带。
AICT renderer添加任务列表、移动端表格容器、代码语言标签和链接/图片安全策略。

## 自动检查

`node tools/test-markdown.cjs`：16项全部通过。

覆盖段落软换行、1至6级标题、嵌套加粗/斜体、删除线、转义、嵌套无序/有序列表、非1起始编号、
表格对齐与转义竖线、勾选/未勾选/嵌套任务、围栏及缩进代码、嵌套引用、分隔线、硬换行、
带标题及复杂标签的链接、引用式链接、自动URL、图片、HTML转义、危险链接和围栏信息转义。
综合测试文本的每个流式前缀（包括未闭合代码块/链接/表格）均可渲染且没有活动script标签。

`server/test_codex_mobile.py`：9项通过，1项真实Codex进程测试按默认设置跳过。
JavaScript语法检查通过。

## 实际浏览器

使用生产HTML、JS和Markdown资源，显式模拟对话事件：
- 实际DOM出现table、嵌套ul/ol、禁用checkbox、blockquote、pre/code、图片和链接。
- 400px：页面宽度400、scrollWidth400；表格内部可视344、总宽451；长代码可视344、总宽640。
- 表格实际横向滚动后scrollLeft约106.4，页面未横向滚动。
- 320px：页面宽度320、scrollWidth320；表格内部可视272、总宽451。
- 本地Markdown图片已加载；任务勾选状态正确；无script、iframe或onerror属性进入DOM。
- 截图：dist/markdown-rendering-preview.png，属于浏览器样例而非手机截图。

数学公式和Mermaid当前作为普通Markdown内容/代码展示，没有专用公式或图形渲染器。
没有增加代码语法高亮依赖，代码语言标签和内容保真已验证。
