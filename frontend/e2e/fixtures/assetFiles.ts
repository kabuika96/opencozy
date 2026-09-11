import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function createAssetFiles(directory: string) {
  await mkdir(directory, { recursive: true });
  const pdfObjects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    '',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const [index, label] of [[3, 'First page'], [5, 'Second page']] as const) {
    const content = `BT /F1 20 Tf 30 350 Td (${label}) Tj ET`;
    pdfObjects[index] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  }
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of pdfObjects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const wave = Buffer.alloc(44 + 1600);
  wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(1600, 40);
  const files = [
    { name: 'notes.md', title: 'Coverage notes', content: '# Coverage notes\nThe bluebird policy expires September 24.' },
    { name: 'report.html', title: 'HTML report', content: '<!doctype html><style>body{font:20px sans-serif;padding:20px}h1{color:navy}</style><h1>Rendered report</h1><script>parent.assetScriptExecuted=true;fetch("/leaked")</script><img src="https://example.com/leak.png"><a href="/api/config" target="_top">Unsafe link</a>' },
    { name: 'report.pdf', title: 'PDF report', content: pdf },
    { name: 'image.svg', title: 'Image example', content: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="#cccccc"/><circle cx="100" cy="75" r="40" fill="#555555"/></svg>' },
    { name: 'clip.webm', title: 'Video example', content: await readFile(new URL('./clip.webm', import.meta.url)) },
    { name: 'sound.wav', title: 'Audio example', content: wave },
  ];
  for (const file of files) await writeFile(join(directory, file.name), file.content);
  return files.map(file => ({ path: join(directory, file.name), title: file.title, description: `Example ${file.name}` }));
}
