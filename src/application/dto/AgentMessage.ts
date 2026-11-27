export interface AgentMessage {
  readonly sequence: number;
  readonly from: string;
  readonly to: string;
  readonly kind: "REQUEST" | "RESULT" | "HANDOFF" | "FALLBACK";
  readonly summary: string;
}
