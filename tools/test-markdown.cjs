const assert = require('node:assert/strict');
const md = require('../server/web/assets/markdown-renderer.js');
let count = 0;
function check(name, fn) { fn(); count++; console.log('PASS:', name); }
check('CommonMark paragraphs preserve soft breaks', () => {
  assert.equal(md.render('一段文字\n继续这段\n\n新的段落'), '<p>一段文字\n继续这段</p>\n<p>新的段落</p>\n');
});
check('heading levels remain distinct', () => {
  for (let n = 1; n <= 6; n++) assert.match(md.render('#'.repeat(n) + ' 标题'), new RegExp(`<h${n}>标题</h${n}>`));
});
check('nested bold, emphasis, strike and escaped literals', () => {
  const html = md.render('**粗体与 *斜体***、~~删除~~、\\*保留星号\\*');
  assert.match(html, /<strong>粗体与 <em>斜体<\/em><\/strong>/); assert.match(html, /<s>删除<\/s>/); assert.match(html, /\*保留星号\*/);
});
check('nested unordered and ordered lists with continued paragraphs', () => {
  const html = md.render('- 父级\n  1. 子项\n  2. 第二项\n\n     继续说明\n- 另一个父级');
  assert.match(html, /<ul>[\s\S]*<li>父级[\s\S]*<ol>[\s\S]*<p>继续说明<\/p>/);
});
check('non-default numbered list start', () => assert.match(md.render('3. 第三项\n4. 第四项'), /<ol start="3">/));
check('tables, alignment, escaped pipes and inline formatting', () => {
  const html = md.render('| 名称 | 结果 |\n| :--- | ---: |\n| **文件** | 600001 |\n| a\\|b | `ok` |');
  assert.match(html, /class="markdown-table"/); assert.match(html, /<table>/); assert.match(html, /text-align:right/);
  assert.match(html, /<strong>文件<\/strong>/); assert.match(html, /a\|b/); assert.match(html, /<code>ok<\/code>/);
});
check('task lists render disabled checked and unchecked inputs', () => {
  const html = md.render('- [x] 已完成\n- [ ] 未完成\n  - [X] 嵌套');
  assert.equal((html.match(/type="checkbox"/g) || []).length, 3);
  assert.equal((html.match(/disabled checked/g) || []).length, 2);
  assert.doesNotMatch(html, /\[x\]|\[X\]|\[ \]/);
});
check('fenced and indented code preserve source and escape tags', () => {
  assert.match(md.render('```html\n<script>alert(1)</script>\n```'), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(md.render('    const x = 1;'), /<pre><code>const x = 1;/);
  assert.match(md.render('````txt\n```js\n````'), /```js/);
});
check('blockquotes, horizontal rules, hard line breaks', () => {
  const html = md.render('> 引用\n>\n> - 一项\n\n---\n\n第一行  \n第二行');
  assert.match(html, /<blockquote>/); assert.match(html, /<hr>/); assert.match(html, /第一行<br>\n第二行/);
});
check('links, nested emphasis labels and automatic URLs', () => {
  const html = md.render('[**打开**](/artifacts/key/a%20b.html "标题") 与 https://example.com/a_(b)');
  assert.match(html, /href="\/artifacts\/key\/a%20b.html"/); assert.match(html, /<strong>打开<\/strong>/);
  assert.match(html, /rel="noopener noreferrer"/); assert.match(html, /href="https:\/\/example.com\/a_\(b\)"/);
});
check('reference links and multiline link definitions', () => assert.match(md.render('[文档][ref]\n\n[ref]: https://example.com/ "说明"'), /href="https:\/\/example.com\/" title="说明"/));
check('images support escaped alt text and lazy local loading', () => {
  const html = md.render('![图示](/artifacts/key/chart.png "示意图")');
  assert.match(html, /src="\/artifacts\/key\/chart.png"/); assert.match(html, /loading="lazy"/); assert.match(html, /referrerpolicy="no-referrer"/);
});
check('raw HTML never becomes active elements', () => {
  const html = md.render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<iframe src="https://example.com"></iframe>');
  assert.doesNotMatch(html, /<(script|img|iframe)\b/); assert.match(html, /&lt;script&gt;/);
});
check('dangerous URL schemes cannot create links or images', () => {
  for (const url of ['javascript:alert(1)', 'vbscript:msgbox(1)', 'file:///C:/secret', 'data:text/html,test', 'data:image/svg+xml,test', 'JaVaScRiPt:alert(1)', 'javascript&#58;alert(1)']) {
    const html = md.render(`[打开](${url}) ![图](${url})`);
    assert.doesNotMatch(html, /<a\b|<img\b/, url);
  }
});
check('code fence info is escaped', () => assert.doesNotMatch(md.render('```x" onmouseover="alert(1)\ncode\n```'), /class="[^"<>]*" onmouseover=/));
check('every streaming prefix renders safely, including incomplete fences and links', () => {
  const source = '# 标题\n\n| A | B |\n|---|---|\n| **粗体** | 2 |\n\n- [x] 完成\n\n```js\nconst x = "<script>";\n```\n\n[链接](https://example.com/a_(b))';
  for (let i = 0; i <= source.length; i++) { const html = md.render(source.slice(0, i)); assert.equal(typeof html, 'string'); assert.doesNotMatch(html, /<script>/); }
});
console.log(`Markdown: ${count} checks passed (${md.version}).`);
