import { expect, it } from 'vitest';
import { isolatedHtml } from './htmlPreview';

it('keeps document styling while disabling active content and navigation', () => {
  const output = isolatedHtml('<html><head><meta http-equiv="refresh" content="0;url=/api/config"><style>body{color:red}</style></head><body onload="steal()"><script>fetch("/api/threads")</script><h1>Report</h1><a href="https://example.com" target="_top" ping="/leak">Link</a><iframe src="/api/config"></iframe><img src="data:image/png;base64,AA" onerror="steal()"></body></html>');
  const document = new DOMParser().parseFromString(output, 'text/html');
  expect(document.querySelector('h1')?.textContent).toBe('Report');
  expect(document.querySelector('style')?.textContent).toBe('body{color:red}');
  expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("default-src 'none'");
  expect(document.querySelector('script, iframe, [onload], [onerror], [ping], [target], a[href]')).toBeNull();
});
