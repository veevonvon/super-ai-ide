import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { AgentConfig } from "./types";

/**
 * Factory to create a sub-agent tool with the current configuration
 */
export function createRequestSubAgentTool(config: AgentConfig) {
    return tool(
        async ({ goal, task, role, context }) => {
            // Dynamic import to avoid circular dependency
            const { runAgent } = await import("./index");

            const subAgentGoals = goal || task;
            const subAgentRole = role || "Specialized Assistant";

            // Construct messages for the sub-agent
            // Note: runAgent internally adds a System Prompt. 
            // We can add our own restrictions or persona here.
            const messages = [
                {
                    role: "user",
                    content: `[Sub-Agent Instruction]
You are a sub-agent activated by the main agent.
**Role**: ${subAgentRole}
**Task**: ${subAgentGoals}
**Context**: ${context || "None"}

Please execute this task using your tools. Return the final output clearly.`
                }
            ];

            try {
                // Execute the sub-agent
                // We reuse the same configuration (API key, model, etc.)
                // This ensures the sub-agent has the same capabilities as the parent.
                const result = await runAgent(config, messages);
                return result;
            } catch (e: any) {
                return `Sub-agent execution failed: ${e.message}`;
            }
        },
        {
            name: "request_sub_agent",
            description: "Delegate a task to a specialized sub-agent. Use this for distinct, complex sub-tasks.",
            schema: z.object({
                goal: z.string().describe("The specific goal or task for the sub-agent"),
                task: z.string().optional().describe("Alias for goal"),
                role: z.string().optional().describe("The persona/role for the sub-agent (e.g. 'QA Engineer', 'Reviewer')"),
                context: z.string().optional().describe("Additional context needed for the task")
            })
        }
    );
}
