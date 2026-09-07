import type {
  ChannelFailureCode,
  ChannelRequestStatus,
  ChannelStatus,
  UserRole,
} from "@media-digest/shared";

export type RegistryUser = {
  email: string;
  role: UserRole;
  createdAt: number;
  lastSeenAt: number;
};

export type CatalogChannel = {
  channelId: string;
  title: string;
  canonicalUrl: string;
  status: ChannelStatus;
  initialImportCount: number;
  failureCode: ChannelFailureCode | null;
  failureDetail: string | null;
  availableAt: number | null;
  lastCheckedAt: number | null;
  lastIngestedAt: number | null;
  deletedAt: number | null;
  lifecycleVersion: number;
  createdAt: number;
  updatedAt: number;
};

export type ChannelRequest = {
  requestId: string;
  userEmail: string;
  youtubeChannelId: string;
  submittedUrl: string;
  status: ChannelRequestStatus;
  reviewedAt: number | null;
  reviewedByEmail: string | null;
  ownerExplanation: string | null;
  approvedChannelId: string | null;
  autoFollowCompletedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

/** Callers resolve URLs to a canonical `UC…` id and fetch the title before calling the DO. */
export type ConfigureChannelInput = {
  channelId: string;
  title: string;
  initialImportCount?: number;
};

export type SubmitRequestInput = {
  youtubeChannelId: string;
  submittedUrl: string;
};

export type ApproveRequestInput = {
  /** Used only when approval has to create the channel. */
  title: string;
  initialImportCount?: number;
  explanation?: string;
};

export type RejectRequestInput = {
  explanation?: string;
};
