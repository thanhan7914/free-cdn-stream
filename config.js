import { readFile } from "fs/promises";

const raw = await readFile(new URL("./config.json", import.meta.url));
const data = JSON.parse(raw);

export default data;
