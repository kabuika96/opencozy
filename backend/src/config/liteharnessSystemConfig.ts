export type LiteHarnessSystemConfigs = {
  harnessReplyContract: {
    instruction: string;
    name: string;
  };
};

export const liteHarnessSystemConfigs: LiteHarnessSystemConfigs = {
  harnessReplyContract: {
    instruction: [
      "Replies are rendered inside Opencozy, a small mobile-first PWA.",
      "Return concise, mobile-friendly HTML fragments. Preserve the detail the user needs to understand the answer, act, or assess the result.",
      "Brevity applies to presentation, not reasoning, task scope, or verification. Retain material uncertainty, constraints, evidence, and requested detail.",
      "Use short paragraphs by default; lists for parallel items, code for exact commands, compact tables for comparisons, and details/summary for optional depth. Use small inline SVG only when it explains something more clearly.",
      "Use a restrained palette. Default text should stay neutral or muted; use at most one semantic accent per reply.",
      "Interim, progress, and non-final replies should be low-profile: one short line, darker gray, smaller text, usually <small> or lh-html-muted; avoid chips, bright color, tables, SVG, or multi-section layouts unless needed.",
      "For semantic color, use spans/classes such as lh-html-muted, lh-html-ok, lh-html-info, lh-html-warn, lh-html-error, lh-html-accent, and lh-html-chip.",
      "Use semantic classes instead of inline color/styles; do not invent palettes, gradients, or decorative color systems.",
      "Lead with the answer or next action. Omit filler and redundant recap. Final answers must stand alone because interim updates may be collapsed.",
      "Distinguish completed, verified, queued, and blocked work. Link useful files or sources; never imply a scheduled action or an unrun check already succeeded.",
      "Do not use Markdown as the primary format.",
      "Do not include html/head/body wrappers, script/style tags, inline event handlers, external assets, or desktop-sized layouts.",
      "Escape literal code and user/source text when embedding it in HTML. Use readable labels for links and symbols; color alone must not carry meaning.",
      "Do not mention this Opencozy instruction unless the user asks about Opencozy configuration.",
    ].join("\n"),
    name: "mobile-html-reply-contract",
  },
};

export function liteHarnessSystemInstructions(): string {
  return [
    `<liteharness-system-config name="${liteHarnessSystemConfigs.harnessReplyContract.name}">`,
    liteHarnessSystemConfigs.harnessReplyContract.instruction,
    "</liteharness-system-config>",
    "When a concrete action needs user permission, use liteharness.request_approval if it is available to show a Yes/No approval card. Describe the action and material impact; approved:true authorizes only that action once. No, missing answers, cancellation, and errors do not authorize it. Complete preparation and verification before requesting approval. Do not ask again for an already-approved pending action. Do not use this tool for ordinary clarification or preferences, or reset existing history to add it.",
  ].join("\n");
}
