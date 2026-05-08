/**
 * AI admin assistant service.
 * Owns the OpenAI client, the tool definitions, and the agentic execution loop.
 */
import OpenAI from "openai";
import { storage } from "../storage";
import path from "path";
import fs from "fs";
import { uploadsDir } from "../config/multer";
import { sanitizeFolder } from "../utils/url";
import { buildOpenAI } from "../lib/openaiClient";

export const adminAiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: "function", function: { name: "get_dashboard_stats", description: "Get current dashboard statistics: total groups and total students registered.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "list_groups", description: "List all registered groups with their members.", parameters: { type: "object", properties: { project_id: { type: "number", description: "Optional project ID to filter groups by project." } } } } },
  { type: "function", function: { name: "delete_group", description: "Delete a group by its ID. Use only when explicitly asked.", parameters: { type: "object", properties: { group_id: { type: "number" } }, required: ["group_id"] } } },
  { type: "function", function: { name: "list_topics", description: "List all available project topics.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "add_topic", description: "Add a new topic.", parameters: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name"] } } },
  { type: "function", function: { name: "delete_topic", description: "Delete a topic by its ID.", parameters: { type: "object", properties: { topic_id: { type: "number" } }, required: ["topic_id"] } } },
  { type: "function", function: { name: "set_required_members", description: "Set the number of members required per group.", parameters: { type: "object", properties: { count: { type: "number" } }, required: ["count"] } } },
  { type: "function", function: { name: "set_project_name", description: "Update the project/portal display name shown to students.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
  { type: "function", function: { name: "set_deadline", description: "Set the submission deadline.", parameters: { type: "object", properties: { hours_from_now: { type: "number" }, iso_datetime: { type: "string" } } } } },
  { type: "function", function: { name: "update_rules", description: "Update the submission rules text.", parameters: { type: "object", properties: { rules_text: { type: "string" } }, required: ["rules_text"] } } },
  { type: "function", function: { name: "toggle_require_leader", description: "Enable or disable the group leader requirement.", parameters: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"] } } },
  { type: "function", function: { name: "toggle_require_topic", description: "Enable or disable the topic selection requirement.", parameters: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"] } } },
  { type: "function", function: { name: "list_projects", description: "List all project cycles.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "create_project", description: "Create a new project cycle and make it active.", parameters: { type: "object", properties: { name: { type: "string" }, deadline_hours: { type: "number" } }, required: ["name"] } } },
  { type: "function", function: { name: "finalize_project", description: "Finalize (close) a project cycle.", parameters: { type: "object", properties: { project_id: { type: "number" } }, required: ["project_id"] } } },
  { type: "function", function: { name: "get_current_settings", description: "Get all current admin settings.", parameters: { type: "object", properties: {} } } },
];

export async function executeAdminTool(name: string, args: any): Promise<string> {
  switch (name) {
    case "get_dashboard_stats":
      return JSON.stringify(await storage.getStats());
    case "list_groups": {
      const groups = await storage.getGroups(args.project_id ?? "all");
      return JSON.stringify(groups.map(g => ({
        id: g.id, projectId: g.projectId, createdAt: g.createdAt,
        members: g.members.map(m => ({ name: m.name, studentId: m.studentId, role: m.role })),
      })));
    }
    case "delete_group":
      await storage.deleteGroup(args.group_id);
      return `Group ${args.group_id} deleted.`;
    case "list_topics":
      return JSON.stringify(await storage.getTopics());
    case "add_topic": {
      const t = await storage.createTopic(args.name, args.description);
      return `Topic "${args.name}" added with ID ${t.id}.`;
    }
    case "delete_topic":
      await storage.deleteTopic(args.topic_id);
      return `Topic ${args.topic_id} deleted.`;
    case "set_required_members":
      await storage.setSetting("required_members", String(args.count));
      return `Required members set to ${args.count}.`;
    case "set_project_name":
      await storage.setSetting("project_name", args.name);
      return `Project name updated to "${args.name}".`;
    case "set_deadline": {
      let date: Date;
      if (args.hours_from_now != null) { date = new Date(); date.setHours(date.getHours() + args.hours_from_now); }
      else if (args.iso_datetime) { date = new Date(args.iso_datetime); }
      else return "Error: Provide either hours_from_now or iso_datetime.";
      await storage.setSetting("submission_deadline", date.toISOString());
      return `Deadline set to ${date.toLocaleString()}.`;
    }
    case "update_rules":
      await storage.setSetting("rules", args.rules_text);
      return "Rules updated.";
    case "toggle_require_leader":
      await storage.setSetting("group_require_leader", args.enabled ? "true" : "false");
      return `Group leader requirement ${args.enabled ? "enabled" : "disabled"}.`;
    case "toggle_require_topic":
      await storage.setSetting("group_require_topic", args.enabled ? "true" : "false");
      return `Topic requirement ${args.enabled ? "enabled" : "disabled"}.`;
    case "list_projects":
      return JSON.stringify(await storage.getProjects());
    case "create_project": {
      let deadline: Date | undefined;
      if (args.deadline_hours) { deadline = new Date(); deadline.setHours(deadline.getHours() + args.deadline_hours); }
      const folderName = args.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const project = await storage.createProject(args.name, folderName, deadline ?? null);
      await storage.setSetting("active_project_id", String(project.id));
      const dir = path.join(uploadsDir, folderName);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return `Project "${args.name}" created with ID ${project.id} and set as active.`;
    }
    case "finalize_project":
      await storage.finalizeProject(args.project_id);
      return `Project ${args.project_id} finalized.`;
    case "get_current_settings": {
      const [members, projectName, deadline, rules, requireLeader, requireTopic] = await Promise.all([
        storage.getSetting("required_members"),
        storage.getSetting("project_name"),
        storage.getSetting("submission_deadline"),
        storage.getSetting("rules"),
        storage.getSetting("group_require_leader"),
        storage.getSetting("group_require_topic"),
      ]);
      return JSON.stringify({ required_members: members || "6", project_name: projectName || "Student Group Portal", deadline: deadline || "none", rules: rules || "none", require_leader: requireLeader !== "false", require_topic: requireTopic !== "false" });
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

const AI_SYSTEM_PROMPT = `You are an autonomous AI admin assistant for a Student Group Dashboard System. You help the admin manage their student group submission portal.

You have full access to all admin operations through your tools. When the admin asks you to do something, use the appropriate tools to perform the action immediately — don't just describe what you would do.

Current capabilities:
- View stats, groups, topics, settings, projects
- Add/delete topics and groups
- Set required members per group, project name, submission deadline, rules
- Toggle group leader and topic requirements
- Create new project cycles and finalize existing ones

Be concise in your responses. After performing actions, confirm what was done. If asked to do multiple things, do them all. Always be helpful and decisive.`;

export type ChatResult = { reply: string; actions: Array<{ tool: string; result: string }> };

/**
 * Agentic loop: keep calling OpenAI until no more tool calls are requested.
 * Caps at MAX_ITER iterations to prevent runaway loops.
 */
export async function runAdminAiChat(
  userMessages: Array<{ role: string; content: string }>
): Promise<ChatResult> {
  const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: AI_SYSTEM_PROMPT },
    ...userMessages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  const actionsPerformed: Array<{ tool: string; result: string }> = [];
  let loopMessages = [...chatMessages];
  const MAX_ITER = 10;

  for (let i = 0; i < MAX_ITER; i++) {
    const openai = buildOpenAI();
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: loopMessages,
      tools: adminAiTools,
      tool_choice: "auto",
    });

    const assistantMessage = response.choices[0].message;
    loopMessages.push(assistantMessage as any);

    if (!assistantMessage.tool_calls?.length) {
      return { reply: assistantMessage.content || "Done.", actions: actionsPerformed };
    }

    for (const toolCall of assistantMessage.tool_calls) {
      const fn = (toolCall as any).function;
      const args = JSON.parse(fn.arguments || "{}");
      const result = await executeAdminTool(fn.name, args);
      actionsPerformed.push({ tool: fn.name, result });
      loopMessages.push({ role: "tool", tool_call_id: toolCall.id, content: result } as any);
    }
  }

  return { reply: "Actions completed.", actions: actionsPerformed };
}
