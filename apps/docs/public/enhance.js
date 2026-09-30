/*
 * Two progressive enhancements Starlight has no hook for. Both are optional: with no
 * script, headings wrap where the browser chooses and tables scroll in their box.
 *
 * 1. Code in a heading — a route (`GET /chat/stream/{thread_id}`) or a field
 *    (`spec.procedural_memory`) — gets a break opportunity after each `/` and `.`,
 *    so on a phone it wraps between segments instead of inside one ("{thread_i / d}").
 *    Heading ids are built at build time, so anchors are unaffected.
 *
 * 2. A table of three or more columns is marked to stack below 50rem (brand.css):
 *    each cell carries its column name, and explicit table roles keep the structure
 *    for screen readers once the layout stops being a table.
 */
(() => {
  const content = document.querySelector('.sl-markdown-content');
  if (!content) return;

  for (const code of content.querySelectorAll('h2 code, h3 code, h4 code')) {
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (const node of texts) {
      const parts = node.textContent.split(/(?<=[/.])(?=.)/);
      if (parts.length < 2) continue;
      const frag = document.createDocumentFragment();
      parts.forEach((part, i) => {
        if (i > 0) frag.append(document.createElement('wbr'));
        frag.append(part);
      });
      node.replaceWith(frag);
    }
  }

  for (const table of content.querySelectorAll('table')) {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (heads.length < 3) continue;
    table.classList.add('felix-stack');
    table.setAttribute('role', 'table');
    for (const group of table.querySelectorAll('thead, tbody'))
      group.setAttribute('role', 'rowgroup');
    for (const row of table.querySelectorAll('tr')) row.setAttribute('role', 'row');
    for (const th of table.querySelectorAll('thead th')) th.setAttribute('role', 'columnheader');
    for (const row of table.querySelectorAll('tbody tr')) {
      [...row.children].forEach((cell, i) => {
        cell.setAttribute('role', 'cell');
        if (heads[i]) cell.setAttribute('data-label', heads[i]);
      });
    }
  }
})();
