// Tiny safe roleplay formatter. No HTML or Markdown execution.
(() => {
  function parts(text) {
    const result = [];
    let start = 0;
    const pattern =
      /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|(?<![\w:/])\/([^/\n]+)\/(?![\w/])|(?<![\w:/])\/([^/\n]*\s[^/\n]*)\/(?=\w)/g;

    for (const match of text.matchAll(pattern)) {
      if (match.index > start) result.push({ text: text.slice(start, match.index), action: false });

      result.push(
        match[3] === undefined && match[4] === undefined
          ? { text: match[1] ?? match[2], action: true }
          : { text: match[3] ?? match[4], action: false, italic: true },
      );
      start = match.index + match[0].length;
    }
    if (start < text.length) result.push({ text: text.slice(start), action: false });

    return result;
  }

  function render(text) {
    const fragment = document.createDocumentFragment();

    for (const part of parts(text)) {
      if (part.action || part.italic) {
        const span = document.createElement(part.italic ? 'em' : 'span');

        if (part.action) span.className = 'roleplay-action';

        span.textContent = part.text;
        fragment.append(span);
      } else fragment.append(document.createTextNode(part.text));
    }

    return fragment;
  }
  // /me is third-person stage direction; do not rewrite ordinary dialogue.

  function actionBody(text, name) {
    text = text.trim();
    if (text.toLowerCase().startsWith(name.toLowerCase() + ' ')) return text.slice(name.length + 1);

    return text.replace(/^I\s+(\w+)/i, (_, verb) => {
      const v = verb.toLowerCase(),
        irregular = { am: 'is', have: 'has', do: 'does', go: 'goes' };
      return (
        irregular[v] ||
        (/[^aeiou]y$/.test(v)
          ? v.slice(0, -1) + 'ies'
          : /(s|sh|ch|x|z|o)$/.test(v)
            ? v + 'es'
            : v + 's')
      );
    });
  }

  globalThis.APSUActionText = { parts, render, actionBody };
})();
