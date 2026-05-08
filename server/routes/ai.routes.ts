import { Router } from "express";
import OpenAI from "openai";
import { requireAdmin } from "../middlewares/auth";
import { runAdminAiChat, adminAiTools, executeAdminTool } from "../services/ai.service";
import { buildOpenAI } from "../lib/openaiClient";

export const aiRouter = Router();

// ─── AI agentic chat (primary endpoint) ──────────────────────────────────────
aiRouter.post("/api/admin/ai-chat", requireAdmin, async (req, res) => {
  try {
    const { messages } = req.body as { messages: Array<{ role: string; content: string }> };
    if (!messages?.length) return res.status(400).json({ message: "Messages are required" });
    const result = await runAdminAiChat(messages);
    res.json(result);
  } catch (err: any) {
    console.error("AI chat error:", err);
    res.status(500).json({ message: err?.message || "AI request failed" });
  }
});

// ─── Legacy ai-execute endpoint (backwards compat) ───────────────────────────
aiRouter.post("/api/admin/ai-execute", requireAdmin, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ message: "Prompt is required" });
  try {
    const openai = buildOpenAI();
    const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: "You are an admin assistant. Perform the requested action using your tools." },
      { role: "user", content: prompt },
    ];
    const response = await openai.chat.completions.create({ model: "gpt-5-mini", messages: chatMessages, tools: adminAiTools, tool_choice: "auto" });
    const assistantMessage = response.choices[0].message;
    if (assistantMessage.tool_calls?.length) {
      const loopMessages: any[] = [...chatMessages, assistantMessage];
      for (const toolCall of assistantMessage.tool_calls) {
        const fn = (toolCall as any).function;
        const args = JSON.parse(fn.arguments || "{}");
        const result = await executeAdminTool(fn.name, args);
        loopMessages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
      }
      const final = await openai.chat.completions.create({ model: "gpt-5-mini", messages: loopMessages, tools: adminAiTools });
      return res.json({ message: final.choices[0]?.message?.content || "Done." });
    }
    return res.json({ message: assistantMessage.content || "Done." });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "AI request failed" });
  }
});
