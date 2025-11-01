import fs from "fs/promises";
import path from "path";

export function basenameWithExt(filePath) {
  return path.basename(filePath);
}

export function basenameNoExt(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

export function dirname(filePath) {
  return path.dirname(filePath);
}

/**
 * get All file
 * @param {string} dir
 * @param {string} ext
 * @returns {Promise<Array<{index:number,file:string,absPath:string,url?:string,size:number}>>}
 */
export async function listFiles(dir, ext) {
  const files = await fs.readdir(dir);
  const re = new RegExp(`^seg_(\\d{5})\\.${ext}$`, "i");

  const segments = [];

  for (const name of files) {
    const m = re.exec(name);
    if (!m) continue;

    const index = parseInt(m[1], 10);
    const absPath = path.join(dir, name);

    segments.push({
      index,
      file: name,
      name: basenameNoExt(name),
      absPath,
    });
  }

  segments.sort((a, b) => a.index - b.index);
  return segments;
}
