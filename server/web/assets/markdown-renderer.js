/* AICT Markdown rendering. markdown-it is vendored locally; raw HTML stays inert. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./markdown-it.min.js'));
  else root.AICTMarkdown = factory(root.markdownit);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MarkdownIt) {
  'use strict';
  const md = new MarkdownIt({html: false, linkify: true, breaks: false, typographer: false});
  const validate = md.validateLink.bind(md);
  md.validateLink = url => validate(url) && (!/^[a-z][a-z\d+.-]*:/i.test(url) || /^(https?:|mailto:)/i.test(url));
  const renderToken = (tokens, idx, options, env, self) => self.renderToken(tokens, idx, options);
  const linkOpen = md.renderer.rules.link_open || renderToken;
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    if (!tokens[idx].attrGet('href')?.startsWith('#')) {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
    }
    return linkOpen(tokens, idx, options, env, self);
  };
  const image = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet('loading', 'lazy'); tokens[idx].attrSet('decoding', 'async');
    tokens[idx].attrSet('referrerpolicy', 'no-referrer');
    return image(tokens, idx, options, env, self);
  };
  md.renderer.rules.table_open = () => '<div class="markdown-table" role="region" aria-label="表格，可左右滑动" tabindex="0"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
  md.core.ruler.after('inline', 'aict_task_lists', state => {
    for (let i = 2; i < state.tokens.length; i++) {
      const inline = state.tokens[i];
      if (inline.type !== 'inline' || state.tokens[i - 1].type !== 'paragraph_open' || state.tokens[i - 2].type !== 'list_item_open') continue;
      const first = inline.children?.[0];
      const match = first?.type === 'text' && first.content.match(/^\[([ xX])\](?:\s+|$)/);
      if (!match) continue;
      state.tokens[i - 2].attrJoin('class', 'task-list-item');
      first.content = first.content.slice(match[0].length);
      const checkbox = new state.Token('task_checkbox', 'input', 0);
      checkbox.meta = {checked: match[1].toLowerCase() === 'x'};
      inline.children.unshift(checkbox);
    }
  });
  md.renderer.rules.task_checkbox = (tokens, idx) => '<input class="task-checkbox" type="checkbox" disabled' +
    (tokens[idx].meta.checked ? ' checked aria-label="任务已完成"' : ' aria-label="任务未完成"') + '> ';
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const language = (tokens[idx].info || '').trim().split(/\s+/)[0];
    const label = language ? '<span class="code-language">' + md.utils.escapeHtml(language) + '</span>' : '';
    return '<div class="code-block">' + label + fence(tokens, idx, options, env, self) + '</div>';
  };
  return Object.freeze({render: text => md.render(String(text)), version: 'markdown-it 15.0.3'});
});
