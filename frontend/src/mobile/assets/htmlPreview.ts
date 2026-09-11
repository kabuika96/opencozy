// HTML files render as documents in a unique-origin sandbox, never inside app markup.
export function isolatedHtml(source: string): string {
  const document = new DOMParser().parseFromString(source, 'text/html');
  document.querySelectorAll('script, iframe, frame, object, embed, base, link, meta[http-equiv], form').forEach(element => element.remove());
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name) || ['srcdoc', 'action', 'formaction', 'ping', 'target'].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (element.hasAttribute('href') && !element.getAttribute('href')?.startsWith('#')) element.removeAttribute('href');
  }
  const policy = document.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; form-action 'none'; base-uri 'none'";
  document.head.prepend(policy);
  const viewport = document.createElement('meta'); viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1'; document.head.append(viewport);
  return '<!doctype html>\n' + document.documentElement.outerHTML;
}
