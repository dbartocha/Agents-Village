/**
 * GitHub Copilot hooks (Copilot CLI and VS Code agent mode) → the Claude Code shaped payload the state understands.
 *
 * Copilot runs command hooks; scripts/copilot-hook.ts forwards each one to POST /hooks/copilot?event=<name>,
 * because the camelCase payloads of Copilot CLI carry no event name. Session ids get the prefix "copilot:"
 * so they can never collide with Claude Code sessions. Field names come from the Copilot CLI hooks
 * reference (camelCase: sessionId, toolName, toolArgs …) and the VS Code hooks reference (snake_case,
 * same as Claude Code). Everything is read defensively. See readme.adoc → "GitHub Copilot hooks".
 */
import type { HookPayload, ParseResult } from '../../shared/src/index.ts';

/** Copilot event names (camelCase and the Claude-style aliases) → the names VillageState handles. */
const EVENTS: Record<string, string> = {
  sessionstart: 'SessionStart',
  sessionend: 'SessionEnd',
  userpromptsubmitted: 'UserPromptSubmit',
  userpromptsubmit: 'UserPromptSubmit',
  pretooluse: 'PreToolUse',
  posttooluse: 'PostToolUse',
  posttoolusefailure: 'PostToolUseFailure',
  agentstop: 'Stop',
  stop: 'Stop',
  subagentstart: 'SubagentStart',
  subagentstop: 'SubagentStop',
  erroroccurred: 'ErrorOccurred',
  notification: 'Notification',
  permissionrequest: 'PermissionRequest',
};

export const COPILOT_ID_PREFIX = 'copilot:';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

export function normalizeCopilotPayload(input: unknown, eventHint?: string): ParseResult<HookPayload> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Body must be a JSON object' };
  const o = input as Record<string, unknown>;
  const rawEvent = str(o.hook_event_name) || str(o.hookEventName) || eventHint || '';
  const event = EVENTS[rawEvent.toLowerCase()] ?? rawEvent;
  const sessionId = str(o.session_id) || str(o.sessionId);
  if (!event) return { ok: false, error: 'Missing event name' };
  if (!sessionId) return { ok: false, error: 'Missing session_id' };

  const p: HookPayload = { hook_event_name: event, session_id: sessionId.startsWith(COPILOT_ID_PREFIX) ? sessionId : COPILOT_ID_PREFIX + sessionId };
  const cwd = str(o.cwd);
  if (cwd) p.cwd = cwd;
  const tool = str(o.tool_name) || str(o.toolName);
  if (tool) p.tool_name = tool;
  // permissionRequest sends toolInput, the tool events send toolArgs (a JSON string).
  const args = o.tool_input ?? o.toolArgs ?? o.toolInput;
  if (args !== undefined) p.tool_input = parseMaybeJson(args);
  const toolUseId = str(o.tool_use_id) || str(o.toolUseId);
  if (toolUseId) p.tool_use_id = toolUseId;
  for (const k of ['prompt', 'source', 'reason', 'message', 'title', 'notification_type', 'model']) if (o[k] !== undefined) p[k] = o[k];

  // Errors are a string on tool failures and an object { message, name } on errorOccurred.
  const err = o.error;
  if (typeof err === 'string') p.error = err;
  else if (err && typeof err === 'object') p.error = str((err as Record<string, unknown>).message) || str((err as Record<string, unknown>).name);
  const result = (o.toolResult ?? o.tool_result ?? o.tool_response) as Record<string, unknown> | string | undefined;
  if (result !== undefined) p.tool_response = typeof result === 'string' ? result : str(result?.textResultForLlm) || str(result?.text_result_for_llm) || result;

  const agentType = str(o.agent_type) || str(o.agentType) || str(o.agent_name) || str(o.agentName);
  if (agentType) p.agent_type = agentType;
  const last = str(o.last_assistant_message) || str(o.response);
  if (last) p.last_assistant_message = last;

  // A failed run ends the turn: show it like Claude Code's StopFailure.
  if (event === 'ErrorOccurred') {
    const recoverable = o.recoverable === true;
    p.hook_event_name = recoverable ? 'Notification' : 'StopFailure';
    if (recoverable) p.message = str(p.error) || 'Error';
  }
  // Copilot says "agent_idle" where Claude Code says "idle_prompt".
  if (p.notification_type === 'agent_idle') p.notification_type = 'idle_prompt';
  return { ok: true, value: p };
}
