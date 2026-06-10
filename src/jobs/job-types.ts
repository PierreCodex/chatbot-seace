export const JOB_NAMES = {
  SEARCH_ON_DEMAND: 'search:on-demand',
  CRAWL_SCHEDULED: 'crawl:scheduled',
  FICHA_DETAIL: 'ficha:detail',
  NOTIFY: 'notification:send',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

export const SCRAPE_QUEUE = 'scrape';
