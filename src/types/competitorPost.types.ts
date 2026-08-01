export interface CreateCompetitorPostInput {
  competitorId: string;
  text: string;
  telegramPostUrl: string;
  publishedAt: Date;
}

export interface ChannelParseStatistics {
  channelName: string;
  channelUsername: string;
  total: number;
  saved: number;
  skipped: number;
  errors: number;
  isAccessible: boolean;
}

export interface CompetitorParseStatistics {
  totalChannels: number;
  successfulChannels: number;
  failedChannels: number;
  deactivatedChannels: number;
  totalPosts: number;
  savedPosts: number;
  skippedPosts: number;
  channels: ChannelParseStatistics[];
}

export type CompetitorProgressCallback = (
  channelName: string,
  current: number,
  total: number
) => void;
