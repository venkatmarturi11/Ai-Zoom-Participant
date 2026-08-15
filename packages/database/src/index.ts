export { getDb, disconnectDb, initDatabaseSchema } from './client.js';
export { userRepo } from './repositories/user.repo.js';
export { zoomAccountRepo } from './repositories/zoom-account.repo.js';
export { meetingRepo } from './repositories/meeting.repo.js';
export { recordingRepo } from './repositories/recording.repo.js';
export { oauthStateRepo } from './repositories/oauth-state.repo.js';
export { auditRepo } from './repositories/audit.repo.js';
export type {
  User,
  ZoomAccount,
  Meeting,
  MeetingRecording,
  BotSession,
  OAuthState,
  AuditLog,
  MeetingStatus,
  AccountStatus,
  UserStatus,
} from '@prisma/client';
