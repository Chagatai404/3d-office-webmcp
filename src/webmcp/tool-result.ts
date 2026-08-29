import { ZodError } from "zod";
import type { ActionErrorCode } from "@/contracts/room";

export function readToolSuccess<T>(data: T, roomVersion: number, message: string) {
  return {
    ok: true as const,
    data,
    roomVersion,
    message,
  };
}

/**
 * A refusal shaped exactly like a domain `ActionResult` failure, so an agent
 * reads a tool-level guard and a database-level guard the same way.
 */
export function toolRefusal(
  code: ActionErrorCode,
  message: string,
  recovery: string,
  roomVersion: number,
) {
  return {
    ok: false as const,
    error: { code, message, recovery },
    roomVersion,
  };
}

export async function executeToolSafely(
  execute: () => unknown | Promise<unknown>,
  getRoomVersion: () => number,
): Promise<string> {
  try {
    return JSON.stringify(await execute());
  } catch (error) {
    if (error instanceof ZodError) {
      return JSON.stringify({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "The tool arguments are invalid.",
          recovery: "Correct the arguments to match the registered input schema and retry.",
        },
        roomVersion: getRoomVersion(),
      });
    }
    return JSON.stringify({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "The tool could not complete safely.",
        recovery: "Read the latest meeting context, then retry if the action is still appropriate.",
      },
      roomVersion: getRoomVersion(),
    });
  }
}
