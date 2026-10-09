/*
 * Progressive enhancements Starlight has no hook for. All are optional: with no
 * script, headings wrap where the browser chooses and tables scroll in their box.
 *
 * 1. Code in a heading — a route (`GET /chat/stream/{thread_id}`) or a field
 *    (`spec.procedural_memory`) — gets a break opportunity after each `/` and `.`,
 *    so on a phone it wraps between segments instead of inside one ("{thread_i / d}").
 *    Heading ids are built at build time, so anchors are unaffected.
 *
 * 1b. Code in a table cell gets the same, plus after each `,` `&` `?` and `|`.
 *    A table sizes a column to its longest unbreakable run, and `overflow-wrap`
 *    does not shorten that run — so one JSON body or query-string path widened
 *    its column until the table scrolled at desktop width, with the Notes or
 *    Purpose column off the edge. The breaks fall between keys, segments and
 *    parameters, never inside one: not after a `.` before a digit (`0.7`), nor a
 *    `,` between digits (`1,000`).
 *
 * 2. Every table of two or more columns is marked to stack below 50rem (brand.css),
 *    and explicit table roles keep the structure for screen readers once the layout
 *    stops being a table. From three columns each cell carries its column name; a
 *    two-column table is a term and its description, so the second needs none.
 *    Two-column tables were left as tables, on the theory that they fit — ten did
 *    not, and scrolled sideways on a phone under a name too long to wrap.
 */
(() => {
  const content = document.querySelector('.sl-markdown-content');
  if (!content) return;

  const breakAt = (selector, pattern) => {
    for (const code of content.querySelectorAll(selector)) {
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      for (const node of texts) {
        const parts = node.textContent.split(pattern);
        if (parts.length < 2) continue;
        const frag = document.createDocumentFragment();
        parts.forEach((part, i) => {
          if (i > 0) frag.append(document.createElement('wbr'));
          frag.append(part);
        });
        node.replaceWith(frag);
      }
    }
  };
  breakAt('h2 code, h3 code, h4 code', /(?<=[/.])(?=.)/);
  breakAt('td code', /(?<=[/&?|])(?=.)|(?<=,)(?=\D)|(?<=\.)(?=[A-Za-z_{<])/);

  for (const table of content.querySelectorAll('table')) {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (heads.length < 2) continue;
    table.classList.add('felix-stack');
    table.setAttribute('role', 'table');
    for (const group of table.querySelectorAll('thead, tbody'))
      group.setAttribute('role', 'rowgroup');
    for (const row of table.querySelectorAll('tr')) row.setAttribute('role', 'row');
    for (const th of table.querySelectorAll('thead th')) th.setAttribute('role', 'columnheader');
    for (const row of table.querySelectorAll('tbody tr')) {
      [...row.children].forEach((cell, i) => {
        cell.setAttribute('role', 'cell');
        if (heads[i] && heads.length > 2) cell.setAttribute('data-label', heads[i]);
      });
    }
  }
})();
