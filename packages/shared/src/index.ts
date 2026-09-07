export type HealthResponse = {
  service: "api";
  status: "ok";
};

export type ErrorResponse = {
  error: string;
  /** Present for typed Registry errors, e.g. `NOT_OWNER`. */
  code?: string;
};

/** Registry role. `owner` manages the shared catalog; everyone else is `user`. */
export type UserRole = "owner" | "user";

/** `GET /me` */
export type MeResponse = {
  email: string;
  role: UserRole;
};

export type ChannelStatus = "pending" | "available" | "failed";

export type ChannelFailureCode =
  | "NO_TRANSCRIPTS"
  | "NO_EPISODES"
  | "INITIAL_IMPORT_FAILED";

export type ChannelRequestStatus = "pending" | "approved" | "rejected";

export type FollowOrigin = "manual" | "request";

export type ChatRole = "user" | "assistant";

export type ChatMessageStatus = "pending" | "completed" | "failed";
