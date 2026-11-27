/** One entry of the agent collaboration trace (who handed what to whom). */
export interface AgentMessage {
  readonly sequence: number;
  readonly from: string;
  readonly to: string;
  readonly kind: "REQUEST" | "RESULT" | "HANDOFF" | "FALLBACK";
  readonly summary: string;
}
