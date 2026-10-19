import { readFileSync } from "node:fs";

const expected = readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim();
if (process.versions.node !== expected) {
  console.error(`Expected Node ${expected} from .nvmrc; found ${process.versions.node}.`);
  process.exitCode = 1;
}
