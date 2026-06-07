// Internal contract between the crawler (015) and classifier (016).
// All fields must be JSON-serializable.

export interface CookieRecord {
  name: string
  domain: string
  path: string
  expires: number | null // Unix timestamp (seconds); null = session cookie
  secure: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
  firstParty: boolean
}

export interface StorageEntry {
  type: 'localStorage' | 'sessionStorage'
  key: string
}

export interface RequestRecord {
  url: string
  host: string
  resourceType: string
  firstParty: boolean
}

export interface ScriptRecord {
  src: string | null    // null = inline script
  blocked: boolean      // type="text/plain" declarative blocking
  category: string | null // data-category attribute value
}

export interface IframeRecord {
  src: string | null    // live src attribute (null if blocked)
  dataSrc: string | null // data-src declarative placeholder
  blocked: boolean      // has data-src but no src
  category: string | null // data-category attribute value
}

export interface NoscriptRecord {
  text: string
}

export interface PageFindings {
  url: string
  cookies: CookieRecord[]
  storage: StorageEntry[]
  requests: RequestRecord[]
  scripts: ScriptRecord[]
  iframes: IframeRecord[]
  noscripts: NoscriptRecord[]
}

export interface RawFindings {
  scannedAt: string    // ISO 8601
  targetUrl: string
  pagesVisited: string[]
  pages: PageFindings[]
}
