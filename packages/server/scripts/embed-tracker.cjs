const fs = require("fs");
const path = require("path");

const trackerPath = path.resolve(__dirname, "../../tracker/dist/t.js");
const outPath = path.resolve(__dirname, "../dist/tracker.js");

const content = fs.readFileSync(trackerPath, "utf8");
fs.writeFileSync(outPath, `export const TRACKER_SCRIPT = ${JSON.stringify(content)};\n`);
console.log("Tracker embedded.");
