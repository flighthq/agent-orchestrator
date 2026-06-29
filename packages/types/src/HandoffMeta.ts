import type { CommitMeta } from './CommitMeta'

export interface HandoffMeta {
  name: string
  /** The worker that sent the parcel. */
  from: string
  /** The recipient worker; set on delivery, absent while staged or exported. */
  to?: string
  /** The worker whose diff this parcel carries, when it differs from `from`. */
  codeSource?: string
  /** The parcel's note (README.md), when it carries one. */
  note?: string
  description: string
  suggestedMessage: string
  createdAt: string
  commits: CommitMeta[]
}
