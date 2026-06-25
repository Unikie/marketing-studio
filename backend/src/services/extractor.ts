import fs from 'fs';
import path from 'path';

export async function extractText(filePath: string, mimeType: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  if (mimeType === 'application/pdf' || ext === '.pdf') {
    return extractPdf(filePath);
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === '.docx'
  ) {
    return extractDocx(filePath);
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/vnd.ms-powerpoint' ||
    ext === '.pptx' ||
    ext === '.ppt'
  ) {
    return extractPptx(filePath);
  }

  throw new Error(`Unsupported file type: ${mimeType} (${ext})`);
}

async function extractPdf(filePath: string): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default;
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

async function extractDocx(filePath: string): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

async function extractPptx(filePath: string): Promise<string> {
  const officeparser = await import('officeparser');
  return new Promise<string>((resolve, reject) => {
    officeparser.parseOffice(filePath, (data: any, err: any) => {
      if (err) reject(err);
      else resolve(typeof data === 'string' ? data : String(data));
    });
  });
}
