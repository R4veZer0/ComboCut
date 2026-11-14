export const FEEDBACK_CATEGORIES = [
  'Bug Report / Crash',
  'OBS / Stream Routing & Standby',
  'Off-Air Capture & Audio Sync',
  'AI Highlights & Subtitles',
  'UI / Workflow Improvement',
  'Feature Request',
  'Other',
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_FORM_CONFIG = {
  formResponseUrl:
    'https://docs.google.com/forms/d/e/1FAIpQLScvFtxFP5VNPmXfpCD2TVraARn2lu01ZGckajkMXcRupW2edw/formResponse',
  fallbackUrl: 'https://forms.gle/AgcZhtAgxkM3UJxG7',
  entries: {
    category: 'entry.1002976204',
    details: 'entry.55595861',
    handle: 'entry.94588325',
    diagnostics: 'entry.210789531',
  },
} as const;
