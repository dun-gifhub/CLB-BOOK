import "dotenv/config";
import { runDailyCheck } from "../src/checker.js";
const r = await runDailyCheck();
console.log(JSON.stringify(r, null, 2));
process.exit(0);
