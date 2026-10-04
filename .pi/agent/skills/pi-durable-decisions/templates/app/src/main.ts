import { createHash } from "node:crypto";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Question } from "./decide.ts";
import { judge } from "./lattice.ts";
import { openVerdictStore } from "./store.ts";

const context = BACKGROUND_CONTEXT;
const task = process.env.TASK ?? "resume";
const evidence = process.env.EVIDENCE ?? "no evidence";
const requestId = createHash("sha256").update(`${task}\n${evidence}`).digest("hex").slice(0, 16);

const route: Question[] = [{ id: "in_scope", kind: "noul", instructions: "Is this task in scope for the app?" }];
const verify: Question[] = [{ id: "complete", kind: "noul", instructions: "Does the finished run complete the task?" }];

const models = createModels();
models.setProvider(openaiProvider());
const storage = await openNodeSqliteStorage(process.env.SESSION_DB ?? "/data/session.sqlite");
const harness = await Harness.open(storage, { models, registry: createRegistry() }, context);
const verdictStore = openVerdictStore(process.env.VERDICT_DB ?? "/data/verdicts.json");

process.on("SIGTERM", () => {
  void harness.close(context).finally(() => process.exit(0));
});

harness.resume();
console.log("resumed");

const routeResult = await judge(route, evidence, { task }, verdictStore);
console.log(JSON.stringify({ phase: "route", requestId, asked: routeResult.asked, reused: routeResult.reused, hedges: routeResult.hedges, verdicts: routeResult.verdicts }));

if (routeResult.verdicts.some((verdict) => verdict.value === false)) {
  console.log(JSON.stringify({ phase: "route", result: "out of scope, no LLM call" }));
} else {
  const root = await harness.root(context, {
    agent: { model: { provider: "openai", modelId: process.env.PI_MODEL ?? "gpt-6-sol" } },
  });
  const submission = await root.submit(
    {
      type: "input",
      requestId,
      content: `Task: ${task}\nEvidence: ${evidence}\nRoute verdicts: ${JSON.stringify(routeResult.verdicts)}\nResolve the hedged ids: ${routeResult.hedges.join(", ") || "none"}.`,
    },
    context,
  );
  const settled = await submission.wait(context);
  const verifyResult = await judge(verify, `${evidence}\nsettled: ${settled.status}`, { task, settled: settled.status }, verdictStore);
  console.log(JSON.stringify({ phase: "verify", asked: verifyResult.asked, reused: verifyResult.reused, hedges: verifyResult.hedges, verdicts: verifyResult.verdicts }));
  const incomplete = verifyResult.verdicts.some((verdict) => verdict.value === false || verdict.value === "hedge");
  console.log(JSON.stringify({ phase: "done", requestId, complete: !incomplete }));
}
