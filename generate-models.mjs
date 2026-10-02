import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://models.dev/api.json";
const OUTPUT_PATH = fileURLToPath(new URL("./models.json", import.meta.url));
// Order matters: on duplicate model IDs the first provider wins, so reseller alibaba-cn stays last.
const OFFICIAL_PROVIDERS = [
  "openai", "anthropic", "google", "deepseek", "zhipuai", "moonshotai-cn",
  "minimax-cn", "xiaomi", "stepfun", "longcat", "xai", "alibaba-cn",
];

function hasTokenPrice(cost) {
  return cost && typeof cost === "object" && ["input", "output", "cache_read", "cache_write"]
    .some((key) => typeof cost[key] === "number");
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "llm-official-prices/0.1" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error(`Failed to fetch ${url} after ${attempts} attempts`, { cause: lastError });
}

const catalog = await (await fetchWithRetry(SOURCE_URL)).json();
const selected = new Map();
const conflicts = [];

for (const providerId of OFFICIAL_PROVIDERS) {
  const provider = catalog[providerId];
  if (!provider?.models || typeof provider.models !== "object") throw new Error(`Provider '${providerId}' is missing`);
  for (const [catalogKey, model] of Object.entries(provider.models)) {
    const modelId = (typeof model.id === "string" && model.id ? model.id : catalogKey).toLowerCase();
    if (modelId.includes("/") || !hasTokenPrice(model.cost)) continue;
    if (selected.has(modelId)) {
      conflicts.push(`${modelId}: kept ${selected.get(modelId).provider}, skipped ${providerId}`);
      continue;
    }
    selected.set(modelId, { provider: providerId, ...model.cost });
  }
}

const output = Object.fromEntries([...selected.entries()].sort(([left], [right]) => left.localeCompare(right)));
await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Generated ${selected.size} models`);
for (const conflict of conflicts) console.warn(conflict);
