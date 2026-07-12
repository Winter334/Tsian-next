export interface Announcement {
  id: string
  title: string
  /** Markdown source. Render with a safe announcement Markdown renderer. */
  body: string
  createdAt: string
  updatedAt: string
}

export interface AnnouncementListResponse {
  announcements: Announcement[]
}

export interface AnnouncementInput {
  title: string
  body: string
}
